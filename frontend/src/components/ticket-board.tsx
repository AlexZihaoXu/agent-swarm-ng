import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createPortal } from 'react-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AssigneeAvatar } from '@/components/ticket-assignee';
import {
  BOARD_STATUSES,
  dueLabel,
  dueState,
  priorityOf,
  statusOf,
  type TicketPlace,
  type TicketStatus,
  type TicketSummary,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

type Columns = Record<TicketStatus, number[]>;
const COLUMN = 'column:';
const columnId = (status: TicketStatus) => `${COLUMN}${status}`;
/** Clicks right after a drop are the drop's own (a mouse released on its card, a Space key's keyup), not "open". */
const CLICK_AFTER_DROP_MS = 400;

const group = (tickets: TicketSummary[]) => {
  const columns = Object.fromEntries(BOARD_STATUSES.map(status => [status.key, [] as number[]])) as unknown as Columns;
  for (const ticket of tickets) columns[ticket.status]?.push(ticket.number);
  return columns;
};
const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');
function useReducedMotion() {
  return useSyncExternalStore(
    notify => {
      const query = reducedQuery();
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => reducedQuery().matches,
  );
}

export function Working() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-teal-300">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-300 motion-safe:animate-pulse" />
      working
    </span>
  );
}
export const isWorking = (ticket: TicketSummary, working: Set<string>) =>
  ticket.status === 'progress' && ticket.assignee?.kind === 'agent' && working.has(ticket.assignee.id);
export function Labels({ labels }: { labels: string[] }) {
  return labels.map(label => (
    <span key={label} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  ));
}

/**
 * A ticket's marks on a card or a list row (docs/tickets.md): "Blocked" while an open ticket blocks it, its
 * sub-issues done of all, and its due date (amber today, red once overdue).
 */
export function BoardMarks({ ticket, today }: { ticket: TicketSummary; today: string }) {
  const due = dueState(ticket.due, ticket.status, today);
  const { done, total } = ticket.subIssues;
  return (
    <>
      {ticket.blocked && (
        <span
          title="An open ticket blocks it"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-400/40 bg-red-400/10 px-1.5 text-[11px] font-medium text-red-300"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m5.7 5.7 12.6 12.6" />
          </svg>
          Blocked
        </span>
      )}
      {total > 0 && (
        <span
          title={`${done} of ${total} sub-issues done`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground',
            done === total && 'text-emerald-300',
          )}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 -rotate-90">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={`${(done / total) * 37.7} 37.7`}
            />
          </svg>
          {done}/{total}
          <span className="sr-only"> sub-issues done</span>
        </span>
      )}
      {ticket.due && (
        <span
          title={`Due ${ticket.due}${due === 'overdue' ? ' (overdue)' : ''}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground',
            due === 'today' && 'text-amber-300',
            due === 'overdue' && 'font-medium text-red-300',
          )}
        >
          <span className="sr-only">{due === 'overdue' ? 'Overdue, was due' : 'Due'} </span>
          {dueLabel(ticket.due, today)}
        </span>
      )}
    </>
  );
}

const cardClass =
  'flex w-full cursor-pointer touch-manipulation select-none flex-col gap-2 rounded-md border border-border bg-background p-3 text-left ao-raised outline-none transition-colors [-webkit-touch-callout:none] hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring';

function CardBody({
  ticket,
  agents,
  working,
  today,
}: {
  ticket: TicketSummary;
  agents: ChatAgent[];
  working: Set<string>;
  today: string;
}) {
  return (
    <>
      <span className="flex items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground">{ticket.key}</span>
        {ticket.priority !== 'none' && (
          <span className={priorityOf(ticket.priority).tone}>{priorityOf(ticket.priority).label}</span>
        )}
        {isWorking(ticket, working) && <Working />}
      </span>
      <span className="text-sm leading-snug [overflow-wrap:anywhere]">{ticket.title}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Labels labels={ticket.labels} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
          <BoardMarks ticket={ticket} today={today} />
          {ticket.links.length > 0 && (
            <span>
              {ticket.links.length} link{ticket.links.length === 1 ? '' : 's'}
            </span>
          )}
          <AssigneeAvatar assignee={ticket.assignee} agents={agents} />
          <span className="sr-only">{ticket.assignee ? `Assigned to ${ticket.assignee.name}` : 'Unassigned'}</span>
        </span>
      </span>
    </>
  );
}

/** A card: click (or Enter) opens it; dragging it (mouse, press-and-hold, or Space and the arrows) moves it. */
function SortableCard({
  ticket,
  reduced,
  onOpen,
  children,
}: {
  ticket: TicketSummary;
  reduced: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.number,
    transition: reduced ? null : { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription="draggable ticket"
        onClick={onOpen}
        className={cn(
          cardClass,
          // The spot it will land in: a dashed outline of the card, its text faded.
          isDragging && 'border-dashed border-primary/60 bg-primary/5 shadow-none [&>*]:opacity-30',
        )}
      >
        {children}
      </button>
    </li>
  );
}

function Column({
  status,
  count,
  active,
  children,
}: {
  status: TicketStatus;
  count: number;
  /** The dragged card is in this column now. */
  active: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: columnId(status) });
  const { label, dot } = statusOf(status);
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        'flex max-h-full w-[min(18rem,82vw)] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-sidebar/30 ao-card ring-2 ring-transparent transition-[box-shadow,background-color,border-color] duration-200 md:w-auto md:min-w-56 md:flex-1',
        active && 'border-primary/40 bg-primary/5 ring-primary/40',
      )}
    >
      <h3 className="flex shrink-0 items-center gap-2 p-3 text-sm font-semibold">
        <span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />
        {label}
        <span className="text-xs font-normal text-muted-foreground">{count}</span>
      </h3>
      <ScrollArea label={`${label} tickets`} className="min-h-0 flex-1">
        <ul className="flex min-h-12 flex-col gap-2 px-2 pb-2">{children}</ul>
      </ScrollArea>
    </section>
  );
}

/**
 * Kibo kanban (docs/tickets.md#dragging): one column per status, cards that open the ticket and drag (dnd-kit, as
 * Kibo's kanban) to another column or place. A drop shows at once and saves as the detail's status change plus a
 * place; a failure puts it back with a message. While a card is held the board keeps the order it had when picked up
 * (live changes land after the drop). Phones scroll the columns sideways; a press-and-hold picks a card up.
 */
export function Board({
  tickets,
  agents,
  working,
  today,
  onOpen,
  onMove,
}: {
  tickets: TicketSummary[];
  agents: ChatAgent[];
  working: Set<string>;
  /** Today in the viewer's time zone (YYYY-MM-DD): due dates before it are overdue. */
  today: string;
  onOpen: (ticket: TicketSummary) => void;
  onMove: (ticket: TicketSummary, status: TicketStatus, place: TicketPlace) => Promise<unknown>;
}) {
  const reduced = useReducedMotion();
  const live = useMemo(() => group(tickets), [tickets]);
  const byNumber = useMemo(() => new Map(tickets.map(ticket => [ticket.number, ticket])), [tickets]);
  const [drag, setDrag] = useState<{ number: number; from: TicketStatus; start: Columns; columns: Columns } | null>(
    null,
  );
  const [error, setError] = useState('');
  const dropped = useRef(0);
  const release = () => {
    dropped.current = Date.now();
    setDrag(null);
  };
  const [landed, setLanded] = useState<{ columns: Columns } | null>(null);
  const columns = drag?.columns ?? landed?.columns ?? live;
  // Kept for the announcements and the collision check, which dnd-kit calls outside React's render.
  const current = useRef(columns);
  current.current = columns;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      // Enter opens the ticket; Space picks it up.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter', 'Tab'] },
    }),
  );
  function columnOf(id: UniqueIdentifier | undefined, from = current.current): TicketStatus | undefined {
    if (typeof id === 'string' && id.startsWith(COLUMN)) return id.slice(COLUMN.length) as TicketStatus;
    return BOARD_STATUSES.find(status => from[status.key].includes(id as number))?.key;
  }
  // Up and down move within the column (dnd-kit's sortable keys); left and right go to the top of the next column.
  function keyboardCoordinates(...[event, args]: Parameters<KeyboardCoordinateGetter>) {
    const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
    if (!step) return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const { active, droppableRects } = args.context;
    const index = BOARD_STATUSES.findIndex(status => status.key === columnOf(active?.id));
    const next = BOARD_STATUSES[index + step]?.key;
    const column = next && droppableRects.get(columnId(next));
    if (!column) return undefined;
    const first = droppableRects.get(current.current[next][0] ?? '');
    return {
      x: column.left + (column.width - (args.context.collisionRect?.width ?? 0)) / 2,
      y: first ? first.top - 4 : column.top + 48,
    };
  }
  // Over a column, the card nearest the pointer in it (dnd-kit's multiple-containers recipe), else the column.
  const collision: CollisionDetection = args => {
    const pointer = pointerWithin(args);
    const hits = pointer.length ? pointer : rectIntersection(args);
    const over = getFirstCollision(hits, 'id');
    const status = typeof over === 'string' ? columnOf(over) : undefined;
    if (status && current.current[status].length) {
      const cards = new Set<UniqueIdentifier>(current.current[status]);
      const nearest = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(container => cards.has(container.id)),
      });
      if (nearest.length) return nearest;
    }
    return over === null ? [] : [{ id: over }];
  };

  const describe = (number: UniqueIdentifier) => {
    const ticket = byNumber.get(number as number);
    return ticket ? `${ticket.key} “${ticket.title}”` : 'The ticket';
  };
  const spot = (number: UniqueIdentifier) => {
    const status = columnOf(number);
    if (!status) return '';
    const items = current.current[status];
    return `${statusOf(status).label}, position ${items.indexOf(number as number) + 1} of ${items.length}`;
  };
  // Only a new spot is announced (dnd-kit reports every change of what the card is over).
  const announced = useRef('');
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      announced.current = spot(active.id);
      return `Picked up ${describe(active.id)} in ${announced.current}.`;
    },
    onDragOver: ({ active, over }) => {
      const now = over ? spot(active.id) : '';
      if (now === announced.current) return undefined;
      announced.current = now;
      return now ? `${describe(active.id)}: ${now}.` : `${describe(active.id)} is not over a column.`;
    },
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${describe(active.id)} in ${spot(active.id)}.` : `${describe(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Cancelled. ${describe(active.id)} was put back.`,
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const from = columnOf(active.id);
    const to = columnOf(over?.id);
    if (!over || !from || !to || from === to) return;
    setDrag(previous => {
      if (!previous) return previous;
      const target = previous.columns[to];
      const overIndex = target.indexOf(over.id as number);
      const translated = active.rect.current.translated;
      const below = overIndex >= 0 && translated && translated.top > over.rect.top + over.rect.height / 2;
      const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      const number = active.id as number;
      return {
        ...previous,
        columns: {
          ...previous.columns,
          [from]: previous.columns[from].filter(item => item !== number),
          [to]: [...target.slice(0, index), number, ...target.slice(index)],
        },
      };
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const held = drag;
    release();
    const status = held && over ? columnOf(active.id, held.columns) : undefined;
    if (!held || !status) return;
    let items = held.columns[status];
    const from = items.indexOf(held.number);
    const to = items.indexOf(over!.id as number);
    if (to >= 0 && to !== from) items = arrayMove(items, from, to);
    const index = items.indexOf(held.number);
    if (status === held.from && held.start[status].indexOf(held.number) === index) return;
    const ticket = byNumber.get(held.number);
    if (!ticket) return;
    setError('');
    // The board shows where it landed until the save answers (no frame of the old order under the drop animation).
    const token = { columns: { ...held.columns, [status]: items } };
    setLanded(token);
    onMove(ticket, status, { after: items[index - 1], before: items[index + 1] })
      .catch((failure: unknown) =>
        setError(
          `${ticket.key} could not be moved to ${statusOf(status).label}: ${(failure instanceof Error ? failure.message : 'the change was not saved').replace(/\.$/, '')}. It is back where it was.`,
        ),
      )
      .finally(() => setLanded(current => (current === token ? null : current)));
  };

  const held = drag ? byNumber.get(drag.number) : undefined;
  const dropAnimation: DropAnimation | null = reduced
    ? null
    : {
        duration: 220,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        sideEffects: defaultDropAnimationSideEffects({
          className: { dragOverlay: 'ticket-settling' },
          styles: { active: { opacity: '0' } },
        }),
      };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p
          role="alert"
          className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300 motion-safe:animate-[view-in_200ms_ease-out] md:mx-6"
        >
          <span className="flex-1">{error}</span>
          <button type="button" className="cursor-pointer text-xs underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'Press Enter to open the ticket. To move it, press Space, use the arrow keys to choose a column and place, then Space to drop it or Escape to cancel.',
          },
        }}
        onDragStart={({ active }) => {
          const number = active.id as number;
          const from = columnOf(number, columns);
          if (from) setDrag({ number, from, start: columns, columns });
        }}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={release}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)] md:snap-none md:px-6 md:pb-6',
            // Snapping would fight the auto-scroll near the edges while a card is held.
            drag && 'snap-none',
          )}
        >
          {BOARD_STATUSES.map(({ key }) => {
            const cards = columns[key].flatMap(number => byNumber.get(number) ?? []);
            return (
              <Column
                key={key}
                status={key}
                count={cards.length}
                active={Boolean(drag) && columnOf(drag?.number) === key}
              >
                <SortableContext items={cards.map(ticket => ticket.number)} strategy={verticalListSortingStrategy}>
                  {cards.map(ticket => (
                    <SortableCard
                      key={ticket.id}
                      ticket={ticket}
                      reduced={reduced}
                      onOpen={() => {
                        if (!drag && Date.now() - dropped.current > CLICK_AFTER_DROP_MS) onOpen(ticket);
                      }}
                    >
                      <CardBody ticket={ticket} agents={agents} working={working} today={today} />
                    </SortableCard>
                  ))}
                </SortableContext>
                {!cards.length && <li className="px-1 py-2 text-xs text-muted-foreground">Nothing here.</li>}
              </Column>
            );
          })}
        </div>
        {/* In the body, as Kibo's: a transformed ancestor (the tab's own transition) would offset a fixed overlay. */}
        {createPortal(
          <DragOverlay dropAnimation={dropAnimation} zIndex={60}>
            {held && (
              <div className={cn(cardClass, 'ticket-lift cursor-grabbing border-primary/50 ring-2 ring-primary/60')}>
                <CardBody ticket={held} agents={agents} working={working} today={today} />
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}
