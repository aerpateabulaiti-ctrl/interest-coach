import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/core/store';
import { demoDraft } from '../server/core/provider';
import type { Message } from '../shared/contracts';
const message = (role: 'user' | 'assistant', content: string): Message => ({
  id: randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
});

test('SQLite survives restart; ownership is enforced; interruption releases busy state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coach-test-'));
  const path = join(dir, 'test.sqlite');
  let store = new Store(path);
  try {
    const c = store.create('alice');
    const requestId = randomUUID();
    store.reserve('alice', c.id, requestId, 'fingerprint');
    store.finish(
      'alice',
      c.id,
      requestId,
      message('user', '学习 React'),
      message('assistant', '你好'),
      demoDraft('React'),
    );
    store.reserve('alice', c.id, randomUUID(), 'interrupted');
    store.close();
    store = new Store(path);
    assert.equal(store.get('alice', c.id).messages.length, 2);
    assert.throws(() => store.get('bob', c.id), /未找到/);
    assert.deepEqual(store.list('bob'), []);
    assert.doesNotThrow(() => store.reserve('alice', c.id, randomUUID(), 'after-restart'));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('confirmation, optimistic versions and task evidence follow legal transitions', () => {
  const store = new Store(':memory:');
  try {
    const c = store.create('owner');
    const run = randomUUID();
    store.reserve('owner', c.id, run, 'x');
    const saved = store.finish(
      'owner',
      c.id,
      run,
      message('user', 'plan'),
      message('assistant', 'plan'),
      demoDraft('React'),
    );
    const p = saved.plans[0];
    const t = p.milestones[0].tasks[0];
    assert.throws(() => store.updatePlan('owner', c.id, p.id, 0, 'task', t.id, true), /先确认/);
    const adopted = store.updatePlan('owner', c.id, p.id, 0, 'adopt');
    assert.equal(adopted.plans[0].status, 'active');
    assert.throws(() => store.updatePlan('owner', c.id, p.id, 0, 'task', t.id, true), /其他页面/);
    const checked = store.updatePlan('owner', c.id, p.id, 1, 'task', t.id, true, '完成了组件拆分');
    assert.equal(checked.plans[0].milestones[0].tasks[0].done, true);
    assert.ok(checked.plans[0].milestones[0].tasks[0].completedAt);
    assert.equal(checked.plans[0].milestones[0].tasks[0].note, '完成了组件拆分');
  } finally {
    store.close();
  }
});
test('stream commit preserves concurrent check-ins and prevents duplicate runs', () => {
  const store = new Store(':memory:');
  try {
    const c = store.create('owner');
    const first = randomUUID();
    store.reserve('owner', c.id, first, 'a');
    const saved = store.finish(
      'owner',
      c.id,
      first,
      message('user', 'plan'),
      message('assistant', 'plan'),
      demoDraft('React'),
    );
    const p = saved.plans[0];
    store.updatePlan('owner', c.id, p.id, 0, 'adopt');
    const second = randomUUID();
    store.reserve('owner', c.id, second, 'b');
    assert.throws(() => store.reserve('owner', c.id, second, 'b'), /已提交/);
    assert.throws(() => store.reserve('owner', c.id, randomUUID(), 'c'), /正在生成/);
    store.updatePlan('owner', c.id, p.id, 1, 'task', p.milestones[0].tasks[0].id, true);
    const result = store.finish(
      'owner',
      c.id,
      second,
      message('user', 'review'),
      message('assistant', 'review'),
    );
    assert.equal(result.plans[0].milestones[0].tasks[0].done, true);
  } finally {
    store.close();
  }
});
