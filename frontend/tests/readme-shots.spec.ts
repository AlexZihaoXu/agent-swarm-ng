import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

// The README's screenshots (docs/images/), drawn from test-only mock data: never the live site, a real database or a
// real computer. Opt-in: README_SHOTS=1 bun run test:e2e tests/readme-shots.spec.ts (docs/development.md).
test.skip(!process.env.README_SHOTS, 'Set README_SHOTS=1 to regenerate the README screenshots.');
test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
  timezoneId: 'UTC',
});

const out = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A fixed afternoon, so the clock times in the pictures read naturally whenever they are regenerated.
const now = new Date(`${new Date().toISOString().slice(0, 10)}T14:32:00Z`).getTime();
const ago = (minutes: number) => now - minutes * MINUTE;

// ---- Agents and their chats -------------------------------------------------------------------------------------

const people = [
  ['avery', 'Avery', 'Branch `ci/faster-nightly` is up. Draft notes attached.', 2],
  ['nova', 'Nova', 'The vendor comparison is in the Launch crew chat.', 9],
  ['aether', 'Aether', 'Claude Code on Design studio is on step 4 of 6.', 26],
  ['morgan', 'Morgan', 'Weekly backup finished: 42 GB, verified.', 75],
  ['quinn', 'Quinn', 'Onboarding guide translated into French and Spanish.', 180],
  ['riley', 'Riley', 'Reminder set for Friday 9:00: quarterly review.', 1440],
] as const;

const template = sampleAgents[0]!;
const message = (channelId: string, index: number, role: 'user' | 'assistant', text: string, minutes: number) => ({
  id: `${channelId}-${index}`,
  sequence: index + 1,
  channelId,
  role,
  text,
  replyTo: null,
  timestamp: ago(minutes),
});
const agents = people.map(([id, name, last, minutes]) => ({
  ...structuredClone(template),
  id,
  name,
  channelId: id,
  endpointId: 'provider:openai-codex',
  model: 'gpt-5.5',
  thinkingLevel: 'medium' as const,
  createdAt: ago(60 * 24 * 30),
  lastMessage: message(id, 9, 'assistant', last, minutes),
  todos: [] as { content: string; status: 'pending' | 'in_progress' | 'completed' }[],
  instructions: '',
}));
const avery = agents[0]!;
avery.todos = [
  { content: 'Find what slowed the nightly build', status: 'completed' },
  { content: 'Fix the cache key and the duplicate test run', status: 'completed' },
  { content: 'Run the full suite on Build server', status: 'in_progress' },
  { content: 'Open a pull request with short release notes', status: 'pending' },
];
avery.instructions = [
  'You are Avery, the team’s build and release engineer.',
  '',
  '- Keep CI fast and green; explain regressions with numbers.',
  '- Work on Build server; ask before touching production.',
  '- Release notes: short, user-facing, no internal jargon.',
].join('\n');

const file = (id: string, name: string, kind: 'image' | 'text', mime: string, size: number, minutes: number) => ({
  id,
  channelKey: 'chat:avery',
  name,
  mime,
  kind,
  size,
  status: 'available',
  uploader: { kind: 'agent', id: 'avery', name: 'Avery' },
  messageKind: 'chat',
  messageId: 'm',
  createdAt: new Date(ago(minutes)).toISOString(),
});

const averyChat = [
  message('avery', 0, 'user', 'Morning! The nightly build got really slow this week. Can you find out why?', 48),
  message('avery', 1, 'assistant', 'On it. I’ll compare this week’s CI logs with last week’s and report back.', 47),
  {
    ...message(
      'avery',
      2,
      'assistant',
      [
        'Found it. The nightly build went from **3m 40s** to **9m 12s** on Tuesday:',
        '',
        '1. The dependency cache key changed when `bun.lock` moved, so every run reinstalls from scratch',
        '2. Image tests now run twice, once in `test` and again in `e2e`',
        '3. The fonts layer rebuilds every time because it sits after `COPY . .`',
        '',
        'The cache fix is one line:',
        '',
        '```yaml',
        '- uses: actions/cache@v4',
        '  with:',
        '    path: ~/.bun/install/cache',
        "    key: bun-${{ runner.os }}-${{ hashFiles('**/bun.lock') }}",
        '```',
      ].join('\n'),
      31,
    ),
    files: [file('f-build-times', 'build-times.png', 'image', 'image/png', 48_213, 31)],
  },
  message('avery', 3, 'user', 'Nice catch! Go ahead with all three fixes, and keep the release notes short.', 12),
  {
    ...message(
      'avery',
      4,
      'assistant',
      'Branch `ci/faster-nightly` is up, and the draft notes are attached. I’m running the full suite on **Build server** now and will open the pull request when it passes.',
      2,
    ),
    files: [file('f-notes', 'release-notes.md', 'text', 'text/markdown', 1_284, 2)],
  },
];
const releaseNotes = [
  '## Faster nightly builds',
  '',
  '- Dependencies are cached again: installs take seconds, not minutes.',
  '- Image tests run once.',
  '- Docker builds reuse the fonts layer.',
  '',
  'Nightly build: 9m 12s → 3m 52s.',
].join('\n');

const reactions: Record<string, { emoji: string; count: number; mine: boolean }[]> = {
  'avery-2': [{ emoji: '🎉', count: 1, mine: true }],
  'g-3': [
    { emoji: '🚀', count: 2, mine: true },
    { emoji: '👀', count: 1, mine: false },
  ],
};

// ---- Group chat ---------------------------------------------------------------------------------------------------

const members = ['nova', 'avery', 'morgan', 'quinn'].map(id => {
  const agent = agents.find(item => item.id === id)!;
  return { id, name: agent.name, avatar: null, channelId: id };
});
const groupMessage = (index: number, author: string | null, text: string, minutes: number) => {
  const agent = agents.find(item => item.id === author);
  return {
    id: `g-${index}`,
    sequence: index + 1,
    groupId: 'launch',
    role: agent ? 'assistant' : 'user',
    authorId: agent?.id ?? null,
    authorName: agent?.name ?? 'You',
    authorAvatar: null,
    text,
    timestamp: ago(minutes),
    replyTo: null,
  };
};
const groupChat = [
  groupMessage(0, null, 'Launch is Thursday. Can each of you post where your part stands?', 40),
  groupMessage(
    1,
    'nova',
    'Landing page copy is final. The vendor comparison is in `pricing.md`, and I asked Quinn to check the translations.',
    38,
  ),
  groupMessage(2, 'quinn', 'French and Spanish are done. German comes back tomorrow morning.', 35),
  groupMessage(
    3,
    'morgan',
    [
      'Staging is green. Load test at 500 users:',
      '',
      '| Endpoint | p95 | Errors |',
      '| --- | --- | --- |',
      '| `/api/search` | 182 ms | 0 |',
      '| `/api/upload` | 410 ms | 0.1% |',
      '| `/api/export` | 655 ms | 0 |',
    ].join('\n'),
    21,
  ),
  groupMessage(
    4,
    'avery',
    'CI is fast again (3m 52s). I’ll tag the release candidate as soon as Morgan’s last check passes.',
    9,
  ),
  groupMessage(5, null, 'Perfect, thanks all. Nova, can you draft the announcement?', 1),
];
const group = {
  id: 'launch',
  name: 'Launch crew',
  createdAt: ago(60 * 24 * 7),
  members,
  lastMessage: groupChat.at(-1),
};

// ---- Computers ----------------------------------------------------------------------------------------------------

const GiB = 1024 ** 3;
const computers = [
  ['build', 'Build server', 162, 5.1, 8, 8],
  ['research', 'Research desk', 38, 2.6, 4, 6],
  ['design', 'Design studio', 71, 3.4, 4, 8],
  ['data', 'Data lab', 254, 11.2, 8, 16],
  ['sandbox', 'Sandbox', 6, 1.1, 2, 4],
  ['docs', 'Docs writer', 22, 1.8, 2, 4],
  ['mobile', 'Mobile QA', 118, 6.3, 6, 12],
  ['archive', 'Archive', 0, 0, 2, 4],
].map(([id, name, cpu, mem, cores, limit]) => ({
  id: id as string,
  name: name as string,
  organizationId: 'personal',
  state: id === 'archive' ? 'exited' : 'running',
  createdAt: ago(60 * 24 * 20),
  cpuPercent: id === 'archive' ? null : (cpu as number),
  memoryBytes: id === 'archive' ? null : (mem as number) * GiB,
  memoryLimitBytes: (limit as number) * GiB,
  cpuCount: cores as number,
  cpuCores: cores as number,
  memoryGiB: limit as number,
  timezone: 'UTC',
}));

/** Draws a plausible GNOME-like desktop (generic windows, no real logos) into a JPEG, in the page. */
async function desktops(page: Page) {
  return page.evaluate(count => {
    const W = 1280,
      H = 800;
    const mono = '"DejaVu Sans Mono", "Liberation Mono", monospace';
    const sans = '"Cantarell", "DejaVu Sans", "Liberation Sans", sans-serif';
    const walls = [
      ['#2b1640', '#77216f', '#e95420'],
      ['#0d2233', '#1d5c7a', '#5fb3a1'],
      ['#17142b', '#3c2f73', '#a76bd6'],
      ['#10241b', '#2f5d50', '#d2a93c'],
      ['#23170f', '#6e3b2a', '#e3a15a'],
      ['#0c1f2e', '#14532d', '#4ade80'],
      ['#2a0f1e', '#7a1f45', '#f472b6'],
    ];
    const results: string[] = [];
    for (let v = 0; v < count; v++) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d')!;
      const [a, b, c] = walls[v % walls.length]!;
      const layout = [0, 1, 2, 3, 4, 2, 1][v] ?? v % 5;
      const accent = ['#1a73e8', '#9141ac', '#2ec27e', '#e66100'][v % 4]!;
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, a!);
      bg.addColorStop(0.6, b!);
      bg.addColorStop(1, c!);
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 3; i++) {
        const x = ((v * 3 + i) * 397) % W,
          y = ((v * 5 + i) * 251) % H;
        const glow = g.createRadialGradient(x, y, 0, x, y, 420);
        glow.addColorStop(0, 'rgba(255,255,255,0.10)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
      }
      // Top bar and dock.
      g.fillStyle = '#111114';
      g.fillRect(0, 0, W, 28);
      g.fillStyle = '#e8e8e8';
      g.font = `600 13px ${sans}`;
      g.fillText('Activities', 14, 19);
      g.textAlign = 'center';
      g.fillText(`14:${31 - (v % 3)}`, W / 2, 19);
      g.textAlign = 'left';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(W - 20 - i * 22, 14, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(20,20,24,0.78)';
      g.fillRect(0, 28, 64, H - 28);
      const dock = ['#e95420', '#3584e4', '#2ec27e', '#f6d32d', '#9141ac', '#c0bfbc'];
      dock.forEach((color, i) => {
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(12, 48 + i * 56, 40, 40, 10);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(24, 62 + i * 56, 16, 3);
        g.fillRect(24, 69 + i * 56, 10, 3);
      });
      // Windows.
      const win = (x: number, y: number, w: number, h: number, title: string, body: string) => {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = 30;
        g.shadowOffsetY = 8;
        g.fillStyle = body;
        g.beginPath();
        g.roundRect(x, y, w, h, 12);
        g.fill();
        g.restore();
        g.save();
        g.beginPath();
        g.roundRect(x, y, w, h, 12);
        g.clip();
        g.fillStyle = '#2a2a2e';
        g.fillRect(x, y, w, 38);
        g.fillStyle = '#dededf';
        g.font = `600 13px ${sans}`;
        g.textAlign = 'center';
        g.fillText(title, x + w / 2, y + 24);
        g.textAlign = 'left';
        g.fillStyle = '#4a4a50';
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.arc(x + w - 20 - i * 26, y + 19, 9, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        return { x: x + 16, y: y + 62, w: w - 32, h: h - 70 };
      };
      const lines = (
        area: { x: number; y: number },
        rows: [string, string][][],
        size = 14,
        step = 21,
        numbered = false,
      ) => {
        g.font = `${size}px ${mono}`;
        rows.forEach((parts, row) => {
          let x = area.x;
          if (numbered) {
            g.fillStyle = '#5c6370';
            g.fillText(String(row + 1).padStart(2, ' '), x, area.y + row * step);
            x += 34;
          }
          for (const [text, color] of parts) {
            g.fillStyle = color;
            g.fillText(text, x, area.y + row * step);
            x += g.measureText(text).width;
          }
        });
      };
      const P = '#8ae234',
        D = '#d3d7cf',
        B = '#729fcf',
        Y = '#fce94f',
        K = '#c678dd',
        S = '#98c379',
        F = '#61afef',
        C = '#7f848e',
        O = '#d19a66';
      const prompt = (cmd: string): [string, string][] => [
        ['agent@computer', P],
        [':', D],
        ['~/app', B],
        ['$ ', D],
        [cmd, D],
      ];
      const editor = (area: { x: number; y: number }) =>
        lines(
          area,
          [
            [
              ['import ', K],
              ['{ test, expect } ', D],
              ['from ', K],
              ["'bun:test'", S],
              [';', D],
            ],
            [
              ['import ', K],
              ['{ buildCacheKey } ', D],
              ['from ', K],
              ["'./cache'", S],
              [';', D],
            ],
            [],
            [['// The key follows the lockfile, wherever it lives.', C]],
            [
              ['test', F],
              ['(', D],
              ["'cache key tracks bun.lock'", S],
              [', () => {', D],
            ],
            [
              ['  const ', K],
              ['key', D],
              [' = ', D],
              ['buildCacheKey', F],
              ['(', D],
              ["'linux'", S],
              [');', D],
            ],
            [
              ['  expect', F],
              ['(key).', D],
              ['toMatch', F],
              ['(', D],
              ['/^bun-linux-/', O],
              [');', D],
            ],
            [['});', D]],
            [],
            [
              ['export function ', K],
              ['retry', F],
              ['(times: ', D],
              ['number', O],
              [') {', D],
            ],
            [
              ['  return ', K],
              ['async ', K],
              ['(run: () => ', D],
              ['Promise', O],
              ['<void>) => {', D],
            ],
            [
              ['    for ', K],
              ['(let i = ', D],
              ['0', O],
              ['; i < times; i++) {', D],
            ],
            [
              ['      try ', K],
              ['{ ', D],
              ['return await ', K],
              ['run', F],
              ['(); }', D],
            ],
            [
              ['      catch ', K],
              ['{ ', D],
              ['await ', K],
              ['sleep', F],
              ['(', D],
              ['2 ', O],
              ['** i * ', D],
              ['100', O],
              ['); }', D],
            ],
            [['    }', D]],
            [['  };', D]],
            [['}', D]],
          ],
          14,
          22,
          true,
        );
      const page = (area: { x: number; y: number; w: number; h: number }, hue: string) => {
        g.fillStyle = '#ffffff';
        g.fillRect(area.x - 16, area.y - 24, area.w + 32, area.h + 32);
        g.fillStyle = '#f1f3f4';
        g.beginPath();
        g.roundRect(area.x, area.y - 14, area.w, 28, 14);
        g.fill();
        g.fillStyle = '#5f6368';
        g.font = `13px ${sans}`;
        g.fillText('docs.example.com/guide/getting-started', area.x + 16, area.y + 5);
        g.fillStyle = hue;
        g.fillRect(area.x, area.y + 36, area.w, 90);
        g.fillStyle = '#ffffff';
        g.font = `700 24px ${sans}`;
        g.fillText('Getting started', area.x + 24, area.y + 90);
        g.fillStyle = '#202124';
        g.font = `600 16px ${sans}`;
        g.fillText('Install', area.x, area.y + 160);
        g.fillStyle = '#c4c7c5';
        for (let i = 0; i < 6; i++) g.fillRect(area.x, area.y + 178 + i * 18, area.w * (0.92 - (i % 3) * 0.15), 9);
        const card = (area.w - 32) / 3;
        for (let i = 0; i < 3; i++) {
          g.fillStyle = '#eef1f6';
          g.beginPath();
          g.roundRect(area.x + i * (card + 16), area.y + 300, card, 110, 10);
          g.fill();
          g.fillStyle = hue;
          g.fillRect(area.x + i * (card + 16) + 16, area.y + 318, 28, 28);
          g.fillStyle = '#c4c7c5';
          g.fillRect(area.x + i * (card + 16) + 16, area.y + 362, card * 0.7, 8);
          g.fillRect(area.x + i * (card + 16) + 16, area.y + 378, card * 0.5, 8);
        }
      };
      if (layout === 0) {
        const t = win(110, 70, 720, 470, 'agent@computer: ~/app', '#1e1e24');
        lines(t, [
          prompt('bun test'),
          [['bun test v1.3.6', C]],
          [],
          [['src/cache.test.ts:', D]],
          [
            ['✓ ', P],
            ['cache key tracks bun.lock ', D],
            ['[0.41ms]', C],
          ],
          [
            ['✓ ', P],
            ['restores the install cache ', D],
            ['[12.08ms]', C],
          ],
          [['src/build.test.ts:', D]],
          [
            ['✓ ', P],
            ['fonts layer is reused ', D],
            ['[3.12ms]', C],
          ],
          [
            ['✓ ', P],
            ['images are tested once ', D],
            ['[88.40ms]', C],
          ],
          [],
          [[' 214 pass', P]],
          [['   0 fail', D]],
          [
            ['Ran 214 tests across 38 files. ', D],
            ['[3.52s]', C],
          ],
          prompt('git push -u origin ci/faster-nightly'),
          [['█', D]],
        ]);
        const e = win(560, 330, 660, 430, 'cache.test.ts — app', '#21252b');
        editor(e);
      } else if (layout === 1) {
        const p = win(100, 56, 860, 600, 'Getting started — Web Browser', '#ffffff');
        page(p, accent);
        const t = win(760, 440, 480, 320, 'agent@computer: ~/notes', '#1e1e24');
        lines(t, [
          prompt('ls sources/'),
          [
            ['comparison.md  ', D],
            ['pricing.csv  ', B],
            ['vendors/', B],
          ],
          prompt('wc -l comparison.md'),
          [['128 comparison.md', D]],
          prompt(''),
        ]);
      } else if (layout === 2) {
        const e = win(90, 50, 700, 560, 'retry.ts — studio', '#21252b');
        editor(e);
        const p = win(640, 220, 600, 540, 'localhost:5173 — Preview', '#ffffff');
        page(p, accent);
      } else if (layout === 3) {
        const t = win(90, 60, 1120, 300, 'agent@computer: ~/analysis', '#1e1e24');
        lines(t, [
          prompt('python train.py --epochs 40'),
          [['epoch 37/40  loss 0.1842  val_loss 0.2107  acc 0.9431', D]],
          [['epoch 38/40  loss 0.1801  val_loss 0.2093  acc 0.9447', D]],
          [['epoch 39/40  loss 0.1779  val_loss 0.2088  acc 0.9452', D]],
          [
            ['epoch 40/40  loss 0.1760  val_loss 0.2081  acc ', D],
            ['0.9460', P],
          ],
          [
            ['saved ', D],
            ['models/run-12.ckpt', B],
          ],
        ]);
        const chart = win(330, 330, 820, 430, 'Loss — Notebook', '#ffffff');
        g.strokeStyle = '#e0e0e0';
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.moveTo(chart.x, chart.y + i * 70);
          g.lineTo(chart.x + chart.w, chart.y + i * 70);
          g.stroke();
        }
        for (const [color, lift] of [
          ['#1a73e8', 0],
          ['#e8710a', 26],
        ] as const) {
          g.strokeStyle = color;
          g.lineWidth = 3;
          g.beginPath();
          for (let x = 0; x <= chart.w; x += 8) {
            const y = chart.y + 20 + lift + 250 * Math.exp(-x / 160) + 6 * Math.sin(x / 23);
            if (x === 0) g.moveTo(chart.x + x, y);
            else g.lineTo(chart.x + x, y);
          }
          g.stroke();
        }
        g.lineWidth = 1;
      } else {
        const f = win(120, 70, 760, 500, 'Files — Home', '#242428');
        g.fillStyle = '#1d1d20';
        g.fillRect(f.x - 16, f.y - 24, 170, f.h + 32);
        g.font = `13px ${sans}`;
        ['Recent', 'Home', 'Documents', 'Downloads', 'Pictures', 'Projects'].forEach((label, i) => {
          g.fillStyle = i === 1 ? '#3584e4' : '#bdbdc2';
          g.fillText(label, f.x + 6, f.y + 6 + i * 30);
        });
        ['Documents', 'Downloads', 'Projects', 'Pictures', 'notes.txt', 'data.csv', 'report.pdf', 'sketch.png'].forEach(
          (label, i) => {
            const x = f.x + 190 + (i % 4) * 130,
              y = f.y + (i < 4 ? 0 : 140);
            g.fillStyle = i < 4 ? '#5e9ee8' : '#d0d0d4';
            g.beginPath();
            g.roundRect(x + 20, y, 64, i < 4 ? 50 : 70, 6);
            g.fill();
            g.fillStyle = '#dededf';
            g.textAlign = 'center';
            g.fillText(label, x + 52, y + 96);
            g.textAlign = 'left';
          },
        );
        const t = win(640, 420, 560, 320, 'agent@computer: ~', '#1e1e24');
        lines(t, [
          prompt('df -h /home'),
          [['Filesystem  Size  Used Avail Use% Mounted on', D]],
          [['keep         40G  6.2G   34G  16% /home', D]],
          prompt('uptime'),
          [[' 10:40:12 up 3 days,  2:14,  load average: 0.08, 0.12, 0.10', D]],
          prompt(''),
        ]);
      }
      results.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]!);
    }
    return results;
  }, computers.length);
}

/** A small chart of nightly build times, attached to Avery's message. */
async function buildTimesPng(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, 960, 540);
    g.fillStyle = '#e6e6e6';
    g.font = '600 26px "DejaVu Sans", sans-serif';
    g.fillText('Nightly build time (minutes)', 48, 64);
    const days = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
    const values = [3.6, 3.7, 3.5, 3.8, 3.6, 3.7, 9.2, 9.1, 3.9];
    g.strokeStyle = '#2b2f38';
    g.font = '18px "DejaVu Sans", sans-serif';
    for (let i = 0; i <= 10; i += 2) {
      const y = 470 - i * 36;
      g.beginPath();
      g.moveTo(80, y);
      g.lineTo(920, y);
      g.stroke();
      g.fillStyle = '#8a8f98';
      g.fillText(String(i), 44, y + 6);
    }
    values.forEach((value, i) => {
      const x = 104 + i * 92;
      g.fillStyle = value > 8 ? '#f07167' : i === values.length - 1 ? '#5fd38d' : '#5b8def';
      g.beginPath();
      g.roundRect(x, 470 - value * 36, 56, value * 36, [8, 8, 0, 0]);
      g.fill();
      g.fillStyle = '#8a8f98';
      g.fillText(days[i]!, x + 8, 500);
    });
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
}

// ---- Dashboard ----------------------------------------------------------------------------------------------------

function dashboardSample() {
  const BUCKET = 30 * MINUTE;
  const to = Math.ceil(now / BUCKET) * BUCKET;
  const buckets = Array.from({ length: 96 }, (_, i) => to - 48 * HOUR + i * BUCKET);
  const wave = (base: number, amp: number, phase = 0) =>
    buckets.map((_, i) => Math.max(0, base + amp * Math.sin(i / 6 + phase) + (amp / 3) * Math.sin(i / 1.7 + phase)));
  const tokens = (scale: number, phase: number) => ({
    input: wave(4000 * scale, 3000 * scale, phase),
    output: wave(800 * scale, 600 * scale, phase),
    cacheRead: wave(90000 * scale, 40000 * scale, phase),
    cacheWrite: buckets.map(() => 0),
    reasoning: wave(200 * scale, 150 * scale, phase),
  });
  const agent = (id: string, name: string, scale: number, phase: number, cost: number) => ({
    id,
    name,
    activeMs: scale * 6 * HOUR,
    active: buckets.map((_, i) => ((i + phase * 3) % 4 === 0 ? scale * 25 * MINUTE : (i % 7) * scale * MINUTE)),
    tokens: tokens(scale, phase),
    tokenTotals: {
      input: 384000 * scale,
      output: 76800 * scale,
      cacheRead: 8640000 * scale,
      cacheWrite: 0,
      reasoning: 19200 * scale,
    },
    cost,
  });
  return {
    range: '48h',
    from: new Date(to - 48 * HOUR).toISOString(),
    to: new Date(to).toISOString(),
    bucketMs: BUCKET,
    buckets,
    system: {
      cpuPercent: wave(32, 14),
      memUsed: wave(22e9, 4e9),
      memTotal: 64e9,
      netRx: wave(2e6, 1e6),
      netTx: wave(5e5, 2e5),
    },
    diskIo: [
      { device: 'nvme0n1', label: 'nvme0n1 · NVMe SSD · 1 TB', read: wave(4e6, 2e6), write: wave(1e6, 5e5, 1) },
      { device: 'sda', label: 'sda · SATA SSD · 2 TB', read: wave(1e5, 5e4, 2), write: wave(2e5, 1e5, 3) },
    ],
    disks: [
      {
        disk: '/dev/nvme0n1p2',
        label: 'nvme0n1p2',
        uses: ['docker', 'platform data'],
        used: wave(410e9, 2e9),
        total: 980e9,
      },
      { disk: 'tank', label: 'tank (ZFS)', uses: ['listed'], used: wave(1.1e12, 4e9), total: 1.9e12 },
    ],
    computers: computers.slice(0, 4).map((computer, i) => ({
      id: computer.id,
      name: computer.name,
      cpuPercent: wave(25 - i * 4, 12, i),
      memUsed: wave(2.5e9, 6e8, i),
      memPercent: wave(45 - i * 6, 10, i),
      memLimit: computer.memoryLimitBytes,
    })),
    agents: [
      agent('avery', 'Avery', 1, 0, 12.5),
      agent('nova', 'Nova', 0.7, 1, 8.2),
      agent('aether', 'Aether', 0.5, 2, 5.9),
      agent('morgan', 'Morgan', 0.3, 3, 2.4),
    ],
    providers: [
      {
        provider: 'openai-codex',
        label: 'openai-codex',
        subscription: true,
        priced: true,
        cost: wave(0.12, 0.08),
        total: 19.6,
      },
      {
        provider: 'openrouter',
        label: 'openrouter',
        subscription: false,
        priced: true,
        cost: wave(0.05, 0.03, 2),
        total: 9.4,
      },
    ],
  };
}

function liveSample() {
  const at = Date.now();
  return {
    intervalMs: 250,
    cores: 16,
    devices: [
      { device: 'nvme0n1', label: 'nvme0n1 · NVMe SSD · 1 TB' },
      { device: 'sda', label: 'sda · SATA SSD · 2 TB' },
    ],
    points: Array.from({ length: 240 }, (_, i) => ({
      t: at - (240 - i) * 250,
      cpuPercent: 24 + 8 * Math.sin(i / 9) + (i % 5),
      memUsed: 22e9 + 1e8 * Math.sin(i / 20),
      memTotal: 64e9,
      netRx: 1.5e6 + 8e5 * Math.sin(i / 7),
      netTx: 3e5 + 1e5 * Math.sin(i / 5),
      disks: {
        nvme0n1: { read: 3e6 + 2e6 * Math.sin(i / 11), write: 1e6 + 5e5 * Math.sin(i / 6) },
        sda: { read: 1e5, write: 5e4 + 3e4 * Math.sin(i / 8) },
      },
    })),
  };
}

// ---- Shared mocks -------------------------------------------------------------------------------------------------

async function mockAll(page: Page) {
  const scratch = await page.context().newPage();
  await scratch.goto('about:blank');
  const [shots, chart] = await Promise.all([desktops(scratch), buildTimesPng(scratch)]);
  await scratch.close();
  const history: Record<string, object[]> = Object.fromEntries(agents.map(agent => [agent.id, [agent.lastMessage]]));
  history.avery = averyChat;
  history.nova = [
    message('nova', 0, 'user', 'Could you compare the three vendor proposals for the launch?', 15),
    message('nova', 1, 'assistant', agents[1]!.lastMessage.text, 9),
  ];
  await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents, nextCursor: null } }));
  await page.route('**/api/channels/*/messages*', route => {
    const channel = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]!);
    return route.fulfill({ json: { messages: history[channel] ?? [], nextCursor: null } });
  });
  await page.route('**/api/chats/*/reactions*', route =>
    route.fulfill({
      json: {
        messages: new URL(route.request().url()).searchParams
          .getAll('ids')
          .map(id => ({ id, reactions: reactions[id] ?? [] })),
      },
    }),
  );
  await page.route(/\/api\/files\/[^/]+\/content(\?.*)?$/, route =>
    route.fulfill({ body: Buffer.from(chart, 'base64'), contentType: 'image/png' }),
  );
  await page.route(/\/api\/files\/[^/]+\/text(\?.*)?$/, route =>
    route.fulfill({
      json: {
        text: releaseNotes,
        offset: 1,
        lines: releaseNotes.split('\n').length,
        totalLines: releaseNotes.split('\n').length,
        truncated: false,
        partialLine: false,
        nextOffset: null,
        prevOffset: null,
        previewLimited: false,
      },
    }),
  );
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/launch', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/launch/messages*', route =>
    route.fulfill({ json: { messages: groupChat, nextCursor: null } }),
  );
  await page.route(/\/api\/organizations$/, route =>
    route.fulfill({
      json: {
        organizations: [
          {
            id: 'personal',
            name: 'Personal',
            createdAt: '2030-01-01T00:00:00.000Z',
            agents: 6,
            computers: 8,
            groups: 1,
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/providers\/openai-codex(?:\/login)?(?:\?.*)?$/, route =>
    route.fulfill({ json: { connected: true, models: ['gpt-5.5', 'gpt-5.5-mini'], login: { state: 'idle' } } }),
  );
  await page.route('**/api/agents/model-capabilities*', route =>
    route.fulfill({ json: { thinkingLevels: ['off', 'low', 'medium', 'high'], reasoning: true } }),
  );
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers, controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route =>
    route.fulfill({ json: { holders: [{ computerId: 'build', agent: { id: 'avery', name: 'Avery' } }], readers: [] } }),
  );
  await page.route('**/api/computers/*/preview*', route => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    const index = Math.max(
      0,
      computers.findIndex(item => item.id === id),
    );
    return route.fulfill({ body: Buffer.from(shots[index]!, 'base64'), contentType: 'image/jpeg' });
  });
  await page.route('**/api/dashboard**', route => route.fulfill({ json: dashboardSample() }));
  await page.route('**/api/dashboard/live/stream', route => {
    const live = liveSample();
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'snapshot', ...live })}\n${JSON.stringify({ type: 'point', point: live.points.at(-1) })}\n`,
    });
  });
  await page.route('**/api/files/find**', route =>
    route.fulfill({
      json: {
        files: [
          { id: 'f-notes', name: 'release-notes.md', channelKey: 'chat:avery', kind: 'text', size: 1284 },
          { id: 'f-build-times', name: 'build-times.png', channelKey: 'chat:avery', kind: 'image', size: 48213 },
        ],
        scratch: [],
      },
    }),
  );
  // Avery is typing its next message in its private chat; Nova is working on the group's last message.
  await page.addInitScript(() => {
    Object.assign(window, {
      agentRunSnapshot: [
        {
          agentId: 'avery',
          channelId: 'avery',
          runId: 'run-a',
          clientMessageId: 'avery-3',
          typing: true,
          typingTargets: ['avery'],
        },
        {
          agentId: 'nova',
          channelId: 'nova',
          runId: 'run-n',
          clientMessageId: 'g-5',
          typing: false,
          typingTargets: [],
        },
      ],
    });
  });
}

/** Screenshots the page and stores it as WebP (encoded by the browser) in docs/images/. */
async function save(page: Page, name: string, clipHeight?: number, quality = 0.9) {
  await page.mouse.move(-10, -10).catch(() => undefined);
  await page.waitForTimeout(800);
  const width = page.viewportSize()!.width;
  const clip = clipHeight ? { x: 0, y: 0, width, height: clipHeight } : undefined;
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', clip });
  const webp = await page.evaluate(
    async ({ data, quality }) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      const out = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { data: png.toString('base64'), quality },
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}${name}.webp`, Buffer.from(webp, 'base64'));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(now);
  await mockAll(page);
});

/** Waits for the attached image, then scrolls the conversation to its newest message. */
async function settleConversation(page: Page) {
  await expect(page.getByText('is typing…')).toBeVisible();
  const image = page.locator('img[src*="/api/files/"]').first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete)).toBe(true);
  await page.waitForTimeout(400);
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  if (await jump.isVisible()) await jump.click();
  await expect(jump).toHaveCount(0);
}

test('chat', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('button', { name: /^Todos:/ })).toBeVisible();
  await settleConversation(page);
  await save(page, 'chat');
});

test('group chat', async ({ page }) => {
  await page.goto('/chat/groups/launch');
  await expect(page.getByText('Nova is working…')).toBeVisible();
  await save(page, 'group-chat');
});

test('agent settings', async ({ page }) => {
  await page.goto('/agents/avery');
  await expect(page.getByRole('combobox', { name: 'Agent' })).toContainText('Avery');
  await page
    .getByRole('link', { name: 'Model' })
    .or(page.getByRole('button', { name: 'Model', exact: true }))
    .first()
    .click();
  await save(page, 'agent-settings');
});

test('computers', async ({ page }) => {
  await page.goto('/computers');
  await expect(page.getByTestId('computer-preview')).toHaveCount(computers.length);
  await expect(page.getByText('Loading preview…')).toHaveCount(0);
  const last = (await page.getByTestId('computer-preview').last().locator('xpath=../..').boundingBox())!;
  await save(page, 'computers', Math.min(900, Math.ceil(last.y + last.height + 32)));
});

test('dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
  await expect(page.locator('.recharts-area-area').first()).toBeVisible();
  await save(page, 'dashboard');
});

test('portal', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  await settleConversation(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('build');
  await save(page, 'portal');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test('phone chat list', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open group chat Launch crew' })).toBeVisible();
    await save(page, 'phone');
  });

  test('phone conversation', async ({ page }) => {
    await page.goto('/chat/agents/avery');
    await settleConversation(page);
    await save(page, 'phone-chat');
  });
});
