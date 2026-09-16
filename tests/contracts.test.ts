import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSchema } from '../shared/contracts';
import { demoDraft } from '../server/core/provider';
import { readSSE } from '../shared/sse';

test('plan rejects impossible time budgets and duplicate tasks', () => {
  const p = demoDraft('React');
  assert.equal(draftSchema.safeParse(p).success, true);
  assert.equal(draftSchema.safeParse({ ...p, durationDays: 1, dailyMinutes: 5 }).success, false);
  p.milestones[0].tasks.push(p.milestones[0].tasks[0]);
  assert.equal(draftSchema.safeParse(p).success, false);
});
test('SSE survives single-byte UTF-8 chunks, CRLF, comments and multiline events', async () => {
  const bytes = new TextEncoder().encode(
    ': ping\r\ndata: 你好\r\ndata: world\r\n\r\ndata: [DONE]\n\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const events: string[] = [];
  for await (const event of readSSE(stream)) events.push(event);
  assert.deepEqual(events, ['你好\nworld', '[DONE]']);
});
test('SSE discards unterminated events instead of accepting truncated output', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: partial'));
      c.close();
    },
  });
  const events: string[] = [];
  for await (const event of readSSE(stream)) events.push(event);
  assert.deepEqual(events, []);
});
