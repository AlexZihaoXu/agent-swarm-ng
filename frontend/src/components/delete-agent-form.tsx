import { useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import type { ChatAgent } from '@/use-chat';

// Kibo dialog/standard/dialog-standard-1, adapted for typed destructive confirmation.
export function DeleteAgentForm({ agent, onDelete, onDone, onBusyChange }: {
  agent: ChatAgent; onDelete: (agent: ChatAgent, confirmation: string) => Promise<void>;
  onDone: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy || confirmation !== agent.name) return;
    setBusy(true); onBusyChange(true); setError('');
    try { await onDelete(agent, confirmation); onDone(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete the agent. Try again.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return (
    <form onSubmit={event => { event.preventDefault(); void remove(); }}>
      <Dialog.Title className="text-lg font-semibold">Delete agent</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
        This permanently deletes the agent and its chat history. This cannot be undone. Shared provider connections are kept.
      </Dialog.Description>
      <p id={`${id}-help`} className="mt-5 break-words text-sm">Type <strong className="select-text">{agent.name}</strong> exactly to confirm.</p>
      <label htmlFor={id} className="mt-4 block text-sm font-medium">Confirm agent name</label>
      <input id={id} aria-describedby={`${id}-help`} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 h-10 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" />
      {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Dialog.Close asChild><Button type="button" variant="outline" size="sm" disabled={busy}>Cancel</Button></Dialog.Close>
        <Button type="submit" variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10" size="sm" disabled={busy || confirmation !== agent.name}>{busy ? 'Deleting…' : 'Delete agent'}</Button>
      </div>
    </form>
  );
}
