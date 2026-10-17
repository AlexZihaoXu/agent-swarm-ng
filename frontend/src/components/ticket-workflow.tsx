import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Popover from '@radix-ui/react-popover';
import { Button } from '@/components/ui/button';
import { ColorSwatches } from '@/components/ui/color-swatches';
import { GripIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { StateDot } from '@/components/ticket-board';
import { settingsInput } from '@/lib/styles';
import {
  CATEGORIES,
  STATE_COLORS,
  stateColor,
  useTicketBoard,
  useTicketStateActions,
  type BoardState,
  type StateCategory,
  type StateColorKey,
} from '@/lib/tickets';
import { cn } from '@/lib/utils';

/** Categories the board always keeps a state of (the backend refuses deleting the last one). */
const KEPT: StateCategory[] = ['unstarted', 'completed'];
const swatches = STATE_COLORS.map(color => ({ value: color.hex, label: color.label }));
/** Rows move up and down only. */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * Organization → Tickets → Workflow (docs/tickets.md#workflow): the board's states per category, as Kibo's item
 * group (item-layout-2: a row of media, content and actions, rows separated), with a grip to drag a state within its
 * category (dnd-kit, as the board; ↑/↓ on the grip too, like the fallback models' rows), its colour from a small
 * palette, its name, "Notify me" and Delete (which asks where its tickets go). Each change saves at once.
 */
export function TicketWorkflow({ card, organizationId }: { card: string; organizationId: string }) {
  const id = useId();
  const board = useTicketBoard(organizationId);
  const actions = useTicketStateActions(organizationId);
  const [states, setStates] = useState<BoardState[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<StateCategory | null>(null);
  const [deleting, setDeleting] = useState<BoardState | null>(null);
  useEffect(() => {
    if (board.data) setStates(board.data.states);
  }, [board.data]);
  const save = async (work: () => Promise<BoardState[]>, done = '') => {
    setBusy(true);
    setMessage('');
    try {
      setStates(await work());
      setMessage(done);
      return true;
    } catch (failure) {
      if (board.data) setStates(board.data.states);
      setMessage(failure instanceof Error ? failure.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const reorder = (state: BoardState, to: number) => {
    const peers = states.filter(item => item.category === state.category);
    const from = peers.findIndex(item => item.id === state.id);
    if (to < 0 || to >= peers.length || to === from) return;
    // Shown at once; the answer (or a failure) settles it.
    const moved = arrayMove(peers, from, to);
    setStates(current => [
      ...current.filter(item => CATEGORIES.findIndex(c => c.key === item.category) < categoryIndex(state.category)),
      ...moved,
      ...current.filter(item => CATEGORIES.findIndex(c => c.key === item.category) > categoryIndex(state.category)),
    ]);
    void save(() => actions.update(state.id, { position: to }), `Moved ${state.name}.`);
  };
  if (!board.data && board.isPending) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h4 id={`${id}-title`} className="text-base font-semibold">
          Workflow
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          The board's columns, each in a category the rules go by: agents never move a ticket into a completed or
          canceled state, and those count as closed for blockers, due reminders and archiving.
        </p>
      </div>
      <div className={cn(card, 'space-y-5')}>
        {CATEGORIES.map(category => {
          const rows = states.filter(state => state.category === category.key);
          const last = rows.length === 1 && KEPT.includes(category.key);
          return (
            <div key={category.key} role="group" aria-labelledby={`${id}-${category.key}`} className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h5 id={`${id}-${category.key}`} className="text-sm font-medium">
                    {category.label}
                  </h5>
                  <p className="text-xs text-muted-foreground">{category.hint}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 shrink-0 gap-1 text-xs sm:min-h-7"
                  disabled={busy}
                  aria-label={`Add a ${category.label.toLowerCase()} state`}
                  onClick={() => setAdding(category.key)}
                >
                  <PlusIcon className="size-3.5" />
                  Add
                </Button>
              </div>
              <StateRows
                rows={rows}
                busy={busy}
                last={last}
                onReorder={reorder}
                onRename={(state, name) => void save(() => actions.update(state.id, { name }), 'Saved.')}
                onColor={(state, color) => void save(() => actions.update(state.id, { color }), 'Saved.')}
                onNotify={(state, notifyOnEnter) =>
                  void save(
                    () => actions.update(state.id, { notifyOnEnter }),
                    notifyOnEnter ? `You are told when someone else moves a ticket to ${state.name}.` : 'Saved.',
                  )
                }
                onDelete={setDeleting}
              />
              {adding === category.key && (
                <AddState
                  category={category.label}
                  busy={busy}
                  onCancel={() => setAdding(null)}
                  onAdd={async name => {
                    if (await save(() => actions.add({ name, category: category.key }), `Added ${name}.`))
                      setAdding(null);
                  }}
                />
              )}
            </div>
          );
        })}
        {message && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      <DeleteState
        state={deleting}
        states={states}
        onOpenChange={open => !open && setDeleting(null)}
        onDelete={async (state, moveTo) => {
          const next = await actions.remove(state.id, moveTo);
          setStates(next);
          setMessage(`Deleted ${state.name}.`);
        }}
      />
    </section>
  );
}
const categoryIndex = (category: StateCategory) => CATEGORIES.findIndex(item => item.key === category);

function StateRows({
  rows,
  busy,
  last,
  onReorder,
  onRename,
  onColor,
  onNotify,
  onDelete,
}: {
  rows: BoardState[];
  busy: boolean;
  /** Its only state, of a category the board keeps: not deletable. */
  last: boolean;
  onReorder: (state: BoardState, to: number) => void;
  onRename: (state: BoardState, name: string) => void;
  onColor: (state: BoardState, color: StateColorKey) => void;
  onNotify: (state: BoardState, notify: boolean) => void;
  onDelete: (state: BoardState) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const state = rows.find(row => row.id === active.id);
    const to = rows.findIndex(row => row.id === over?.id);
    if (state && to >= 0) onReorder(state, to);
  };
  if (!rows.length) return <p className="text-xs text-muted-foreground">No states.</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[vertical]} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map(row => row.id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {rows.map((state, index) => (
            <StateRow
              key={state.id}
              state={state}
              index={index}
              count={rows.length}
              busy={busy}
              deletable={!last}
              onMove={to => onReorder(state, to)}
              onRename={name => onRename(state, name)}
              onColor={color => onColor(state, color)}
              onNotify={notify => onNotify(state, notify)}
              onDelete={() => onDelete(state)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function StateRow({
  state,
  index,
  count,
  busy,
  deletable,
  onMove,
  onRename,
  onColor,
  onNotify,
  onDelete,
}: {
  state: BoardState;
  index: number;
  count: number;
  busy: boolean;
  deletable: boolean;
  onMove: (to: number) => void;
  onRename: (name: string) => void;
  onColor: (color: StateColorKey) => void;
  onNotify: (notify: boolean) => void;
  onDelete: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(state.name);
  useEffect(() => setName(state.name), [state.name]);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: state.id,
    disabled: busy,
  });
  const rename = () => {
    const next = name.trim();
    if (next && next !== state.name) onRename(next);
    else setName(state.name);
  };
  const grip = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(event.key === 'ArrowUp' ? index - 1 : index + 1);
  };
  const colorLabel = STATE_COLORS.find(color => color.key === state.color)?.label ?? 'Gray';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 bg-background px-1.5 py-1.5 first:rounded-t-lg last:rounded-b-lg motion-safe:animate-[view-in_200ms_ease-out] sm:flex-nowrap',
        isDragging && 'relative z-10 ao-raised',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription="draggable state"
        aria-label={`Move ${state.name} (drag, or use the arrow keys)`}
        title="Drag to reorder"
        disabled={busy || count < 2}
        onKeyDown={grip}
        className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripIcon />
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={`Colour of ${state.name}: ${colorLabel}`}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
          >
            <StateDot color={state.color} className="size-3" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={16}
            aria-label={`Colour of ${state.name}`}
            className="z-50 w-64 origin-[var(--radix-popover-content-transform-origin)] rounded-lg border border-border bg-background p-3 ao-top shadow-lg motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
          >
            <ColorSwatches
              label={`Colour of ${state.name}`}
              value={stateColor(state.color)}
              colors={swatches}
              onChange={hex => {
                const key = STATE_COLORS.find(color => color.hex.toLowerCase() === hex.toLowerCase())?.key;
                if (key && key !== state.color) onColor(key);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <input
        aria-label={`Name of ${state.name}`}
        value={name}
        maxLength={40}
        disabled={busy}
        onChange={event => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            rename();
          } else if (event.key === 'Escape') setName(state.name);
        }}
        className={cn(settingsInput, 'h-10 min-w-0 flex-1 basis-32 text-base sm:text-sm')}
      />
      <span className="ml-auto flex shrink-0 items-center gap-2 pl-1">
        <label htmlFor={`${id}-notify`} className="cursor-pointer text-xs text-muted-foreground">
          Notify me
        </label>
        <Switch id={`${id}-notify`} checked={state.notifyOnEnter} disabled={busy} onCheckedChange={onNotify} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete ${state.name}`}
          title={deletable ? `Delete ${state.name}` : 'The board keeps at least one state of this category'}
          disabled={busy || !deletable}
          className="size-10 p-0 text-muted-foreground hover:text-red-400"
          onClick={onDelete}
        >
          <TrashIcon />
        </Button>
      </span>
    </li>
  );
}

function AddState({
  category,
  busy,
  onAdd,
  onCancel,
}: {
  category: string;
  busy: boolean;
  onAdd: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2 motion-safe:animate-[view-in_200ms_ease-out]"
      onSubmit={event => {
        event.preventDefault();
        if (name.trim()) void onAdd(name.trim());
      }}
    >
      <input
        autoFocus
        aria-label={`New ${category.toLowerCase()} state`}
        placeholder="Name, like QA"
        value={name}
        maxLength={40}
        disabled={busy}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => event.key === 'Escape' && onCancel()}
        className={cn(settingsInput, 'h-10 min-w-0 flex-1 text-base sm:text-sm')}
      />
      <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !name.trim()}>
        Add state
      </Button>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Deleting a state asks where its tickets (archived ones too) go: another state, one of its category first. */
function DeleteState({
  state,
  states,
  onOpenChange,
  onDelete,
}: {
  state: BoardState | null;
  states: BoardState[];
  onOpenChange: (open: boolean) => void;
  onDelete: (state: BoardState, moveTo: string) => Promise<void>;
}) {
  const id = useId();
  const others = states.filter(item => item.id !== state?.id);
  const fallback = (others.find(item => item.category === state?.category) ?? others[0])?.id ?? '';
  const [moveTo, setMoveTo] = useState(fallback);
  useEffect(() => setMoveTo(fallback), [state?.id]);
  return (
    <ConfirmDialog
      open={Boolean(state)}
      onOpenChange={onOpenChange}
      title={`Delete ${state?.name ?? 'state'}?`}
      description={
        <div className="space-y-3">
          <p>Its tickets move to the state you choose, each with an entry in its activity.</p>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-move`} className="block text-xs font-medium text-foreground">
              Move its tickets to
            </label>
            <Select
              id={`${id}-move`}
              value={moveTo}
              options={others.map(item => ({
                value: item.id,
                label: `${item.name} (${CATEGORIES.find(category => category.key === item.category)?.label})`,
              }))}
              onValueChange={setMoveTo}
            />
          </div>
        </div>
      }
      confirmLabel="Delete"
      busyLabel="Deleting…"
      onConfirm={() => (state ? onDelete(state, moveTo) : Promise.resolve())}
    />
  );
}
