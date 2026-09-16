import type { Conversation, Mode, StreamEvent } from '../../shared/contracts';
import { readSSE } from '../../shared/sse';
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data as T;
}
export async function streamChat(
  conversationId: string,
  message: string,
  mode: Mode,
  search: boolean,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ conversationId, requestId: crypto.randomUUID(), message, mode, search }),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || '生成失败。');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('服务未返回有效数据流。');
  let completed = false;
  for await (const data of readSSE(response.body)) {
    const event = JSON.parse(data) as StreamEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') completed = true;
    onEvent(event);
  }
  if (!completed) throw new Error('连接中断，回答可能未保存，请刷新查看后重试。');
}
export function exportConversation(c: Conversation) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `拾阶-${c.title.replace(/[\\/:*?"<>|]/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
