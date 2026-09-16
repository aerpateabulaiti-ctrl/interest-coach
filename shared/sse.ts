/** Incremental SSE decoder: supports CRLF, split UTF-8, comments and multiline data. */
export async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const line = (value: string): string | undefined => {
    if (value === '') {
      const joined = data.length ? data.join('\n') : undefined;
      data = [];
      return joined;
    }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    return undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error('SSE frame exceeds limit');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const event = line(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
        if (event !== undefined) yield event;
      }
      if (done) break;
    }
    // A truncated event has no blank-line terminator and must not be accepted.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
