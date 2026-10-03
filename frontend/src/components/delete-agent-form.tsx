import { useId, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import type { ChatAgent } from '@/use-chat';

// Kibo dialog/standard/dialog-standard-1, adapted for typed destructive confirmation.
export function DeleteAgentForm({
  agent,
  onDelete,
  onDone,
  onBusyChange,
}: {
  agent: ChatAgent;
  onDelete: (agent: ChatAgent, confirmation: string) => Promise<void>;
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy || confirmation !== agent.name) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await onDelete(agent, confirmation);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not delete the agent. Try again.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void remove();
      }}
    >
      <Dialog.Title className="text-lg font-semibold">Delete agent</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
        This permanently deletes the agent, its private chat, DM conversations, and DM permissions. Related peer work is
        stopped. This cannot be undone. Other agents and shared provider connections are kept.
      </Dialog.Description>
      <p id={`${id}-help`} className="mt-5 break-words text-sm">
        Type <strong className="select-text">{agent.name}</strong> exactly to confirm.
      </p>
      <label htmlFor={id} className="mt-4 block text-sm font-medium">
        Confirm agent name
      </label>
      <input
        id={id}
        aria-describedby={`${id}-help`}
        value={confirmation}
        onChange={event => setConfirmation(event.target.value)}
        disabled={busy}
        {...noAutofill}
        spellCheck={false}
        className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10"
      />
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          type="submit"
          variant="outline"
          className="min-h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0"
          size="sm"
          disabled={busy || confirmation !== agent.name}
        >
          {busy ? 'Deleting…' : 'Delete agent'}
        </Button>
      </div>
    </form>
  );
}
