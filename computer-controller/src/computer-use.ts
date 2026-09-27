import { ResourceError } from './resources';

/** Internal controller protocol. Authorization/claim/fresh-look accounting is the backend's responsibility.
 * Every execution needs the generation token from dry validation; cancel rotates it before joining.
 * Never retry actions after a transport error, or transfer a claim without a settled cancel response. */
export type CaptureRequest = { kind: 'glance'; quality?: 'low' | 'medium' | 'high' } | { kind: 'look_at'; x: number; y: number; size: number };
export type CaptureResult = { mimeType: 'image/jpeg'; data: string; bounds: number[]; width: number; height: number; sourceWidth: number; sourceHeight: number };
export type Action =
  | { type: 'mouse.move_to'; x: number; y: number; speed?: number }
  | { type: 'mouse.left_click' | 'mouse.right_click' }
  | { type: 'mouse.down' | 'mouse.up'; button: 'left' | 'middle' | 'right' }
  | { type: 'mouse.scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { type: 'keyboard.down' | 'keyboard.up'; key: string }
  | { type: 'keyboard.type'; text: string; cpm?: number };
export type Combo = { actions: Action[]; per_action_pause?: number; validationToken?: string };
export type DesktopState = { width: number; height: number; x: number; y: number };
export type ValidationResult = { valid: true; validationToken: string; actionSeconds: number; totalSeconds: number; sourceWidth: number; sourceHeight: number; pointer: { x: number; y: number } };
export type ActionResult = { started: boolean; completed: number; error: string | null };
export const KEY_NAMES = new Set([... 'abcdefghijklmnopqrstuvwxyz0123456789', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'BackSpace', 'Tab', 'Return', 'Escape', 'Delete', 'Insert', 'Home', 'End', 'Page_Up', 'Page_Down', 'Left', 'Right', 'Up', 'Down', 'space',
  'Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Super_L', 'Super_R']);
export const MAX_USE_BODY = 64 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const fail = (message: string): never => { throw new ResourceError(400, message); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object.');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).some(key => !names.includes(key))) fail('Unknown parameter.');
}
function number(value: unknown, name: string, min: number, max: number, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value === 0)) fail(`${name} must be ${positive ? 'positive and ' : ''}within ${min}..${max}.`);
  return value as number;
}
export function validateDesktop(state: DesktopState) {
  for (const n of [state.width, state.height]) if (!Number.isInteger(n) || n < 1 || n > 4096) fail('Desktop dimensions must be 1..4096 pixels.');
  if (state.width * state.height > 16_000_000) fail('Desktop exceeds 16 million pixels.');
  number(state.x, 'pointer x', 0, state.width - 1); number(state.y, 'pointer y', 0, state.height - 1);
}
export function validateCapture(input: unknown): CaptureRequest {
  const value = object(input);
  if (value.kind === 'glance') {
    fields(value, ['kind', 'quality']);
    if (value.quality !== undefined && !['low', 'medium', 'high'].includes(String(value.quality))) fail('quality must be low, medium or high.');
  } else if (value.kind === 'look_at') {
    fields(value, ['kind', 'x', 'y', 'size']);
    number(value.x, 'x', 0, 999); number(value.y, 'y', 0, 999); number(value.size, 'size', 0, Number.MAX_VALUE, true);
  } else fail('kind must be glance or look_at.');
  return value as CaptureRequest;
}
/** Crop boundaries are continuous [0,999], mapped to floor(left)/ceil(right) exclusive pixels.
 * Return actual rounded pixel-edge bounds, not the unrounded requested rectangle. */
export function captureGeometry(input: unknown, sourceWidth: number, sourceHeight: number) {
  const value = validateCapture(input);
  validateDesktop({ width: sourceWidth, height: sourceHeight, x: 0, y: 0 });
  const axis = (center: number, radius: number, pixels: number) => {
    const span = Math.min(999, radius * 2), low = Math.max(0, Math.min(999 - span, center - radius));
    const left = Math.min(pixels - 1, Math.floor(low * pixels / 999));
    return [left, Math.max(left + 1, Math.min(pixels, Math.ceil((low + span) * pixels / 999)))];
  };
  const [l, r] = value.kind === 'glance' ? [0, sourceWidth] : axis(value.x, value.size, sourceWidth);
  const [t, b] = value.kind === 'glance' ? [0, sourceHeight] : axis(value.y, value.size, sourceHeight);
  const scale = value.kind === 'glance' ? { low: .33, medium: .5, high: .75 }[value.quality ?? 'low'] : 1;
  return { bounds: [l / sourceWidth * 999, t / sourceHeight * 999, r / sourceWidth * 999, b / sourceHeight * 999], pixels: [l, t, r, b], width: Math.max(1, Math.round((r - l) * scale)), height: Math.max(1, Math.round((b - t) * scale)) };
}
/** Pure full-combo admission, also run again in the guest against its current pointer.
 * Typing counts Unicode scalar codepoints (not graphemes). Scroll units are wheel detents.
 * Click and detent dwell is .02s; explicit down/up transitions have zero estimated dwell. */
export function validateCombo(input: unknown, state: DesktopState) {
  validateDesktop(state);
  const value = object(input); fields(value, ['actions', 'per_action_pause', 'validationToken']);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_USE_BODY) fail('Request exceeds 64 KiB.');
  if (value.validationToken !== undefined && (typeof value.validationToken !== 'string' || !/^[0-9a-f-]{36}$/.test(value.validationToken))) fail('Invalid validationToken.');
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 16) fail('Use 1..16 actions.');
  const actions = value.actions as unknown[];
  const pause = number(value.per_action_pause ?? .1, 'per_action_pause', 0, 10);
  let x = state.x, y = state.y, actionSeconds = 0;
  const held = new Set<string>();
  const durations: number[] = [];
  actions.forEach((raw, index) => {
    try {
      const a = object(raw); let seconds = 0;
      switch (a.type) {
        case 'mouse.move_to': {
          fields(a, ['type', 'x', 'y', 'speed']);
          const nx = Math.round(number(a.x, 'x', 0, 999) / 999 * (state.width - 1)), ny = Math.round(number(a.y, 'y', 0, 999) / 999 * (state.height - 1));
          seconds = Math.hypot(nx - x, ny - y) / number(a.speed ?? 8000, 'speed', 0, 24000, true); x = nx; y = ny; break;
        }
        case 'mouse.left_click': case 'mouse.right_click':
          fields(a, ['type']);
          if (held.has(`mouse:${a.type === 'mouse.left_click' ? 'left' : 'right'}`)) fail('Cannot click a held button.');
          seconds = .02; break;
        case 'mouse.down': case 'mouse.up': case 'keyboard.down': case 'keyboard.up': {
          const mouse = a.type.startsWith('mouse'); fields(a, ['type', mouse ? 'button' : 'key']);
          const name = mouse ? a.button : a.key;
          if (typeof name !== 'string' || (mouse ? !['left', 'middle', 'right'].includes(name) : !KEY_NAMES.has(name))) fail('Unsupported button/key name.');
          const key = `${mouse ? 'mouse' : 'keyboard'}:${name}`;
          if (a.type.endsWith('.down')) { if (held.has(key)) fail('Duplicate down.'); held.add(key); }
          else { if (!held.delete(key)) fail('Unmatched up.'); } break;
        }
        case 'mouse.scroll':
          fields(a, ['type', 'direction', 'amount']);
          if (!['up', 'down', 'left', 'right'].includes(String(a.direction))) fail('Unsupported scroll direction.');
          seconds = number(a.amount, 'amount', 1, 250) * .02;
          if (!Number.isInteger(a.amount)) fail('Scroll amount must be whole detents.'); break;
        case 'keyboard.type': {
          fields(a, ['type', 'text', 'cpm']);
          if (typeof a.text !== 'string' || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(a.text)) fail('text must contain Unicode scalars; only tab/newline controls are supported.');
          if ([...held].some(key => key.startsWith('keyboard:'))) fail('Release keys before keyboard.type.');
          seconds = [...(a.text as string)].length * 60 / number(a.cpm ?? 800, 'cpm', 0, 3200, true); break;
        }
        default: fail('Unsupported action type.');
      }
      durations.push(seconds); actionSeconds += seconds;
    } catch (error) { fail(`Action ${index + 1}: ${error instanceof Error ? error.message : 'Invalid action.'}`); }
  });
  if (held.size) fail('Release every held key/button within the combo.');
  const totalSeconds = actionSeconds + pause * (actions.length - 1);
  if (actionSeconds > 5 || totalSeconds > 10) fail(`Combo estimates ${actionSeconds.toFixed(3)}s actions / ${totalSeconds.toFixed(3)}s total; reduce to <=5s / <=10s.`);
  return { actionSeconds, totalSeconds, durations };
}
