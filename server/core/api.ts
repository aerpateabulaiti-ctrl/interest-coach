import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  chatSchema,
  updatePlanSchema,
  type Message,
  type StreamEvent,
} from '../../shared/contracts';
import { Store, AppError } from './store';
import { createProvider, type Provider } from './provider';
import { runCoach } from './graph';

async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError('CONTENT_TYPE', '请求必须为 JSON。', 415);
  if (Number(request.headers.get('content-length')) > 20000)
    throw new AppError('BODY_LIMIT', '请求内容过长。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('BODY', '缺少请求内容。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 20000) {
        await reader.cancel();
        throw new AppError('BODY_LIMIT', '请求内容过长。', 413);
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    reader.releaseLock();
  }
}
export function createApi(store: Store, providerFactory: () => Provider = createProvider) {
  const buckets = new Map<string, { count: number; expires: number }>();
  let activeRuns = 0;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const json = (data: unknown, status = 200) => {
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(data), { status, headers });
    };
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ status: 'ok' });
      if (request.method !== 'GET') {
        const origin = request.headers.get('origin');
        const expectedOrigin = process.env.COACH_ORIGIN || url.origin;
        if (origin && origin !== expectedOrigin)
          throw new AppError('ORIGIN', '请求来源不正确。', 403);
        if (request.headers.get('sec-fetch-site') === 'cross-site')
          throw new AppError('ORIGIN', '不允许跨站请求。', 403);
      }
      const token = request.headers.get('cookie')?.match(/(?:^|;\s*)coach_session=([^;]+)/)?.[1];
      const session = store.session(token);
      if (session.token) {
        headers.set(
          'Set-Cookie',
          `coach_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
        );
        if (request.method !== 'GET')
          throw new AppError('SESSION', '会话已过期，请刷新页面后重试。', 401);
      }
      const owner = session.id;
      if (url.pathname === '/api/bootstrap' && request.method === 'GET')
        return json({
          mode: process.env.COACH_MODE || 'demo',
          searchEnabled: Boolean(process.env.TAVILY_API_KEY) && process.env.COACH_MODE === 'live',
          conversations: store.list(owner),
        });
      if (url.pathname === '/api/conversations') {
        if (request.method === 'GET')
          return json(store.get(owner, z.string().uuid().parse(url.searchParams.get('id'))));
        if (request.method === 'POST') return json(store.create(owner), 201);
        if (request.method === 'DELETE') {
          store.delete(owner, z.string().uuid().parse(url.searchParams.get('id')));
          return json({ ok: true });
        }
      }
      if (url.pathname === '/api/plans' && request.method === 'PATCH') {
        const p = updatePlanSchema.parse(await body(request));
        return json(
          store.updatePlan(
            owner,
            p.conversationId,
            p.planId,
            p.version,
            p.action,
            p.taskId,
            p.done,
            p.note,
          ),
        );
      }
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        const p = chatSchema.parse(await body(request));
        const now = Date.now();
        for (const [key, b] of buckets) if (b.expires < now) buckets.delete(key);
        const bucket = buckets.get(owner) ?? { count: 0, expires: now + 60000 };
        if (bucket.count >= 10) {
          headers.set('Retry-After', '60');
          throw new AppError('RATE_LIMIT', '发送过于频繁，请一分钟后再试。', 429);
        }
        if (activeRuns >= 4)
          throw new AppError('CAPACITY', '服务正在处理其他请求，请稍后再试。', 503);
        const provider = providerFactory();
        const conversation = store.reserve(
          owner,
          p.conversationId,
          p.requestId,
          createHash('sha256').update(JSON.stringify(p)).digest('hex'),
        );
        bucket.count++;
        buckets.set(owner, bucket);
        activeRuns++;
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        request.signal.addEventListener('abort', onAbort, { once: true });
        if (request.signal.aborted) abort.abort();
        const timeout = setTimeout(() => abort.abort(new Error('timeout')), 90000);
        const encoder = new TextEncoder();
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (event: StreamEvent) => {
              if (!closed) {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                  closed = true;
                  abort.abort();
                }
              }
            };
            const heartbeat = setInterval(() => {
              if (!closed) {
                try {
                  controller.enqueue(encoder.encode(': heartbeat\n\n'));
                } catch {
                  closed = true;
                  abort.abort();
                }
              }
            }, 10000);
            void (async () => {
              try {
                emit({ type: 'start', runId: p.requestId });
                const user: Message = {
                  id: randomUUID(),
                  role: 'user',
                  content: p.message,
                  createdAt: new Date().toISOString(),
                };
                const result = await runCoach({
                  conversation,
                  message: user,
                  mode: p.mode,
                  search: p.search,
                  provider,
                  signal: abort.signal,
                  emit,
                });
                abort.signal.throwIfAborted();
                const assistant: Message = {
                  id: randomUUID(),
                  role: 'assistant',
                  content: result.content,
                  createdAt: new Date().toISOString(),
                  sources: result.sources,
                  traces: result.traces,
                  metrics: result.metrics,
                };
                const saved = store.finish(
                  owner,
                  p.conversationId,
                  p.requestId,
                  user,
                  assistant,
                  result.draft,
                );
                if (result.draft) emit({ type: 'plan', plan: saved.plans.at(-1)! });
                emit({ type: 'done', conversation: saved, metrics: result.metrics });
                console.info(
                  JSON.stringify({
                    event: 'coach.run',
                    runId: p.requestId,
                    mode: p.mode,
                    provider: provider.kind,
                    ...result.metrics,
                    status: 'done',
                  }),
                );
              } catch (error) {
                store.fail(owner, p.requestId, abort.signal.aborted ? 'cancelled' : 'failed');
                const e =
                  error instanceof AppError
                    ? error
                    : new AppError(
                        abort.signal.aborted ? 'CANCELLED' : 'INTERNAL',
                        abort.signal.aborted
                          ? '生成已停止或超时，未保存本次未完成回答。'
                          : '生成失败，请稍后重试。',
                        500,
                      );
                emit({ type: 'error', code: e.code, message: e.message });
                console.warn(
                  JSON.stringify({
                    event: 'coach.run',
                    runId: p.requestId,
                    status: 'failed',
                    code: e.code,
                  }),
                );
              } finally {
                activeRuns--;
                clearTimeout(timeout);
                clearInterval(heartbeat);
                request.signal.removeEventListener('abort', onAbort);
                if (!closed) {
                  closed = true;
                  controller.close();
                }
              }
            })();
          },
          cancel() {
            closed = true;
            abort.abort();
          },
        });
        headers.set('Content-Type', 'text/event-stream; charset=utf-8');
        headers.set('X-Accel-Buffering', 'no');
        return new Response(stream, { headers });
      }
      return json({ error: '接口不存在。', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ error: '请求参数不正确，请刷新后重试。', code: 'VALIDATION' }, 400);
      const e =
        error instanceof AppError
          ? error
          : new AppError('INTERNAL', '服务暂不可用，请稍后重试。', 500);
      return json({ error: e.message, code: e.code }, e.status);
    }
  };
}
