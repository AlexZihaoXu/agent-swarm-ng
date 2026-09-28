"""Pure guest-side protocol validation; kept in parity with controller computer-use.ts."""
import json
import math
import string

KEY_NAMES = set(string.ascii_lowercase + string.digits) | {f'F{i}' for i in range(1, 13)} | set('BackSpace Tab Return Escape Delete Insert Home End Page_Up Page_Down Left Right Up Down space Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L Super_R'.split())
BUTTONS = {'left': 1, 'middle': 2, 'right': 3}
SCROLL = {'up': 4, 'down': 5, 'left': 6, 'right': 7}


def fields(value, names):
    if not isinstance(value, dict) or set(value) - set(names):
        raise ValueError('Expected object with only documented parameters.')


def number(value, name, low, high, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high or (positive and value == 0):
        raise ValueError(f'{name} must be {"positive and " if positive else ""}within {low}..{high}.')
    return value


def rounded(value):
    return math.floor(value + .5)


def desktop(state):
    w, h, x, y = state
    if any(type(n) is not int or not 1 <= n <= 4096 for n in (w, h)) or w * h > 16_000_000:
        raise ValueError('Desktop exceeds dimension limits.')
    number(x, 'pointer x', 0, w - 1)
    number(y, 'pointer y', 0, h - 1)


def capture_geometry(value, w, h):
    desktop((w, h, 0, 0))
    if value.get('kind') == 'glance':
        fields(value, ['kind', 'quality'])
        quality = value.get('quality', 'low')
        if quality not in ('low', 'medium', 'high', 'full'):
            raise ValueError('quality must be low, medium, high or full.')
        scale = {'low': .33, 'medium': .5, 'high': .75, 'full': 1}[quality]
        pixels = [0, 0, w, h]
    elif value.get('kind') == 'look_at':
        fields(value, ['kind', 'x', 'y', 'size'])
        x, y = number(value.get('x'), 'x', 0, 999), number(value.get('y'), 'y', 0, 999)
        radius = number(value.get('size'), 'size', 0, float.fromhex('0x1.fffffffffffffp+1023'), True)
        def axis(center, extent):
            span = min(999, radius * 2)
            low = max(0, min(999 - span, center - radius))
            left = min(extent - 1, math.floor(low * extent / 999))
            return left, max(left + 1, min(extent, math.ceil((low + span) * extent / 999)))
        l, r = axis(x, w)
        t, b = axis(y, h)
        pixels, scale = [l, t, r, b], 1
    else:
        raise ValueError('kind must be glance or look_at.')
    l, t, r, b = pixels
    return {'bounds': [l / w * 999, t / h * 999, r / w * 999, b / h * 999], 'pixels': pixels,
            'width': max(1, rounded((r-l)*scale)), 'height': max(1, rounded((b-t)*scale))}


def validate_combo(value, state):
    desktop(state)
    fields(value, ['actions', 'per_action_pause', 'validationToken'])
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8', 'surrogatepass')) > 65536:
        raise ValueError('Request exceeds 64 KiB.')
    actions = value.get('actions')
    if not isinstance(actions, list) or not 1 <= len(actions) <= 16:
        raise ValueError('Use 1..16 actions.')
    pause = number(value.get('per_action_pause', .2), 'per_action_pause', 0, 10)
    w, h, x, y = state
    held, durations = set(), []
    for index, a in enumerate(actions):
        try:
            fields(a, ['type', 'x', 'y', 'speed', 'button', 'direction', 'amount', 'key', 'text', 'cpm'])
            kind, seconds = a.get('type'), 0
            if kind == 'mouse.move_to':
                fields(a, ['type', 'x', 'y', 'speed'])
                nx = rounded(number(a.get('x'), 'x', 0, 999) / 999 * (w - 1))
                ny = rounded(number(a.get('y'), 'y', 0, 999) / 999 * (h - 1))
                seconds = math.hypot(nx-x, ny-y) / number(a.get('speed', 8000), 'speed', 0, 24000, True)
                x, y = nx, ny
            elif kind in ('mouse.left_click', 'mouse.right_click'):
                fields(a, ['type'])
                if ('mouse', 'left' if kind == 'mouse.left_click' else 'right') in held:
                    raise ValueError('Cannot click a held button.')
                seconds = .02
            elif kind in ('mouse.down', 'mouse.up', 'keyboard.down', 'keyboard.up'):
                device, transition = kind.split('.')
                field = 'button' if device == 'mouse' else 'key'
                fields(a, ['type', field])
                name = a.get(field)
                if not isinstance(name, str) or name not in (BUTTONS if device == 'mouse' else KEY_NAMES):
                    raise ValueError('Unsupported button/key name.')
                key = (device, name)
                if transition == 'down':
                    if key in held:
                        raise ValueError('Duplicate down.')
                    held.add(key)
                else:
                    if key not in held:
                        raise ValueError('Unmatched up.')
                    held.remove(key)
            elif kind == 'mouse.scroll':
                fields(a, ['type', 'direction', 'amount'])
                if a.get('direction') not in SCROLL:
                    raise ValueError('Unsupported scroll direction.')
                amount = number(a.get('amount'), 'amount', 1, 250)
                if amount != int(amount):
                    raise ValueError('Scroll amount must be whole detents.')
                seconds = amount * .02
            elif kind == 'keyboard.type':
                fields(a, ['type', 'text', 'cpm'])
                text = a.get('text')
                if not isinstance(text, str) or any((ord(c) < 32 and c not in '\t\n') or 127 <= ord(c) <= 159 or 0xd800 <= ord(c) <= 0xdfff for c in text):
                    raise ValueError('text must contain Unicode scalars; only tab/newline controls are supported.')
                if any(device == 'keyboard' for device, _ in held):
                    raise ValueError('Release keys before keyboard.type.')
                seconds = len(text) * 60 / number(a.get('cpm', 800), 'cpm', 0, 3200, True)
            else:
                raise ValueError('Unsupported action type.')
            durations.append(seconds)
        except (ValueError, TypeError) as error:
            raise ValueError(f'Action {index + 1}: {error}') from error
    if held:
        raise ValueError('Release every held key/button within the combo.')
    action_seconds = sum(durations)
    total = action_seconds + pause * (len(actions) - 1)
    if action_seconds > 5 or total > 10:
        raise ValueError(f'Combo estimates {action_seconds:.3f}s actions / {total:.3f}s total; reduce to <=5s / <=10s.')
    return {'actionSeconds': action_seconds, 'totalSeconds': total, 'durations': durations}


def bezier_points(start, end, seconds, width, height):
    """Precompute <=601 bounded quadratic points; duration is endpoint distance/speed, not curve length."""
    x, y = start
    ex, ey = end
    bend = min(40, math.hypot(ex-x, ey-y) * .08)
    cx = max(0, min(width-1, (x+ex)/2 - bend))
    cy = max(0, min(height-1, (y+ey)/2 + bend))
    count = max(1, min(600, math.ceil(seconds * 120)))
    return [(seconds*i/count, rounded((1-i/count)**2*x + 2*(1-i/count)*(i/count)*cx + (i/count)**2*ex),
             rounded((1-i/count)**2*y + 2*(1-i/count)*(i/count)*cy + (i/count)**2*ey)) for i in range(1, count+1)]
