import { useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { GroupChat } from '@/use-groups';

// Kibo dialog/standard/dialog-standard-5: typed destructive confirmation, adapted to the group API.
export function DeleteGroupForm({
  group,
  open,
  onOpenChange,
  onDeleted,
}: {
  group: GroupChat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const id = useId();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    if (busy || confirmation !== group.name) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.DELETE('/api/groups/{id}', {
        params: { path: { id: group.id } },
        body: { confirmation },
      });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Could not delete the group chat.');
      if (onDeleted) onDeleted();
      else onOpenChange(false);
      window.dispatchEvent(new CustomEvent('swarm-group-deleted', { detail: group.id }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not delete the group chat.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={value => {
        if (busy) return;
        onOpenChange(value);
        if (value) {
          setConfirmation('');
          setError('');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
          <form
            onSubmit={event => {
              event.preventDefault();
              void remove();
            }}
          >
            <Dialog.Title className="text-lg font-semibold">Delete group chat</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This permanently deletes the group and its saved chat messages, replies, and reactions. Agents may retain
              context they already saw in private working sessions. Other chats and agents remain. This cannot be
              undone. If agents are responding, stop or wait for them first.
            </Dialog.Description>
            <p id={`${id}-help`} className="mt-5 break-words text-sm">
              Type <strong className="select-text">{group.name}</strong> exactly to confirm.
            </p>
            <label htmlFor={id} className="mt-4 block text-sm font-medium">
              Confirm group name
            </label>
            <input
              id={id}
              aria-describedby={`${id}-help`}
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10 sm:text-sm"
            />
            {error && (
              <p role="alert" className="mt-4 text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 w-full sm:min-h-0 sm:w-auto"
                  disabled={busy}
                >
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="min-h-11 w-full border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0 sm:w-auto"
                disabled={busy || confirmation !== group.name}
              >
                {busy ? 'Deleting…' : 'Delete group chat'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
