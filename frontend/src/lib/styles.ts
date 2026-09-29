/** The bordered panel every settings section puts its controls in (Agent settings and Settings share it). */
export const settingsCard = 'rounded-lg border border-border bg-sidebar/30 p-4';

/** Every modal shares one backdrop: dimmed, lightly blurred, fading with the dialog. */
export const dialogOverlay =
  'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]';

/** Centered dialogs scale in from 96% and fade; closing is quicker than opening. */
export const dialogMotion =
  'motion-safe:data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]';
