import { ResourceError } from './resources';

/** Agent recordings (the guest's recording.py): every request is checked here before it reaches the guest. */
export type RecordingOp = 'start' | 'mark' | 'update' | 'stop' | 'list' | 'terminals';
const fail = (message: string): never => {
  throw new ResourceError(400, message);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT = /^(\*|mark|mouse\.[a-z_]+|keyboard\.[a-z_]+|terminal\.[a-z_]+)$/;

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object.');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).some(key => !names.includes(key))) fail('Unknown recording field.');
}
const between = (value: unknown, name: string, min: number, max: number, integer = false) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(`${name} must be within ${min}..${max}.`);
  return value as number;
};
function rules(value: unknown) {
  const map = object(value);
  if (Object.keys(map).length > 40) fail('At most 40 event rules.');
  for (const [type, rule] of Object.entries(map)) {
    if (!EVENT.test(type)) fail(`Unknown event type ${type}.`);
    const fields = object(rule);
    only(fields, ['before', 'after']);
    if (fields.before !== undefined) between(fields.before, 'before', 0, 30);
    if (fields.after !== undefined) between(fields.after, 'after', 0, 30);
  }
  return map;
}
/** A folder in the guest home (relative, or absolute under /home/agent), with no `..`. */
function folder(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    value.includes('\0') ||
    /(^|\/)\.\.(\/|$)/.test(value)
  )
    fail('Invalid recording folder.');
  const path = value as string;
  if (path.startsWith('/') && !path.startsWith('/home/agent/')) fail('Recordings are saved under /home/agent.');
  return path;
}

export function validateRecording(op: string, input: unknown): Record<string, unknown> {
  const value = object(input);
  switch (op) {
    case 'start': {
      only(value, [
        'id',
        'folder',
        'source',
        'session',
        'label',
        'mode',
        'fps',
        'kbps',
        'audio',
        'rules',
        'defaults',
        'hideTyped',
        'maxSeconds',
      ]);
      if (typeof value.id !== 'string' || !UUID.test(value.id)) fail('Invalid recording id.');
      folder(value.folder);
      if (value.source !== 'desktop' && value.source !== 'terminal') fail('source is desktop or terminal.');
      if (value.source === 'terminal' && (typeof value.session !== 'string' || !UUID.test(value.session)))
        fail('A terminal recording needs its session ID.');
      if (value.source === 'desktop' && value.session !== undefined) fail('A desktop recording has no session.');
      if (typeof value.label !== 'string' || !LABEL.test(value.label)) fail('Invalid source label.');
      if (value.mode !== 'session' && value.mode !== 'events') fail('mode is session or events.');
      between(value.fps, 'fps', 1, value.source === 'desktop' ? 60 : 30, true);
      if (value.kbps !== undefined) between(value.kbps, 'kbps', 100, 50_000, true);
      if (value.audio !== undefined && typeof value.audio !== 'boolean') fail('audio is true or false.');
      if (value.hideTyped !== undefined && typeof value.hideTyped !== 'boolean') fail('hideTyped is true or false.');
      if (value.rules !== undefined) rules(value.rules);
      if (value.defaults !== undefined) {
        if (!Array.isArray(value.defaults) || value.defaults.length !== 2) fail('defaults is [before, after].');
        (value.defaults as unknown[]).forEach(item => between(item, 'default padding', 0, 30));
      }
      if (value.maxSeconds !== undefined) between(value.maxSeconds, 'maxSeconds', 30, 4 * 3600, true);
      return value;
    }
    case 'mark':
      only(value, ['ids', 'label']);
      if (
        !Array.isArray(value.ids) ||
        !value.ids.length ||
        value.ids.length > 6 ||
        value.ids.some(id => typeof id !== 'string' || !UUID.test(id))
      )
        fail('Invalid recordings.');
      if (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 200))
        fail('Invalid label.');
      return value;
    case 'update':
      only(value, ['id', 'rules']);
      if (typeof value.id !== 'string' || !UUID.test(value.id)) fail('Invalid recording id.');
      rules(value.rules);
      return value;
    case 'stop':
      only(value, ['id', 'reason', 'notes']);
      if (typeof value.id !== 'string' || !UUID.test(value.id)) fail('Invalid recording id.');
      if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 120))
        fail('Invalid reason.');
      if (value.notes !== undefined) {
        if (!Array.isArray(value.notes) || value.notes.length > 50) fail('Invalid notes.');
        for (const note of value.notes as unknown[]) {
          const item = object(note);
          only(item, ['at', 'text']);
          between(item.at, 'note time', 0, 1e11);
          if (typeof item.text !== 'string' || item.text.length > 200) fail('Invalid note.');
        }
      }
      return value;
    case 'list':
    case 'terminals':
      only(value, []);
      return value;
    default:
      return fail('Unknown recording operation.');
  }
}
