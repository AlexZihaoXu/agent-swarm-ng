import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { EdgeHandle } from '@/components/ui/edge-handle';
import { AboveWindows } from '@/components/ui/above-windows';
import { useQuery } from '@tanstack/react-query';
import { computersQuery } from '@/lib/computers-query';
import { cn } from '@/lib/utils';

const ChevronUp = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A small handle at the bottom of the viewer: "^" at rest, "^ All computers" when the pointer reaches it,
 * opening a drawer of every computer so the operator can jump between desktops without leaving the viewer.
 * The handle is small on purpose so it covers almost none of the live desktop's input area.
 */
export function ComputerSwitcher({ currentId, onOpen }: { currentId: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState(0);
  const query = useQuery({ ...computersQuery, enabled: open, staleTime: 5000 });
  const computers = query.data?.computers ?? [];
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (next) setFrame(Date.now());
        setOpen(next);
      }}
    >
      {/* Above any floating window, so the switcher is always reachable. */}
      <AboveWindows>
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <Dialog.Trigger asChild>
            <EdgeHandle label="All computers" icon={<ChevronUp />} />
          </Dialog.Trigger>
        </div>
      </AboveWindows>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:data-[state=open]:animate-[fade-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_160ms_ease-in]" />
        <Dialog.Content className="sheet-bottom fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[70dvh] w-full max-w-5xl flex-col rounded-t-2xl border border-b-0 border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none">
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-foreground/20" />
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3 md:px-6">
            <Dialog.Title className="text-base font-semibold">All computers</Dialog.Title>
            <Dialog.Close className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <span className="sr-only">Close</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Switch to another computer's desktop.</Dialog.Description>
          <div className="min-h-0 overflow-y-auto px-4 pb-5 md:px-6">
            {query.isPending && <p className="py-6 text-sm text-muted-foreground">Loading computers…</p>}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3">
              {computers.map((computer, index) => {
                const current = computer.id === currentId;
                const running = computer.state === 'running';
                return (
                  <li
                    key={computer.id}
                    className="card-enter"
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                  >
                    <button
                      type="button"
                      aria-current={current ? 'page' : undefined}
                      onClick={() => {
                        setOpen(false);
                        if (!current) onOpen(computer.id);
                      }}
                      className={cn(
                        'block w-full overflow-hidden rounded-lg border bg-sidebar text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                        current ? 'border-foreground/60' : 'border-border hover:border-foreground/25',
                      )}
                    >
                      <span className="relative block aspect-video bg-black">
                        {running ? (
                          <img
                            src={`/api/computers/${encodeURIComponent(computer.id)}/preview?at=${frame}`}
                            alt=""
                            className="size-full object-cover"
                            onError={event => (event.currentTarget.style.visibility = 'hidden')}
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center text-[11px] text-muted-foreground">
                            Desktop offline
                          </span>
                        )}
                        {current && (
                          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white">
                            Viewing
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{computer.name}</span>
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${running ? 'bg-teal-400' : 'bg-muted-foreground/60'}`}
                        />
                        <span className="text-[11px] text-muted-foreground">{running ? 'Running' : 'Stopped'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
