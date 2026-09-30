import { test, expect, type Page } from './fixtures';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const file = (id: string, name: string, kind: 'image' | 'text' | 'pdf' | 'other', extra: object = {}) => ({
  id,
  channelKey: 'chat:avery',
  name,
  mime: kind === 'image' ? 'image/png' : kind === 'text' ? 'text/plain' : 'application/octet-stream',
  kind,
  size: 2048,
  status: 'available',
  uploader: { kind: 'human', id: null, name: 'You' },
  messageKind: 'chat',
  messageId: 'm',
  createdAt: '2026-09-29T12:00:00.000Z',
  ...extra,
});
const usage = {
  bytes: 6144,
  budgetBytes: 10 * 1024 ** 3,
  files: 3,
  maxFileBytes: 100 * 1024 ** 2,
  warning: false,
  full: false,
};

async function mockFileContent(page: Page) {
  await page.route(/\/api\/files\/[^/]+\/content(\?.*)?$/, route =>
    route.fulfill({ body: png, contentType: 'image/png' }),
  );
  await page.route(/\/api\/files\/[^/]+\/text(\?.*)?$/, route =>
    route.fulfill({
      json: {
        text: 'def plan():\n    return "ship"\n',
        offset: 1,
        lines: 2,
        totalLines: 2,
        truncated: false,
        partialLine: false,
        nextOffset: null,
        prevOffset: null,
        previewLimited: false,
      },
    }),
  );
}

test('files attach from the composer, upload with progress, and send with or without text', async ({ page }) => {
  await mockFileContent(page);
  const uploads: string[] = [];
  await page.route(/\/api\/files\?.*$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const name = new URL(route.request().url()).searchParams.get('name')!;
    uploads.push(name);
    await route.fulfill({
      status: 201,
      json: file(`f-${name}`, name, name.endsWith('.png') ? 'image' : 'text', { messageKind: null, messageId: null }),
    });
  });
  const sent: { fileIds?: string[]; message: string }[] = [];
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const message = {
      id: body.clientMessageId,
      channelId: 'avery',
      sequence: 99,
      role: 'user',
      text: body.message,
      timestamp: Date.now(),
      replyTo: null,
      files: (body.fileIds ?? []).map((id: string) =>
        file(id, id.slice(2), id.endsWith('.png') ? 'image' : 'text', { messageId: body.clientMessageId }),
      ),
    };
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'user_message', ...message })}\n${JSON.stringify({ type: 'done' })}\n`,
    });
  });
  await page.goto('/chat/agents/avery');
  const composer = page.getByRole('form', { name: 'Message composer' });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await composer.locator('input[type="file"]').setInputFiles([
    { name: 'shot.png', mimeType: 'image/png', buffer: png },
    { name: 'plan.py', mimeType: 'text/x-python', buffer: Buffer.from('def plan():\n') },
  ]);
  const pending = composer.getByRole('list', { name: 'Files to send' });
  await expect(pending.getByRole('listitem')).toHaveCount(2);
  await expect(pending).toContainText('shot.png');
  // An image shows a preview beside its name; other files keep the file icon.
  const preview = pending.getByRole('listitem').filter({ hasText: 'shot.png' }).locator('img');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('complete', true);
  await expect(pending.getByRole('listitem').filter({ hasText: 'plan.py' }).locator('img')).toHaveCount(0);
  // No text is needed: files alone make a message.
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ message: '', fileIds: ['f-shot.png', 'f-plan.py'] });
  expect(uploads).toEqual(['shot.png', 'plan.py']);
  await expect(pending).toHaveCount(0);
  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.getByRole('img', { name: 'shot.png' })).toBeVisible();
  await expect(messages.getByLabel('Preview of plan.py')).toContainText('return "ship"');
  await expect(messages.getByRole('link', { name: 'plan.py' })).toHaveAttribute(
    'href',
    '/api/files/f-plan.py/content?download=1',
  );
  // A removed attachment is not sent.
  await composer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await composer.getByRole('button', { name: 'Remove x.txt' }).click();
  await expect(composer.getByRole('list', { name: 'Files to send' })).toHaveCount(0);
});

test('other files link to a download, deleted ones show who deleted them, and the Files dialog deletes', async ({
  page,
}) => {
  await mockFileContent(page);
  const report = file('f-report', 'report.bin', 'other');
  const old = file('f-old', 'old.txt', 'text', {
    status: 'deleted',
    deleted: { by: { kind: 'agent', id: 'avery', name: 'Avery' }, at: '2026-09-29T13:00:00.000Z' },
  });
  await page.route('**/api/channels/avery/messages*', route =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 'with-files',
            channelId: 'avery',
            sequence: 1,
            role: 'assistant',
            text: 'Here is the report.',
            timestamp: Date.now(),
            replyTo: null,
            files: [report, old],
          },
        ],
        nextCursor: null,
      },
    }),
  );
  const listed: URL[] = [];
  const deleted: string[] = [];
  await page.route(/\/api\/files\?.*$/, route => {
    listed.push(new URL(route.request().url()));
    return route.fulfill({ json: { files: [report], totalBytes: 2048, usage } });
  });
  await page.route(/\/api\/files\/[^/?]+$/, route => {
    deleted.push(route.request().url());
    return route.fulfill({
      json: {
        ...report,
        status: 'deleted',
        deleted: { by: { kind: 'human', id: null, name: 'You' }, at: new Date().toISOString() },
      },
    });
  });
  await page.goto('/chat/agents/avery');
  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.getByRole('link', { name: 'report.bin' })).toHaveAttribute('download', 'report.bin');
  await expect(messages.getByText('Deleted by Avery')).toBeVisible();
  await expect(messages.getByRole('link', { name: 'old.txt' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Chat files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Files · Avery' });
  await expect(dialog.getByRole('row')).toHaveCount(2);
  expect(listed[0].searchParams.get('channelKey')).toBe('chat:avery');
  await dialog.getByRole('button', { name: 'Name' }).click();
  await expect.poll(() => listed.at(-1)?.searchParams.get('sort')).toBe('name');
  await dialog.getByLabel('Search files by name').fill('rep');
  await expect.poll(() => listed.at(-1)?.searchParams.get('query')).toBe('rep');
  await dialog.getByLabel('Select report.bin').check();
  await expect(dialog.getByText('1 of 1 selected')).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete 1' }).click();
  await page.getByRole('dialog', { name: 'Delete report.bin?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deleted).toEqual([expect.stringContaining('/api/files/f-report')]);
  // The live event swaps the bubble for its tombstone.
  await page.evaluate(
    file =>
      (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({
        type: 'file_deleted',
        eventId: 'e1',
        runId: 'platform',
        agentId: 'human',
        channelId: 'files:chat:avery',
        file,
      }),
    {
      ...report,
      status: 'deleted',
      deleted: { by: { kind: 'human', id: null, name: 'You' }, at: new Date().toISOString() },
    },
  );
  await page.keyboard.press('Escape');
  await expect(messages.getByText('Deleted by You')).toBeVisible();
  await expect(messages.getByRole('link', { name: 'report.bin' })).toHaveCount(0);
});

test('a presented scratch file shows live, marked as such, and refreshes when the agent writes', async ({ page }) => {
  let version = 1;
  await page.route(/\/api\/files\/live\/text(\?.*)?$/, route =>
    route.fulfill({
      json: {
        text: `# Draft v${version}\n`,
        offset: 1,
        lines: 1,
        totalLines: 1,
        truncated: false,
        partialLine: false,
        nextOffset: null,
        prevOffset: null,
        previewLimited: false,
      },
    }),
  );
  await page.route('**/api/channels/avery/messages*', route =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 'presented',
            channelId: 'avery',
            sequence: 1,
            role: 'assistant',
            text: 'Watch this draft.',
            timestamp: Date.now(),
            replyTo: null,
            files: [
              file('live', 'draft.md', 'text', {
                kind: 'scratch',
                uploader: { kind: 'agent', id: 'avery', name: 'Avery' },
                scratch: { agentId: 'avery', path: 'notes/draft.md' },
              }),
            ],
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto('/chat/agents/avery');
  const preview = page.getByLabel('Preview of draft.md');
  await expect(preview).toContainText('# Draft v1');
  await expect(page.getByRole('list', { name: 'Messages' }).getByText('Live', { exact: true })).toBeVisible();
  version = 2;
  await page.evaluate(() => {
    const emit = (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent;
    const event = { type: 'scratch_activity', eventId: crypto.randomUUID(), runId: 'platform', agentId: 'avery' };
    emit({ ...event, channelId: 'scratch:avery', path: 'notes/draft.md', active: true });
    emit({ ...event, eventId: crypto.randomUUID(), channelId: 'scratch:avery', path: 'notes/draft.md', active: false });
  });
  await expect(preview).toContainText('# Draft v2');
});

test('a cut-off text preview fades out and says how much more there is', async ({ page }) => {
  const long = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  await page.route(/\/api\/files\/long\/text(\?.*)?$/, route => {
    const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
    const lines = long.slice(0, limit);
    return route.fulfill({
      json: {
        text: lines.join('\n') + '\n',
        offset: 1,
        lines: lines.length,
        totalLines: 40,
        truncated: false,
        partialLine: false,
        nextOffset: lines.length < 40 ? lines.length + 1 : null,
        prevOffset: null,
        previewLimited: false,
      },
    });
  });
  await page.route('**/api/channels/avery/messages*', route =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 'long-file',
            channelId: 'avery',
            sequence: 1,
            role: 'assistant',
            text: 'The log.',
            timestamp: Date.now(),
            replyTo: null,
            files: [file('long', 'log.txt', 'text')],
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto('/chat/agents/avery');
  const more = page.getByRole('button', { name: 'Show all 40 lines (28 more)' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByLabel('Preview of log.txt')).toContainText('line 40');
  await expect(more).toHaveCount(0);
});
