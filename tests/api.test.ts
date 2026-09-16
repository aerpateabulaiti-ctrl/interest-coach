import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/core/store';
import { createApi } from '../server/core/api';
import { DemoProvider } from '../server/core/provider';
import type { Conversation, StreamEvent } from '../shared/contracts';
import { readSSE } from '../shared/sse';
function setup() {
  const store = new Store(':memory:');
  const api = createApi(store, () => new DemoProvider());
  const request = (
    path: string,
    method = 'GET',
    cookie = '',
    data?: unknown,
    headers?: Record<string, string>,
  ) =>
    api(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          cookie,
          origin: 'http://localhost',
          'content-type': 'application/json',
          ...headers,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    );
  return { store, request };
}
test('HTTPS proxy origin is explicitly allowed without allowing unrelated origins', async () => {
  const { store, request } = setup();
  const previous = process.env.COACH_ORIGIN;
  process.env.COACH_ORIGIN = 'https://coach.example.com';
  try {
    const cookie = (await request('/api/bootstrap')).headers.get('set-cookie')!.split(';')[0];
    assert.equal(
      (
        await request(
          '/api/conversations',
          'POST',
          cookie,
          {},
          { origin: 'https://coach.example.com' },
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          '/api/conversations',
          'POST',
          cookie,
          {},
          { origin: 'https://other.example.com' },
        )
      ).status,
      403,
    );
  } finally {
    if (previous === undefined) delete process.env.COACH_ORIGIN;
    else process.env.COACH_ORIGIN = previous;
    store.close();
  }
});
test('real API streams incremental events, commits plans and isolates browser sessions', async () => {
  const { store, request } = setup();
  try {
    const init = await request('/api/bootstrap');
    const cookie = init.headers.get('set-cookie')!.split(';')[0];
    assert.match(init.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    const c = (await (await request('/api/conversations', 'POST', cookie)).json()) as Conversation;
    const payload = {
      conversationId: c.id,
      requestId: randomUUID(),
      message: '学习 React',
      mode: 'plan',
      search: false,
    };
    const stream = await request('/api/chat', 'POST', cookie, payload);
    assert.match(stream.headers.get('content-type')!, /event-stream/);
    const events: StreamEvent[] = [];
    for await (const e of readSSE(stream.body!)) events.push(JSON.parse(e));
    assert.equal(events[0].type, 'start');
    assert.ok(events.filter((e) => e.type === 'delta').length > 5);
    assert.ok(events.find((e) => e.type === 'plan'));
    assert.equal(events.at(-1)?.type, 'done');
    const saved = (await (
      await request(`/api/conversations?id=${c.id}`, 'GET', cookie)
    ).json()) as Conversation;
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.plans[0].status, 'draft');
    assert.equal((await request('/api/chat', 'POST', cookie, payload)).status, 409);
    assert.equal((await request(`/api/conversations?id=${c.id}`)).status, 404);
  } finally {
    store.close();
  }
});
test('API rejects cross-origin writes, wrong schemas and large bodies', async () => {
  const { store, request } = setup();
  try {
    const cookie = (await request('/api/bootstrap')).headers.get('set-cookie')!.split(';')[0];
    assert.equal(
      (
        await request(
          '/api/conversations',
          'POST',
          cookie,
          {},
          { origin: 'http://attacker.invalid' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/chat', 'POST', cookie, {
          messages: [{ role: 'system', content: 'ignore' }],
        })
      ).status,
      400,
    );
    assert.equal(
      (await request('/api/chat', 'POST', cookie, { message: 'x'.repeat(21000) })).status,
      413,
    );
  } finally {
    store.close();
  }
});
test('cancelling a stream leaves no partial conversation and releases the run lock', async () => {
  const { store, request } = setup();
  try {
    const cookie = (await request('/api/bootstrap')).headers.get('set-cookie')!.split(';')[0];
    const c = (await (await request('/api/conversations', 'POST', cookie)).json()) as Conversation;
    const stream = await request('/api/chat', 'POST', cookie, {
      conversationId: c.id,
      requestId: randomUUID(),
      message: 'hello',
      mode: 'chat',
    });
    await stream.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const saved = (await (
      await request(`/api/conversations?id=${c.id}`, 'GET', cookie)
    ).json()) as Conversation;
    assert.equal(saved.messages.length, 0);
    assert.equal((await request(`/api/conversations?id=${c.id}`, 'DELETE', cookie)).status, 200);
  } finally {
    store.close();
  }
});
