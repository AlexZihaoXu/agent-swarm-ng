export async function consumeEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: Record<string, any>) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        if (boundary > 256000) throw new Error('Oversized agent event');
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (line.trim()) onEvent(JSON.parse(line));
      }
      if (buffer.length > 256000) throw new Error('Oversized agent event');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
