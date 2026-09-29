import { ResourceError } from './resources';
const fail = (message: string): never => {
  throw new ResourceError(400, message);
};
const invalid = (): never => {
  throw new ResourceError(503, 'Invalid terminal response; inspect before retrying.');
};
const id = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const name = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const keys = new Set([
  'Enter',
  'Tab',
  'BTab',
  'Escape',
  'BSpace',
  'Delete',
  'Insert',
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...[...'abcdefghijklmnopqrstuvwxyz'].flatMap(c => [`C-${c}`, `M-${c}`]),
]);
const fields: Record<string, string[]> = {
  create: ['name', 'command', 'cwd'],
  list: [],
  view: ['session', 'rows', 'up'],
  status: ['session'],
  type: ['session', 'text'],
  press: ['session', 'key'],
  interrupt: ['session'],
  delete: ['session'],
  // Trusted operator only (the backend never offers these to agents).
  rename: ['session', 'name'],
  resize: ['session', 'columns', 'rows'],
  // Every session's visible screen with colour escapes, for the operator's live previews.
  screens: [],
};
export const terminalSize = { columns: [40, 240], rows: [10, 80] } as const;
export function validateTerminal(value: Record<string, any>, prepared = false) {
  if (typeof value.operation !== 'string' || !Object.hasOwn(fields, value.operation))
    fail('Unknown terminal operation.');
  if (
    Object.keys(value).some(
      key => !['kind', 'operation', ...(prepared ? ['validationToken'] : []), ...fields[value.operation]].includes(key),
    )
  )
    fail('Unknown terminal field.');
  const text = (key: string, max: number) => {
    if (
      typeof value[key] !== 'string' ||
      !value[key].length ||
      Buffer.byteLength(value[key]) > max ||
      value[key].includes('\0')
    )
      fail(`Invalid ${key}.`);
  };
  if (
    !['create', 'list', 'screens'].includes(value.operation) &&
    (typeof value.session !== 'string' || !id.test(value.session))
  )
    fail('Use the exact terminal session ID from create/list.');
  if (value.operation === 'rename' && (typeof value.name !== 'string' || !name.test(value.name)))
    fail('Name: 1..48 letters, digits, hyphens or underscores; start with a letter/digit.');
  if (value.operation === 'resize')
    for (const key of ['columns', 'rows'] as const) {
      const [min, max] = terminalSize[key];
      if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
        fail(`${key} must be an integer from ${min} to ${max}.`);
    }
  if (value.operation === 'create') {
    if (typeof value.name !== 'string' || !name.test(value.name))
      fail('Name: 1..48 letters, digits, hyphens or underscores; start with a letter/digit.');
    if (value.command !== undefined) {
      text('command', 32768);
      if (!value.command.trim()) fail('Command must be nonempty.');
    }
    if (value.cwd !== undefined) {
      text('cwd', 4096);
      if (!value.cwd.trim()) fail('Working directory must be nonempty.');
    }
  }
  if (value.operation === 'view')
    for (const [key, max, min] of [
      ['rows', 200, 1],
      ['up', 10000, 0],
    ] as const)
      if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max))
        fail(`${key} must be an integer from ${min} to ${max}.`);
  if (value.operation === 'type') {
    text('text', 32768);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text)) fail('Use press for control keys.');
  }
  if (value.operation === 'press' && !keys.has(value.key)) fail('Unsupported terminal key.');
  return value;
}

/** Whitelist guest output. Terminal text is inert/untrusted, not HTML or executable browser content. */
export function terminalResult(result: any, operation: string, requestedSession?: string): Record<string, unknown> {
  const string = (value: unknown, max: number) => {
    if (typeof value !== 'string' || Buffer.byteLength(value) > max) return invalid();
    return value;
  };
  const session = (value: any) => {
    if (
      !value ||
      !id.test(string(value.id, 36)) ||
      !name.test(string(value.name, 48)) ||
      typeof value.alive !== 'boolean' ||
      !Number.isSafeInteger(value.createdAt) ||
      value.createdAt < 0 ||
      !(value.exitCode === null || Number.isInteger(value.exitCode)) ||
      !Number.isInteger(value.columns) ||
      value.columns < 1 ||
      value.columns > 4096 ||
      !Number.isInteger(value.rows) ||
      value.rows < 1 ||
      value.rows > 4096
    )
      return invalid();
    return {
      id: value.id,
      name: value.name,
      alive: value.alive,
      exitCode: value.exitCode,
      createdAt: value.createdAt,
      columns: value.columns,
      rows: value.rows,
      ...(value.exitSignal !== undefined
        ? { exitSignal: value.exitSignal === null ? null : string(value.exitSignal, 32) }
        : {}),
      ...(value.cwd !== undefined ? { cwd: string(value.cwd, 16384) } : {}),
      ...(value.currentCommand !== undefined ? { currentCommand: string(value.currentCommand, 16384) } : {}),
    };
  };
  if (!result || result.type !== 'terminal') return invalid();
  if (operation === 'list') {
    if (!Array.isArray(result.sessions) || result.sessions.length > 32) return invalid();
    return { type: 'terminal', sessions: result.sessions.map(session) };
  }
  if (operation === 'screens') {
    if (!Array.isArray(result.screens) || result.screens.length > 32) return invalid();
    return {
      type: 'terminal',
      screens: result.screens.map((screen: any) => {
        if (!screen || !id.test(string(screen.id, 36))) return invalid();
        return { id: screen.id, ansi: string(screen.ansi, 32768) };
      }),
    };
  }
  if (operation === 'delete') {
    if (
      result.deleted !== true ||
      !id.test(string(result.sessionId, 36)) ||
      (requestedSession && result.sessionId !== requestedSession)
    )
      return invalid();
    return { type: 'terminal', deleted: true, sessionId: result.sessionId };
  }
  const safe = { type: 'terminal', session: session(result.session) };
  if (requestedSession && safe.session.id !== requestedSession) return invalid();
  if (operation === 'view') {
    if (typeof result.truncated !== 'boolean') return invalid();
    const w = result.window;
    const count = (n: unknown) => (Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : invalid());
    return {
      ...safe,
      text: string(result.text, 50000),
      truncated: result.truncated,
      ...(w ? { window: { from: count(w.from), to: count(w.to), total: count(w.total), up: count(w.up) } } : {}),
      note: string(result.note, 768),
    };
  }
  if (['type', 'press', 'interrupt'].includes(operation)) {
    if (result.accepted !== true) return invalid();
    return { ...safe, accepted: true };
  }
  return safe;
}
