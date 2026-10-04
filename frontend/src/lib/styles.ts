/** The bordered panel every settings section puts its controls in (Agent settings and Settings share it). */
export const settingsCard = 'ao-card rounded-lg border border-border bg-sidebar/30 p-4';
/** Text fields on the Settings page. */
export const settingsInput =
  'ao-inset h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10';

/** Every modal shares one backdrop: dimmed, lightly blurred, fading with the dialog. */
export const dialogOverlay =
  'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]';

/** Centered dialogs scale in from 96% and fade; closing is quicker than opening. */
export const dialogMotion =
  'motion-safe:data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]';

/** Phone back links (agent settings, Knowledge): a clear 20px chevron plus the destination, 44px tall. */
export const backLink =
  '-ml-2 flex min-h-11 shrink-0 items-center gap-0.5 rounded-md pl-1 pr-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] motion-reduce:active:scale-100 [&_svg]:size-5';
