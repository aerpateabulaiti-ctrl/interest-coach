import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { LiveProvider, demoDraft } from '../server/core/provider';

test('live adapter repairs invalid plan JSON and streams content from compatible HTTP API', async () => {
  let plans = 0;
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-fixture');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.model, 'test-model');
    if (!body.stream) {
      plans++;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: plans === 1 ? '{invalid' : JSON.stringify(demoDraft('React')) } },
          ],
        }),
      );
    } else {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"reasoning_content":"not rendered"}}]}\n\n');
      setTimeout(
        () =>
          res.end(
            'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          ),
        10,
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const provider = new LiveProvider({
      url: `http://127.0.0.1:${address.port}`,
      key: 'test-fixture',
      model: 'test-model',
    });
    const signal = AbortSignal.timeout(3000);
    const plan = await provider.plan('React', '', signal);
    assert.equal(plan.durationDays, 7);
    let answer = '';
    for await (const text of provider.answer([], 'plan', plan, [], signal)) answer += text;
    assert.equal(answer, '你好世界');
    assert.equal(requests, 3);
    assert.equal(provider.calls, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('live adapter rejects truncated streams and preserves actionable HTTP errors', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/bad/chat/completions') {
      res.writeHead(401);
      res.end('private upstream text');
    } else {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    for (const [path, pattern] of [
      ['', /不完整/],
      ['/bad', /401/],
    ] as const) {
      const p = new LiveProvider({
        url: `http://127.0.0.1:${port}${path}`,
        key: 'test-fixture',
        model: 'test-model',
      });
      await assert.rejects(async () => {
        for await (const _ of p.answer([], 'chat', undefined, [], AbortSignal.timeout(3000))) {
          /* consume */
        }
      }, pattern);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
