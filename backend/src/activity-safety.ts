/** Only safe runtime evidence belongs in the operator archive, never transport credentials. */
const privateKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|private[_-]?key|x-api-key|x-auth-token|api[_-]?token|token|secret|credentials|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|validationToken|thinkingSignature|thoughtSignature|textSignature|encrypted_content)$/i;
export function activityRedactor(secret: string) {
  const secrets = secret ? [...new Set([secret, JSON.stringify(secret).slice(1,-1)])].sort((a,b)=>b.length-a.length) : [];
  return (text: string, streaming = false) => {
    let value = text;
    for (const key of secrets) {
      value = value.replaceAll(key, '[redacted]');
      // Do not publish a credential prefix while its remaining bytes are still streaming.
      if (streaming) for (let size = Math.min(key.length - 1, value.length); size > 0; size--) {
        if (value.endsWith(key.slice(0,size))) { value = value.slice(0,-size) + '[redacted pending credential]'; break; }
      }
    }
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]');
  };
}
export function activityValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? '[function]' : value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[invalid date]' : value.toISOString();
  if (value instanceof Error) return { name:value.name, note:'Raw error object withheld; see the tool/model outcome for safe diagnostics.' };
  if (ArrayBuffer.isView(value)) return { type:'binary', bytes:value.byteLength, note:'Binary bytes are not duplicated into text activity.' };
  if (seen.has(value)) return '[circular reference]';
  if (depth > 64) return '[metadata depth limit reached]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item=>activityValue(item,depth+1,seen));
    const row = value as Record<string, unknown>;
    if (row.type === 'image') return { type:'image', index:typeof row.index==='number'?row.index:undefined, mimeType:row.mimeType, encodedCharacters:typeof row.data==='string'?row.data.length:undefined, data:'[image bytes omitted; use retained image reference when available]' };
    return Object.fromEntries(Object.entries(row).map(([key,item])=>[key,privateKey.test(key)?'[redacted]':activityValue(item,depth+1,seen)]));
  } finally { seen.delete(value); }
}
export function activityJson(value: unknown) {
  try { return JSON.stringify(activityValue(value),null,2) ?? ''; }
  catch { return '[Structured runtime detail could not be serialized]'; }
}
export function providerFailure(message?: string) {
  const status = message?.match(/(?:^|\bHTTP\s+)([45]\d\d)\b/i)?.[1];
  let structured: Record<string, unknown> = {};
  try {
    const start = message?.indexOf('{') ?? -1;
    if (start >= 0 && message!.length - start <= 65536) {
      const body = JSON.parse(message!.slice(start)), error = body?.error;
      if (error && typeof error === 'object') structured = Object.fromEntries(['code','type','param'].filter(key => typeof error[key] === 'string' && /^[A-Za-z0-9_.[\]-]{1,160}$/.test(error[key])).map(key => [key,error[key]]));
    }
  } catch { /* Raw error text is intentionally not forwarded. */ }
  const category = /context[_ -]?(?:length|window)|too many tokens/i.test(message ?? '') ? 'context limit'
    : /insufficient[_ -]?quota|quota exceeded/i.test(message ?? '') ? 'quota'
    : /rate[_ -]?limit|too many requests/i.test(message ?? '') || status==='429' ? 'rate limit'
    : /invalid[_ -]?(?:api[_ -]?)?key|invalid_grant|unauthorized|authentication|token.*expired|refresh.*failed/i.test(message ?? '') || status==='401' ? 'authentication'
    : status==='403' ? 'access denied' : 'provider request';
  return { summary:'The provider request failed. Check the model connection.', category, ...structured, ...(status ? { httpStatus:Number(status) } : {}), note:'Raw provider error text is withheld because it may contain credentials or request data.' };
}
