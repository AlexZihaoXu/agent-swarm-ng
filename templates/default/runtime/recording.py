"""Agent recordings inside a computer (guest account only). Docker-exec entry point, never a network service.

    recording.py start  '{"id", "folder", "source", "label", "mode", "fps", "kbps", "audio", "rules", "hideTyped", ...}'
    recording.py mark   '{"ids": [...], "label"}'
    recording.py update '{"id", "rules"}'
    recording.py stop   '{"id", "reason"}'      -> files, clips, stills
    recording.py list   '{}'
    recording.py run    <id>                     (the detached worker; started by `start`)
    recording.py cast   <path> <cols> <rows>     (tmux pipe-pane writer for terminal sources)

A desktop source is ffmpeg (screen at `fps`, cursor drawn, the virtual speakers' sound) cut into 2 s MPEG-TS segments; a
terminal source samples the tmux screen at `fps` (changed screens only) and keeps an exact asciicast of its output. In
"events" mode only segments near events are kept (a rolling buffer); on stop the clips are cut, encoded and saved with
an events.log beside them. Events are written by computer-use.py / computer-terminal.py while a recording of their
kind is active (see journal()).
"""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

RUN = Path('/run/user/1000/swarm-recordings')
WORK = Path('/tmp/agent-recordings')
TMUX = ['/usr/bin/tmux', '-S', '/run/user/1000/swarm-terminals/socket']
RENDER = '/dev/dri/renderD128'
SEGMENT = 2.0
ID = re.compile(r'^[0-9a-f-]{36}$')
LABEL = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
DESKTOP_EVENTS = ('mouse.move_to', 'mouse.left_click', 'mouse.right_click', 'mouse.down', 'mouse.up', 'mouse.scroll',
                  'keyboard.down', 'keyboard.up', 'keyboard.type')
TERMINAL_EVENTS = ('terminal.type', 'terminal.press')
MAX_PAD = 30.0


def now():
    return time.time()


def journal(kind, event):
    """Called by the input scripts after each action: appends to the journal only while a recording of that kind is
    active (desktop, or this terminal session). Never raises: recording must not break input."""
    try:
        name = 'desktop' if kind == 'desktop' else 'terminal-' + event['session']
        if not (RUN / (name + '.active')).exists():
            return
        with open(RUN / (name + '.events'), 'a') as file:
            file.write(json.dumps(event, separators=(',', ':')) + '\n')
    except Exception:
        pass


# ---------------------------------------------------------------- pure planning (unit-tested)

def padding(rules, kind, defaults):
    rule = rules[kind] if kind in rules else rules.get('*')
    if rule is None:
        return None
    before = rule.get('before', defaults[0])
    after = rule.get('after', defaults[1])
    return min(max(before, 0), MAX_PAD), min(max(after, 0), MAX_PAD)


def plan_clips(events, rules, defaults, start, stop, gap=1.0):
    """Merged [from, to) intervals in seconds since `start`, each with its events. Events are dicts with t0/t1 (wall
    seconds) and type; types without a rule are ignored; marks use the 'mark' rule."""
    spans = []
    for event in sorted(events, key=lambda e: e['t0']):
        pad = padding(rules, event['type'], defaults)
        if pad is None:
            continue
        a = max(0.0, event['t0'] - start - pad[0])
        b = min(stop - start, event.get('t1', event['t0']) - start + pad[1])
        if b <= a:
            continue
        a, b = round(a, 3), round(b, 3)
        if spans and a <= spans[-1]['to'] + gap:
            spans[-1]['to'] = max(spans[-1]['to'], b)
            spans[-1]['events'].append(event)
        else:
            spans.append({'from': a, 'to': b, 'events': [event]})
    return spans


def parse_segments(text):
    """ffmpeg segment list (csv: file,start,end), relative seconds."""
    out = []
    for line in text.splitlines():
        parts = line.strip().split(',')
        if len(parts) == 3 and parts[0].endswith('.ts'):
            out.append({'file': parts[0], 'from': float(parts[1]), 'to': float(parts[2])})
    return out


def covering(segments, a, b):
    return [s for s in segments if s['to'] > a and s['from'] < b]


def clock(seconds):
    seconds = max(0.0, seconds)
    return '%02d:%06.3f' % (int(seconds // 60), seconds % 60)


def describe(event, hide_typed):
    kind = event['type']
    if kind in ('keyboard.type', 'terminal.type'):
        text = event.get('text', '')
        detail = '(%d characters)' % len(text) if hide_typed else json.dumps(text[:80] + ('…' if len(text) > 80 else ''), ensure_ascii=False)
    elif kind == 'mouse.move_to':
        detail = '(%s,%s)' % (event.get('x'), event.get('y'))
    elif kind in ('keyboard.down', 'keyboard.up', 'terminal.press'):
        detail = str(event.get('key', ''))
    elif kind == 'mouse.scroll':
        detail = '%s ×%s' % (event.get('direction'), event.get('amount'))
    elif kind == 'mark':
        detail = json.dumps(event.get('label', ''), ensure_ascii=False)
    else:
        detail = ''
    length = event.get('t1', event['t0']) - event['t0']
    if length >= 0.5:
        detail += ' (%.1f s)' % length
    return (kind + ' ' + detail).strip()


def log_line(at, start, label, where, text):
    iso = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(at)) + ('%.3f' % (at % 1))[1:] + 'Z'
    return '%s  rec %s  %-16s  %-16s  %s' % (iso, clock(at - start), label, where, text)


# ---------------------------------------------------------------- terminal rendering

PALETTE = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
           '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5']
BG, FG = (20, 20, 20), (237, 237, 237)


def color256(n):
    if n < 16:
        h = PALETTE[n]
        return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
    if n < 232:
        n -= 16
        level = lambda v: v * 40 + 55 if v else 0
        return (level(n // 36), level(n // 6 % 6), level(n % 6))
    g = (n - 232) * 10 + 8
    return (g, g, g)


def parse_ansi(line):
    """[(text, fg, bg, bold, underline)] for one row with SGR escapes only (tmux capture-pane -e)."""
    runs, fg, bg, bold, under, inverse = [], None, None, False, False, False
    for part in re.split(r'(\x1b\[[0-9;]*m)', line):
        if not part:
            continue
        if part.startswith('\x1b['):
            codes = [int(c) if c else 0 for c in part[2:-1].split(';')] or [0]
            i = 0
            while i < len(codes):
                c = codes[i]
                if c == 0: fg, bg, bold, under, inverse = None, None, False, False, False
                elif c == 1: bold = True
                elif c == 22: bold = False
                elif c == 4: under = True
                elif c == 24: under = False
                elif c == 7: inverse = True
                elif c == 27: inverse = False
                elif 30 <= c <= 37: fg = color256(c - 30)
                elif 90 <= c <= 97: fg = color256(c - 82)
                elif c == 39: fg = None
                elif 40 <= c <= 47: bg = color256(c - 40)
                elif 100 <= c <= 107: bg = color256(c - 92)
                elif c == 49: bg = None
                elif c in (38, 48) and i + 1 < len(codes):
                    if codes[i + 1] == 5 and i + 2 < len(codes):
                        value = color256(codes[i + 2]); i += 2
                    elif codes[i + 1] == 2 and i + 4 < len(codes):
                        value = tuple(codes[i + 2:i + 5]); i += 4
                    else:
                        value = None
                    if c == 38: fg = value
                    else: bg = value
                i += 1
            continue
        a, b = fg or FG, bg or BG
        runs.append((part, b if inverse else a, a if inverse else b, bold, under))
    return runs


def render_screen(text, cols, rows, path):
    from PIL import Image, ImageDraw, ImageFont
    size = 16
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', size)
    bold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', size)
    cw, ch, pad = round(size * 0.602 * 100) / 100, 20, 8
    width = int(cols * cw + 2 * pad) // 2 * 2
    height = int(rows * ch + 2 * pad) // 2 * 2
    image = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(image)
    for y, line in enumerate(text.split('\n')[:rows]):
        x = 0
        for chunk, fg, bg, strong, under in parse_ansi(line):
            for char in chunk:
                if x >= cols:
                    break
                left, top = pad + x * cw, pad + y * ch
                if bg != BG:
                    draw.rectangle([left, top, left + cw, top + ch], fill=bg)
                if char != ' ':
                    draw.text((left, top + 2), char, font=bold if strong else font, fill=fg)
                if under:
                    draw.line([left, top + ch - 2, left + cw, top + ch - 2], fill=fg)
                x += 1
    image.save(path)
    return width, height


# ---------------------------------------------------------------- state

def state_path(rid):
    return WORK / rid / 'state.json'


def load(rid):
    if not ID.match(rid):
        raise ValueError('Invalid recording.')
    path = state_path(rid)
    if not path.exists():
        raise ValueError('No such recording.')
    return json.loads(path.read_text())


def save(state):
    path = state_path(state['id'])
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state))
    os.replace(temporary, path)


def active_name(state):
    return 'desktop' if state['source'] == 'desktop' else 'terminal-' + state['session']


def refresh_active():
    """Journals are written only while some recording of their kind runs."""
    wanted = set()
    for path in WORK.glob('*/state.json'):
        try:
            state = json.loads(path.read_text())
        except Exception:
            continue
        if state.get('status') == 'recording':
            wanted.add(active_name(state))
    for marker in RUN.glob('*.active'):
        if marker.stem not in wanted:
            marker.unlink(missing_ok=True)
            (RUN / (marker.stem + '.events')).unlink(missing_ok=True)
    for name in wanted:
        (RUN / (name + '.active')).touch()


def read_jsonl(path):
    out = []
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


def events_of(state, until=None):
    start, end = state['started'], until or now()
    # Once capture ends the events are kept with the recording (the shared journal may be cleared).
    kept = WORK / state['id'] / 'events.jsonl'
    journal_events = read_jsonl(kept) if kept.exists() else read_jsonl(RUN / (active_name(state) + '.events'))
    marks = read_jsonl(WORK / state['id'] / 'marks.jsonl')
    return [e for e in journal_events + marks if start - MAX_PAD <= e['t0'] <= end]


# ---------------------------------------------------------------- commands

def start(value):
    rid, folder, source = value['id'], value['folder'], value['source']
    if not ID.match(rid) or not LABEL.match(value['label']):
        raise ValueError('Invalid recording.')
    home = Path('/home/agent')
    target = (home / folder) if not folder.startswith('/') else Path(folder)
    work = WORK / rid
    if work.exists():
        raise ValueError('Recording already exists.')
    if source == 'desktop':
        session = None
    else:
        session = value.get('session', '')
        if not ID.match(session):
            raise ValueError('Invalid terminal.')
        if subprocess.run(TMUX + ['has-session', '-t', 'sw-' + session], capture_output=True).returncode:
            raise ValueError('Terminal not found.')
    RUN.mkdir(mode=0o700, parents=True, exist_ok=True)
    work.mkdir(mode=0o700, parents=True)
    target.mkdir(parents=True, exist_ok=True)
    state = {
        'id': rid, 'folder': str(target), 'source': source, 'session': session, 'label': value['label'],
        'mode': value['mode'], 'fps': value['fps'], 'kbps': value.get('kbps', 1000), 'audio': value.get('audio', True),
        'rules': value.get('rules', {}), 'defaults': value.get('defaults', [0.5, 0.5]), 'hideTyped': value.get('hideTyped', False),
        'maxSeconds': value.get('maxSeconds', 1800), 'started': now(), 'status': 'recording', 'encoder': None,
    }
    save(state)
    refresh_active()
    with open(work / 'worker.log', 'ab') as log:
        subprocess.Popen([sys.executable, '-I', __file__, 'run', rid], stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         start_new_session=True, close_fds=True)
    # Wait until the capture has started (or failed), so a broken source is reported now.
    deadline = now() + 8
    while now() < deadline:
        state = load(rid)
        if state.get('capturing') or state['status'] != 'recording':
            break
        time.sleep(0.1)
    state = load(rid)
    if state['status'] == 'failed':
        raise ValueError('Recording could not start: ' + state.get('error', 'capture failed'))
    return {'id': rid, 'started': state['started'], 'encoder': state.get('encoder'), 'audio': state.get('audio')}


def ffmpeg_desktop(state, work, encoder):
    fps, kbps = state['fps'], state['kbps']
    args = ['/usr/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-thread_queue_size', '512',
            '-f', 'x11grab', '-framerate', str(fps), '-draw_mouse', '1', '-i', ':1']
    if state['audio']:
        args += ['-thread_queue_size', '512', '-f', 'pulse', '-i', 'swarm-output.monitor']
    if encoder == 'vaapi':
        # The screen's colour conversion happens on the GPU too (measured at 60 fps: ~13% of a core, not ~107%).
        args += ['-vaapi_device', RENDER, '-vf', 'hwupload,scale_vaapi=format=nv12', '-c:v', 'h264_vaapi', '-rc_mode', 'VBR',
                 '-b:v', '%dk' % int(kbps * 0.7), '-maxrate', '%dk' % kbps, '-g', str(int(fps * SEGMENT)), '-bf', '0']
    else:
        args += ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '26', '-maxrate', '%dk' % kbps,
                 '-bufsize', '%dk' % (kbps * 2), '-g', str(int(fps * SEGMENT)),
                 '-force_key_frames', 'expr:gte(t,n_forced*%g)' % SEGMENT]
    if state['audio']:
        args += ['-c:a', 'aac', '-b:a', '96k']
    args += ['-f', 'segment', '-segment_time', str(SEGMENT), '-segment_format', 'mpegts', '-reset_timestamps', '1',
             '-segment_list', str(work / 'segments.csv'), '-segment_list_type', 'csv', str(work / 'seg-%06d.ts')]
    return args


def worker(rid):
    state = load(rid)
    work = WORK / rid
    stop_flag = work / 'stop'
    env = dict(os.environ, DISPLAY=':1', XDG_RUNTIME_DIR='/run/user/1000', HOME='/home/agent')
    deadline = state['started'] + state['maxSeconds'] + 60
    try:
        if state['source'] == 'desktop':
            process = None
            for encoder in (('vaapi', 'cpu') if os.access(RENDER, os.R_OK | os.W_OK) else ('cpu',)):
                for audio in ((True, False) if state['audio'] else (False,)):
                    state['audio'] = audio
                    process = subprocess.Popen(ffmpeg_desktop(state, work, encoder), stdin=subprocess.PIPE,
                                               stdout=subprocess.DEVNULL, stderr=open(work / 'ffmpeg.log', 'ab'), env=env)
                    time.sleep(1.5)
                    if process.poll() is None:
                        break
                if process.poll() is None:
                    state['encoder'] = encoder
                    break
            if process is None or process.poll() is not None:
                state.update(status='failed', error='screen capture did not start')
                save(state)
                return
            # The first segment's wall time: ffmpeg starts its timeline at the first captured frame.
            state['capturing'] = True
            state['started'] = now() - 1.5
            save(state)
            while not stop_flag.exists() and now() < deadline and process.poll() is None:
                if state['mode'] == 'events':
                    prune(load(rid), work)
                time.sleep(1)
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.wait(15)
                except subprocess.TimeoutExpired:
                    process.kill()
        else:
            target = 'sw-%s:0' % state['session']
            size = subprocess.run(TMUX + ['display-message', '-p', '-t', target, '#{pane_width} #{pane_height}'],
                                  capture_output=True, text=True).stdout.split()
            cols, rows = (int(size[0]), int(size[1])) if len(size) == 2 else (80, 24)
            state.update(cols=cols, rows=rows, capturing=True, encoder='render')
            save(state)
            subprocess.run(TMUX + ['pipe-pane', '-o', '-t', target,
                                   'exec /usr/bin/python3 -I /opt/swarm/recording.py cast %s %d %d' % (work / 'terminal.cast', cols, rows)])
            last, period = None, 1 / state['fps']
            with open(work / 'frames.jsonl', 'a') as frames:
                while not stop_flag.exists() and now() < deadline:
                    at = now()
                    screen = subprocess.run(TMUX + ['capture-pane', '-e', '-p', '-t', target], capture_output=True, text=True)
                    if screen.returncode:
                        break  # the terminal is gone
                    if screen.stdout != last:
                        last = screen.stdout
                        frames.write(json.dumps({'t': at, 'screen': last}) + '\n')
                        frames.flush()
                    time.sleep(max(0, at + period - now()))
            subprocess.run(TMUX + ['pipe-pane', '-t', target], capture_output=True)
    finally:
        state = load(rid)
        if state['status'] == 'recording':
            ended = now()
            journal_events = read_jsonl(RUN / (active_name(state) + '.events'))
            (work / 'events.jsonl').write_text(''.join(
                json.dumps(e) + '\n' for e in journal_events if state['started'] - MAX_PAD <= e['t0'] <= ended))
            state['status'] = 'captured'
            state['ended'] = ended
            save(state)
        refresh_active()


def prune(state, work):
    """Events mode: drop segments no clip can need (older than the longest 'before' padding, outside every clip)."""
    segments = parse_segments((work / 'segments.csv').read_text()) if (work / 'segments.csv').exists() else []
    if len(segments) < 3:
        return
    longest = max([state['defaults'][0]] + [r.get('before', state['defaults'][0]) for r in state['rules'].values()])
    horizon = now() - state['started'] - min(longest, MAX_PAD) - 2 * SEGMENT
    clips = plan_clips(events_of(state), state['rules'], state['defaults'], state['started'], now() + MAX_PAD)
    for segment in segments[:-2]:
        if segment['to'] < horizon and not any(
                segment['to'] > clip['from'] and segment['from'] < clip['to'] for clip in clips):
            (work / segment['file']).unlink(missing_ok=True)


def mark(value):
    at = now()
    for rid in value['ids']:
        state = load(rid)
        if state['status'] != 'recording':
            continue
        with open(WORK / rid / 'marks.jsonl', 'a') as file:
            file.write(json.dumps({'t0': at, 't1': at, 'type': 'mark', 'label': str(value.get('label', ''))[:200]}) + '\n')
    return {'marked': at}


def update(value):
    state = load(value['id'])
    state['rules'] = value['rules']
    save(state)
    return {'updated': True}


def encode_args(encoder, kbps):
    if encoder == 'vaapi':
        return ['-vaapi_device', RENDER, '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-rc_mode', 'VBR',
                '-b:v', '%dk' % int(kbps * 0.7), '-maxrate', '%dk' % kbps]
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '26', '-maxrate', '%dk' % kbps,
            '-bufsize', '%dk' % (kbps * 2)]


def ffmpeg(args, timeout=600):
    result = subprocess.run(['/usr/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args,
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr[-500:])


def next_number(folder, label):
    numbers = [int(m.group(1)) for p in Path(folder).glob('clip-*-%s.mp4' % label)
               for m in [re.match(r'clip-(\d+)-', p.name)] if m]
    return max(numbers, default=0) + 1


def contact_sheet(videos, work):
    """One labelled JPEG grid of stills across the saved videos (6 from one video, fewer each from several; at most
    12), so the agent can check what it captured in a single image."""
    from PIL import Image, ImageDraw, ImageFont
    if not videos:
        return None
    each = max(1, min(6, 12 // len(videos)))
    tiles = []
    for name, path, duration in videos:
        for index in range(each):
            at = duration * (index + 0.5) / each
            image = work / ('still-%d.png' % len(tiles))
            try:
                ffmpeg(['-ss', '%.3f' % at, '-i', str(path), '-frames:v', '1', '-vf', 'scale=320:-2', str(image)], 30)
                tiles.append((Image.open(image).convert('RGB'), '%s %s' % (name.rsplit('.', 1)[0], clock(at))))
            except Exception:
                pass
    if not tiles:
        return None
    width = 320
    height = max(tile.height for tile, _ in tiles)
    columns = min(3, len(tiles))
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new('RGB', (columns * width + (columns + 1) * 4, rows * height + (rows + 1) * 4), (40, 40, 40))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 11)
    for index, (tile, label) in enumerate(tiles):
        x = 4 + (index % columns) * (width + 4)
        y = 4 + (index // columns) * (height + 4)
        sheet.paste(tile, (x, y))
        box = draw.textbbox((x + 4, y + height - 16), label, font=font)
        draw.rectangle([box[0] - 2, box[1] - 1, box[2] + 2, box[3] + 1], fill=(0, 0, 0))
        draw.text((x + 4, y + height - 16), label, font=font, fill=(255, 255, 255))
    out = work / 'sheet.jpg'
    sheet.save(out, quality=80)
    return {'mimeType': 'image/jpeg', 'width': sheet.width, 'height': sheet.height,
            'data': base64.b64encode(out.read_bytes()).decode()}


def probe_duration(path):
    result = subprocess.run(['/usr/bin/ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                            capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def stop(value):
    rid = value['id']
    state = load(rid)
    work = WORK / rid
    if state['status'] == 'recording':
        (work / 'stop').touch()
        deadline = now() + 25
        while now() < deadline and load(rid)['status'] == 'recording':
            time.sleep(0.2)
        state = load(rid)
    if state['status'] in ('saved', 'failed'):
        return state.get('result', {'error': state.get('error')})
    end = state.get('ended', now())
    folder, label = Path(state['folder']), state['label']
    events = events_of(state, end)
    files, lines = [], []
    try:
        if state['source'] == 'desktop':
            segments = parse_segments((work / 'segments.csv').read_text()) if (work / 'segments.csv').exists() else []
            segments = [s for s in segments if (work / s['file']).exists()]
            spans = ([{'from': 0.0, 'to': segments[-1]['to'] if segments else 0.0, 'events': events}]
                     if state['mode'] == 'session' else
                     plan_clips(events, state['rules'], state['defaults'], state['started'], end))
            for span in spans:
                parts = covering(segments, span['from'], span['to'])
                if not parts:
                    continue
                listing = work / 'concat.txt'
                listing.write_text(''.join("file '%s'\n" % (work / p['file']) for p in parts))
                name = 'clip-%02d-%s.mp4' % (next_number(folder, label), label)
                out = folder / name
                audio = ['-c:a', 'aac', '-b:a', '96k'] if state['audio'] else ['-an']
                if state['mode'] == 'session':
                    ffmpeg(['-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(out)])
                else:
                    offset = span['from'] - parts[0]['from']
                    ffmpeg(['-f', 'concat', '-safe', '0', '-i', str(listing), '-ss', '%.3f' % offset,
                            '-t', '%.3f' % (span['to'] - span['from'])] + encode_args(state.get('encoder'), state['kbps'])
                           + audio + ['-movflags', '+faststart', str(out)])
                files.append({'name': name, 'from': span['from'], 'to': span['to'], 'events': span['events']})
        else:
            frames = read_jsonl(work / 'frames.jsonl')
            if frames:
                spans = ([{'from': 0.0, 'to': end - state['started'], 'events': events}] if state['mode'] == 'session'
                         else plan_clips(events, state['rules'], state['defaults'], state['started'], end))
                rendered = {}
                for span in spans:
                    a, b = state['started'] + span['from'], state['started'] + span['to']
                    shown = [f for f in frames if a <= f['t'] < b]
                    before = [f for f in frames if f['t'] < a]
                    if before:
                        shown.insert(0, dict(before[-1], t=a))
                    if not shown:
                        continue
                    listing = work / 'concat.txt'
                    entries = []
                    for index, frame in enumerate(shown):
                        key = frame['screen']
                        if key not in rendered:
                            image = work / ('frame-%06d.png' % len(rendered))
                            render_screen(key, state['cols'], state['rows'], image)
                            rendered[key] = image
                        until = shown[index + 1]['t'] if index + 1 < len(shown) else b
                        entries.append("file '%s'\nduration %.3f\n" % (rendered[key], max(until - frame['t'], 0.001)))
                    entries.append("file '%s'\n" % rendered[shown[-1]['screen']])
                    listing.write_text(''.join(entries))
                    name = 'clip-%02d-%s.mp4' % (next_number(folder, label), label)
                    ffmpeg(['-f', 'concat', '-safe', '0', '-i', str(listing), '-vf', 'fps=%d,format=yuv420p' % state['fps'],
                            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', str(folder / name)])
                    files.append({'name': name, 'from': span['from'], 'to': span['to'], 'events': span['events']})
                if (work / 'terminal.cast').exists():
                    cast = 'clip-%02d-%s.cast' % (next_number(folder, label) - 1, label) if files else '%s.cast' % label
                    shutil.copyfile(work / 'terminal.cast', folder / cast)
                    files.append({'name': cast, 'cast': True})
    except Exception as error:
        state.update(status='failed', error='saving failed: ' + str(error)[:300])
        save(state)
        return {'error': state['error']}
    # events.log: one shared, time-sorted log per folder.
    start_at = state['started']
    lines.append((start_at, log_line(start_at, start_at, label, '—', 'recording started · %s · %s · %d fps%s' % (
        'desktop' if state['source'] == 'desktop' else 'terminal', state['mode'], state['fps'],
        ' · audio' if state.get('audio') and state['source'] == 'desktop' else ''))))
    placed = []
    for file in files:
        for event in file.get('events', []):
            placed.append(event['t0'])
            lines.append((event['t0'], log_line(event['t0'], start_at, label, '%s %s' % (
                file['name'].split('-' + label)[0], clock(event['t0'] - start_at - file['from'])),
                describe(event, state['hideTyped']))))
    if state['mode'] == 'events':
        for event in events:
            if event['t0'] not in placed and state['started'] <= event['t0'] <= end:
                lines.append((event['t0'], log_line(event['t0'], start_at, label, '(no clip)', describe(event, state['hideTyped']))))
    for note in value.get('notes', []):
        lines.append((note['at'], log_line(note['at'], start_at, label, '—', note['text'])))
    lines.append((end, log_line(end, start_at, label, '—', 'recording stopped · %s · %d file(s)' % (
        value.get('reason', 'stopped'), len([f for f in files if not f.get('cast')])))))
    log = folder / 'events.log'
    existing = [(line[:24], line) for line in log.read_text().splitlines()] if log.exists() else []
    merged = sorted(existing + [(time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(at)) + ('%.3f' % (at % 1))[1:] + 'Z', line)
                                for at, line in lines])
    log.write_text(''.join(line + '\n' for _, line in merged))
    result = {'folder': str(folder), 'files': []}
    videos = []
    for file in files:
        path = folder / file['name']
        entry = {'name': file['name'], 'size': path.stat().st_size}
        if not file.get('cast'):
            entry['seconds'] = round(probe_duration(path), 1)
            entry['events'] = len(file['events'])
            videos.append((file['name'], path, entry['seconds']))
        result['files'].append(entry)
    try:
        result['sheet'] = contact_sheet(videos, work)
    except Exception:
        result['sheet'] = None
    state.update(status='saved', result=result)
    save(state)
    shutil.rmtree(work, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    work.mkdir()
    save(state)  # a small tombstone: the result stays readable once
    refresh_active()
    return result


def listing(_value):
    out = []
    for path in WORK.glob('*/state.json'):
        try:
            state = json.loads(path.read_text())
        except Exception:
            continue
        out.append({key: state.get(key) for key in ('id', 'source', 'session', 'label', 'mode', 'status', 'started', 'folder')})
    return {'recordings': out}


def terminals(_value):
    """The computer's terminals (id, name), so a recording can be named after its terminal."""
    rows = subprocess.run(TMUX + ['list-sessions', '-F', '#{session_name}|#{@swarm_name}'], capture_output=True, text=True)
    out = []
    for line in rows.stdout.splitlines():
        name, _, label = line.partition('|')
        if name.startswith('sw-') and ID.match(name[3:]):
            out.append({'id': name[3:], 'name': label})
    return {'terminals': out}


def cast_writer(path, cols, rows):
    start = now()
    with open(path, 'w') as out:
        out.write(json.dumps({'version': 2, 'width': int(cols), 'height': int(rows), 'timestamp': int(start)}) + '\n')
        stream = sys.stdin.buffer
        while True:
            data = os.read(stream.fileno(), 65536)
            if not data:
                break
            out.write(json.dumps([round(now() - start, 6), 'o', data.decode('utf-8', 'replace')]) + '\n')
            out.flush()


def main():
    if os.getuid() != 1000:
        raise RuntimeError('Recording requires the guest agent account.')
    # Recordings are ordinary files in the home folder; the working state stays private (mkdir modes below).
    os.umask(0o022)
    command = sys.argv[1]
    if command == 'run':
        return worker(sys.argv[2])
    if command == 'cast':
        return cast_writer(*sys.argv[2:5])
    WORK.mkdir(mode=0o700, parents=True, exist_ok=True)
    value = json.loads(sys.argv[2] if len(sys.argv) > 2 else '{}')
    handlers = {'start': start, 'mark': mark, 'update': update, 'stop': stop, 'list': listing, 'terminals': terminals}
    if command not in handlers:
        raise ValueError('Unknown operation.')
    return handlers[command](value)


if __name__ == '__main__':
    try:
        result = main()
        if result is not None:
            print(json.dumps(result, separators=(',', ':')))
    except ValueError as error:
        print(json.dumps({'error': str(error)}))
    except Exception as error:
        print(json.dumps({'error': 'Recording operation failed: %s' % str(error)[:300]}))
