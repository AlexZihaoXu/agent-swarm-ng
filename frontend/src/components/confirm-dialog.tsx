import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { dialogOverlay } from '@/lib/styles';

/** Same shell as the computer dialogs. States what will happen, then runs the action only after an explicit click. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!busy) {
          setError('');
          onOpenChange(next);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]">
          <form
            onSubmit={event => {
              event.preventDefault();
              void confirm();
            }}
          >
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
            </Dialog.Description>
            {error && (
              <p role="alert" className="mt-4 text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="min-h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0"
                disabled={busy}
              >
                {busy ? busyLabel : confirmLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
