import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import type { PlatformStore } from './platform-store';
import { classify } from './tool-access';

/**
 * An agent's todo list (docs/agent-todos.md): written whole by todo_write, kept on the agent, shown live in the
 * dashboard. Unfinished items make the platform check, when a turn ends, whether the agent should continue.
 */
export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];
export type Todo = { content: string; status: TodoStatus };
export const TODO_MAX = 30;
export const TODO_TEXT_MAX = 200;

export class TodoError extends Error {}

/** A stored list, tolerating anything malformed (it reads as empty). */
export function parseTodos(text: string | null | undefined): Todo[] {
  try {
    const value: unknown = JSON.parse(text || '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is Todo =>
              Boolean(item) &&
              typeof item.content === 'string' &&
              (TODO_STATUSES as readonly string[]).includes(item.status),
          )
          .slice(0, TODO_MAX)
      : [];
  } catch {
    return [];
  }
}
export const openTodos = (todos: Todo[]) => todos.filter(todo => todo.status !== 'completed');
/** The list as the agent and its checker read it: one line per item. */
export const todoLines = (todos: Todo[]) =>
  todos
    .map(
      (todo, i) =>
        `${i + 1}. [${todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' '}] ${todo.content}`,
    )
    .join('\n');

export class Todos {
  constructor(
    private readonly database: PlatformStore,
    /** Tells dashboards the list changed (agent-runs broadcast). */
    private readonly changed: (agentId: string, todos: Todo[]) => void = () => {},
  ) {}

  async get(agentId: string) {
    await this.database.initialize();
    const row = await this.database.client.agent.findUnique({ where: { id: agentId }, select: { todos: true } });
    return parseTodos(row?.todos);
  }

  async set(agentId: string, input: Todo[]) {
    if (input.length > TODO_MAX) throw new TodoError(`At most ${TODO_MAX} items.`);
    const todos = input.map(item => ({ content: item.content.replace(/\s+/g, ' ').trim(), status: item.status }));
    if (todos.some(todo => !todo.content)) throw new TodoError('Every item needs some text.');
    if (todos.some(todo => todo.content.length > TODO_TEXT_MAX))
      throw new TodoError(`An item is at most ${TODO_TEXT_MAX} characters.`);
    if (todos.filter(todo => todo.status === 'in_progress').length > 1)
      throw new TodoError('Mark only one item in_progress at a time.');
    await this.database.initialize();
    await this.database.client.agent.update({ where: { id: agentId }, data: { todos: JSON.stringify(todos) } });
    this.changed(agentId, todos);
    return todos;
  }
}

export function createTodoTools(todos: Todos, agentId: string) {
  return classify({ todo_write: 'w' }, [
    defineTool({
      name: 'todo_write',
      label: 'Todo list',
      description: `Your todo list for multi-step work, replaced whole on every call (at most ${TODO_MAX} items of up to ${TODO_TEXT_MAX} characters). Each item: content, status "pending", "in_progress" (one at a time, the one you are on) or "completed". Mark items as you go, not all at the end; drop items that no longer apply; send [] to clear it. Your owner sees it live in the dashboard. While items are unfinished, the platform checks when your turn ends whether you should keep going.`,
      parameters: Type.Object(
        {
          todos: Type.Array(
            Type.Object(
              {
                content: Type.String({ minLength: 1, maxLength: TODO_TEXT_MAX }),
                status: Type.Union(TODO_STATUSES.map(status => Type.Literal(status))),
              },
              { additionalProperties: false },
            ),
            { maxItems: TODO_MAX },
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id, { todos: input }) {
        const saved = await todos.set(agentId, input as Todo[]);
        const open = openTodos(saved).length;
        const text = saved.length
          ? `Todo list saved (${saved.length - open}/${saved.length} completed):\n${todoLines(saved)}`
          : 'Todo list cleared.';
        return { content: [{ type: 'text' as const, text }], details: { todos: saved } };
      },
    }),
  ]);
}

/** The system prompt's section when todo_write is granted; the Discord line only for agents with a bot. */
export function todoGuidance(discord: boolean) {
  return `## Todo list
For work with several steps, keep a todo list with todo_write: write it when you start, mark one item in_progress while you work on it and completed as soon as it is done (not in a batch at the end), add what you discover, drop what no longer applies. Skip it for one-step requests. Your owner sees it live.
While items are unfinished, the platform checks when your turn ends whether you should keep going: a short read-only review of your own work. If it finds work left that you can do now, you continue with its note (a platform note, not a human message). Waiting is fine: if you are blocked on something that will wake you (a timer, a watch or monitor, a reply you asked for), say so in the list and end your turn.${
    discord
      ? `
Your todo list is a good subject for your Discord custom status (discord_set_status), e.g. "Writing the release notes (2/5)", when your owner set nothing else and nothing more important should be shown there. Everyone on Discord sees it: never put private or sensitive details in it (names of people, credentials, private project or customer details, anything from a private chat).`
      : ''
  }`;
}
