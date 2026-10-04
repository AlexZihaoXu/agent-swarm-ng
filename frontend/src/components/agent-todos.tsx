import { useId, useState } from 'react';
import type { RealAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

type Todo = RealAgent['todos'][number];

function StatusIcon({ status, className }: { status: Todo['status']; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={cn(
        'size-3.5 shrink-0',
        status === 'completed'
          ? 'text-emerald-400'
          : status === 'in_progress'
            ? 'text-sky-400'
            : 'text-muted-foreground',
        className,
      )}
    >
      <circle cx="8" cy="8" r="6.2" />
      {status === 'in_progress' && <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4Z" fill="currentColor" stroke="none" />}
      {status === 'completed' && <path d="m5.2 8.2 1.9 1.9 3.8-4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

const LABELS: Record<Todo['status'], string> = { pending: 'pending', in_progress: 'in progress', completed: 'done' };

/**
 * The agent's todo list (docs/agent-todos.md), live, under the conversation header: shown only while it has one.
 * Collapsed, icons with counts (pending, in progress, done) and the item in progress; expanded, the items. Kibo
 * collapsible/card/collapsible-card-4 (Card with Badge) with checkbox/standard/checkbox-standard-5 (Todo Style)
 * rows, read-only: the list is the agent's.
 */
export function AgentTodos({ todos }: { todos: Todo[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!todos.length) return null;
  const count = (status: Todo['status']) => todos.filter(todo => todo.status === status).length;
  const current = todos.find(todo => todo.status === 'in_progress');
  const summary = (['pending', 'in_progress', 'completed'] as const)
    .map(status => `${count(status)} ${LABELS[status]}`)
    .join(', ');
  return (
    <div className="shrink-0 border-b border-border bg-sidebar/40 px-4 motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`Todos: ${summary}${current ? `. Working on: ${current.content}` : ''}`}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-8"
      >
        <span className="font-medium text-foreground">Todos</span>
        <span className="flex items-center gap-2.5 tabular-nums text-muted-foreground" aria-hidden="true">
          {(['pending', 'in_progress', 'completed'] as const).map(status => (
            <span key={status} className="flex items-center gap-1" title={`${count(status)} ${LABELS[status]}`}>
              <StatusIcon status={status} />
              {count(status)}
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" aria-hidden="true">
          {current?.content}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Expands smoothly (grid rows 0fr → 1fr); instant with reduced motion. */}
      <div
        id={`${id}-list`}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        inert={!open}
      >
        <ul className="min-h-0 space-y-1.5 overflow-hidden text-sm" aria-label="Todo items">
          {todos.map((todo, index) => (
            <li key={index} className={cn('flex items-start gap-2 last:pb-2.5')}>
              <StatusIcon status={todo.status} className="mt-0.5" />
              <span
                className={cn(
                  'min-w-0 break-words transition-all',
                  todo.status === 'completed' && 'text-muted-foreground line-through',
                  todo.status === 'in_progress' && 'font-medium',
                )}
              >
                <span className="sr-only">{LABELS[todo.status]}: </span>
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
