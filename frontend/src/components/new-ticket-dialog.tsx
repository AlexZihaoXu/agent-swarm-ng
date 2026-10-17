import { useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { AssigneeAvatar, assigneeOptions } from '@/components/ticket-assignee';
import type { Organization } from '@/lib/organizations';
import { dialogMotion, dialogOverlay, settingsInput } from '@/lib/styles';
import { PRIORITIES, useTicketActions, type TicketPriority, type TicketSummary } from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

const PRIORITY_CHOICES = PRIORITIES.filter(priority => priority.key !== 'none').map(priority => ({
  value: priority.key,
  label: priority.label,
}));
/** What the dialog opens with: a sub-issue's parent, or a chat message to file (its text, linked). */
export type NewTicketStart = {
  parent?: { number: number; key: string; title: string };
  message?: { id: string; text: string };
};
const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/**
 * New ticket: title, description (a request from the person writing it), assignee, priority and due date; as a
 * sub-issue of a ticket, or from a chat message (its text copied in, the message linked).
 */
export function NewTicketDialog({
  open,
  onOpenChange,
  start,
  organization,
  agents,
  ownerName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  start?: NewTicketStart;
  organization: Organization;
  agents: ChatAgent[];
  ownerName: string;
  onCreated: (ticket: TicketSummary) => void;
}) {
  const id = useId();
  const actions = useTicketActions(organization.id);
  const options = assigneeOptions(ownerName, agents);
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [assignee, setAssignee] = useState('none'),
    [priority, setPriority] = useState<TicketPriority>('medium'),
    [due, setDue] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // A message fills the text in once, as the dialog opens with it.
  useEffect(() => {
    if (!open || !start?.message) return;
    setTitle(firstLine(start.message.text));
    setDescription(start.message.text.trim().slice(0, 8000));
  }, [open, start?.message]);
  const chosen = options.find(option => option.key === assignee)!;
  const hint = !chosen.choice
    ? organization.tickets.agentsPickUp
      ? 'Unassigned tickets wait in Todo; an agent with the ticket tools may pick it up.'
      : 'Unassigned tickets wait in Todo until you assign someone.'
    : 'owner' in chosen.choice
      ? `Assigned to ${chosen.name}: no agent is woken.`
      : organization.tickets.wakeOnAssign
        ? `${chosen.name} is woken right away with this ticket.`
        : `${chosen.name} is not woken (waking on assignment is off).`;
  const reset = () => {
    setTitle('');
    setDescription('');
    setAssignee('none');
    setPriority('medium');
    setDue('');
    setError('');
  };
  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) reset();
  };
  async function create() {
    setBusy(true);
    setError('');
    try {
      const made = await actions.create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assignee: chosen.choice,
        ...(due ? { due } : {}),
        ...(start?.parent ? { parent: start.parent.number } : {}),
        ...(start?.message ? { linkMessage: start.message.id } : {}),
      });
      reset();
      onOpenChange(false);
      onCreated(made.ticket);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the ticket.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background ao-card p-6 shadow-xl ${dialogMotion}`}
        >
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (title.trim()) void create();
            }}
          >
            <div>
              <Dialog.Title className="text-lg font-semibold">
                {start?.parent ? 'New sub-issue' : 'New ticket'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {start?.parent
                  ? `A sub-issue of ${start.parent.key} “${start.parent.title}”.`
                  : `In ${organization.name}.`}{' '}
                {start?.message
                  ? 'The message’s text is copied in and the message is linked; agents read the description as a request from you.'
                  : 'Agents read the description as a request from you.'}
              </Dialog.Description>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-title`} className="block text-sm font-medium">
                Title
              </label>
              <input
                id={`${id}-title`}
                autoFocus
                value={title}
                maxLength={200}
                disabled={busy}
                placeholder="Back up the Keep folders nightly"
                onChange={event => setTitle(event.target.value)}
                className={cn(settingsInput, 'text-base sm:text-sm')}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-description`} className="block text-sm font-medium">
                Description <span className="font-normal text-muted-foreground">(Markdown)</span>
              </label>
              <textarea
                id={`${id}-description`}
                rows={4}
                value={description}
                maxLength={8000}
                disabled={busy}
                placeholder="What done looks like, where to look, anything to avoid."
                onChange={event => setDescription(event.target.value)}
                className="ao-inset w-full resize-y rounded-lg border border-border bg-sidebar px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm"
              />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Assignee</span>
              <ChoiceChips
                label="Assignee"
                value={assignee}
                disabled={busy}
                onChange={setAssignee}
                options={options.map(option => ({
                  value: option.key,
                  label: option.name,
                  icon: option.choice ? (
                    <AssigneeAvatar
                      assignee={
                        'owner' in option.choice
                          ? { kind: 'owner', id: 'owner', name: option.name }
                          : { kind: 'agent', id: option.choice.agentId, name: option.name }
                      }
                      agents={agents}
                      size={16}
                    />
                  ) : undefined,
                }))}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <span className="block text-sm font-medium">Priority</span>
                <ChoiceChips
                  label="Priority"
                  value={priority}
                  disabled={busy}
                  onChange={setPriority}
                  options={PRIORITY_CHOICES}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`${id}-due`} className="block text-sm font-medium">
                  Due date
                </label>
                <input
                  id={`${id}-due`}
                  type="date"
                  value={due}
                  disabled={busy}
                  onChange={event => setDue(event.target.value)}
                  className={cn(settingsInput, 'h-11 w-44 cursor-text text-base sm:h-9 sm:text-sm')}
                />
              </div>
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {hint}
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={busy}
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="min-h-10" disabled={busy || !title.trim()}>
                {busy ? 'Creating…' : 'Create ticket'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
