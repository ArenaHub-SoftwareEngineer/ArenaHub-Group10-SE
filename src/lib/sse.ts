/** Server-sent events from a fetch body: yields { event, data } with data parsed as JSON. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: any }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const parse = (block: string) => {
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trimStart();
    }
    try { return { event, data: data ? JSON.parse(data) : null }; } catch { return { event, data: null }; }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.trim()) yield parse(block);
      }
    }
    if (buffer.trim()) yield parse(buffer);
  } finally { reader.releaseLock(); }
}
