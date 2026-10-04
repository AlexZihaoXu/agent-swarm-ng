import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test("an agent's todo list shows under the conversation header with counts, expands, and updates live", async ({
  page,
}) => {
  const agents = structuredClone(sampleAgents);
  agents[0]!.todos = [
    { content: 'Draft the release notes', status: 'completed' },
    { content: 'Check the changelog links', status: 'in_progress' },
    { content: 'Post the announcement', status: 'pending' },
    { content: 'Tag the release', status: 'pending' },
  ];
  await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/chat/agents/${agents[0]!.id}`);
  const conversation = page.getByRole('region', { name: `Conversation with ${agents[0]!.name}` });
  const toggle = conversation.getByRole('button', { name: /^Todos:/ });
  // Counts by icon: pending, in progress, done; and what it is working on.
  await expect(toggle).toHaveAccessibleName(
    'Todos: 2 pending, 1 in progress, 1 done. Working on: Check the changelog links',
  );
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const items = conversation.getByRole('list', { name: 'Todo items' }).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toHaveText('done: Draft the release notes');
  await page.screenshot({ path: '../.scratch/shots/agent-todos.png' });
  // A todo_write elsewhere arrives as an event.
  await page.evaluate(id => {
    (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({
      type: 'todos_updated',
      eventId: 'e1',
      runId: 'platform',
      agentId: id,
      channelId: 'platform',
      todos: [
        { content: 'Draft the release notes', status: 'completed' },
        { content: 'Check the changelog links', status: 'completed' },
        { content: 'Post the announcement', status: 'in_progress' },
        { content: 'Tag the release', status: 'pending' },
      ],
    });
  }, agents[0]!.id);
  await expect(toggle).toHaveAccessibleName(
    'Todos: 1 pending, 1 in progress, 2 done. Working on: Post the announcement',
  );
  // An agent without a list shows nothing.
  await page.goto(`/chat/agents/${agents[1]!.id}`);
  await expect(
    page.getByRole('region', { name: `Conversation with ${agents[1]!.name}` }).getByRole('button', { name: /^Todos:/ }),
  ).toHaveCount(0);
});
