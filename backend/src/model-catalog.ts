/** Bounded, untrusted provider metadata. Never evaluate descriptions or forward raw provider bodies. */
export async function readModelCatalog(response: Response, maxBytes = 1_048_576): Promise<Record<string, any>[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || !Array.isArray(payload.data) || payload.data.length > 1000) throw new Error('Invalid model list');
  for (const model of payload.data) {
    if (!model || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 512) throw new Error('Invalid model identifier');
  }
  return payload.data;
}
