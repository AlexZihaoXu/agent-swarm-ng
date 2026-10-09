import { useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { dialogMotion, dialogOverlay, settingsInput } from '@/lib/styles';
import { noAutofill } from '@/lib/no-autofill';

/**
 * Rename an agent, a group chat or a computer (the confirm dialog's shell): one name field, saved only on Rename.
 * `onRename` throws with the server's message (a name in use, an agent that is responding) to show it here.
 */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  label,
  current,
  description,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  current: string;
  description?: string;
  onRename: (name: string) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName(current);
      setError('');
    }
  }, [open, current]);
  const trimmed = name.trim();
  async function rename() {
    if (busy || !trimmed) return;
    if (trimmed === current) return onOpenChange(false);
    setBusy(true);
    setError('');
    try {
      await onRename(trimmed);
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not rename it. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={next => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background ao-card p-6 shadow-xl ${dialogMotion}`}
        >
          <form
            onSubmit={event => {
              event.preventDefault();
              void rename();
            }}
          >
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {description ?? 'Choose a new name.'}
            </Dialog.Description>
            <label htmlFor={`${id}-name`} className="mt-4 block text-sm font-medium">
              {label}
            </label>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              autoFocus
              onFocus={event => event.currentTarget.select()}
              onChange={event => {
                setName(event.target.value);
                setError('');
              }}
              className={`mt-2 ${settingsInput}`}
              {...noAutofill}
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !trimmed}>
                {busy ? 'Renaming…' : 'Rename'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
