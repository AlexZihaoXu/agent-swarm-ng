import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import type { TerminalRequest } from '@/lib/computer-terminals';
import { dialogMotion, dialogOverlay } from '@/lib/styles';

const field =
  'min-h-10 min-w-0 rounded-md border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm';

/**
 * The New terminal form as its own modal, shared by the Terminal view and the desktop's Terminals drawer.
 * `onSubmit` resolves true once the computer accepted the session; the name and command then clear.
 */
export function NewTerminalDialog({
  open,
  onOpenChange,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  /** Shown inside the form, for callers without a status line of their own. */
  error?: string;
  onSubmit: (body: Extract<TerminalRequest, { operation: 'create' }>) => Promise<boolean>;
}) {
  const [name, setName] = useState(''),
    [command, setCommand] = useState(''),
    [cwd, setCwd] = useState('~/Desktop');
  return (
    <Dialog.Root open={open} onOpenChange={next => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl ${dialogMotion}`}
        >
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              void onSubmit({
                operation: 'create',
                name,
                ...(command ? { command } : {}),
                ...(cwd ? { cwd } : {}),
              }).then(created => {
                if (!created) return;
                setName('');
                setCommand('');
              });
            }}
          >
            <Dialog.Title className="text-lg font-semibold">New terminal</Dialog.Title>
            <label className="block text-xs">
              Terminal name
              <input
                aria-label="Terminal name"
                className={`${field} mt-1 w-full`}
                value={name}
                pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-){0,47}"
                maxLength={48}
                required
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="block text-xs">
              Initial command
              <input
                aria-label="Initial command"
                placeholder="Optional; otherwise an interactive shell"
                className={`${field} mt-1 w-full font-mono`}
                value={command}
                maxLength={32768}
                disabled={busy}
                onChange={event => setCommand(event.target.value)}
              />
            </label>
            <label className="block text-xs">
              Working directory
              <input
                aria-label="Working directory"
                className={`${field} mt-1 w-full font-mono`}
                value={cwd}
                maxLength={4096}
                disabled={busy}
                onChange={event => setCwd(event.target.value)}
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Names: letters, digits, hyphens and underscores. Commands run as the guest agent account, including its
              configured sudo permissions.
            </p>
            {error && (
              <p role="alert" className="text-xs text-red-400 [overflow-wrap:anywhere]">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-10"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="min-h-10" disabled={busy || !name}>
                Create terminal
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
