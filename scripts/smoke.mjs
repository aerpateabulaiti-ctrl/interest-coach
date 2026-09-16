import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.COACH_TEST_URL || 'http://localhost:3000';
let initial;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    initial = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(2000) });
    break;
  } catch {
    await delay(500);
  }
}
assert.ok(initial, 'Production server did not become reachable');
assert.match(
  initial.headers.get('content-type') || '',
  /application\/json/,
  'Production API returned a webpage',
);
assert.equal(initial.status, 200);
const bootstrap = await initial.json();
assert.equal(
  bootstrap.mode,
  'demo',
  'This smoke test only runs in demo mode; it does not spend model credits',
);
const cookie = initial.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'No anonymous workspace cookie');
const request = async (path, method = 'GET', data) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, origin: new URL(base).origin, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal(response.ok, true, `${method} ${path}: ${response.status}`);
  return response;
};
const conversation = await (await request('/api/conversations', 'POST')).json();
try {
  const run = async (mode, message) => {
    const response = await request('/api/chat', 'POST', {
      conversationId: conversation.id,
      requestId: randomUUID(),
      mode,
      message,
      search: false,
    });
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    const text = await response.text();
    const events = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    assert.ok(events.filter((e) => e.type === 'delta').length > 1);
    assert.equal(events.at(-1)?.type, 'done', text);
    return events.at(-1).conversation;
  };
  let c = await run('plan', '生产验证：我想学习 React，每天 30 分钟。');
  assert.equal(c.plans[0].status, 'draft');
  let p = c.plans[0];
  c = await (
    await request('/api/plans', 'PATCH', {
      conversationId: c.id,
      planId: p.id,
      version: p.version,
      action: 'adopt',
    })
  ).json();
  p = c.plans[0];
  c = await (
    await request('/api/plans', 'PATCH', {
      conversationId: c.id,
      planId: p.id,
      version: p.version,
      action: 'task',
      taskId: p.milestones[0].tasks[0].id,
      done: true,
      note: '生产验证记录',
    })
  ).json();
  assert.equal(c.plans[0].milestones[0].tasks[0].done, true);
  c = await run('review', '请根据我的实际完成记录复盘');
  assert.match(c.messages.at(-1).content, /1 \/ 6/);
  assert.match(c.messages.at(-1).content, /生产验证记录/);
  const restored = await (await request(`/api/conversations?id=${c.id}`)).json();
  assert.equal(restored.messages.length, 4);
  assert.equal(restored.plans[0].milestones[0].tasks[0].note, '生产验证记录');
  console.log(
    'Production HTTP smoke passed: session → streamed plan → approval → task evidence → review → reload.',
  );
} finally {
  await request(`/api/conversations?id=${conversation.id}`, 'DELETE');
}
