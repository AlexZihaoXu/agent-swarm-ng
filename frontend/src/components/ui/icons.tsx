import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// A few line icons (Lucide geometry, ISC) drawn inline so the app needs no icon package.
function Icon({ className, children, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export const AgentsIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);
export const ChatIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </Icon>
);
export const ComputerIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);
export const SettingsIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </Icon>
);
export const BookIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Icon>
);
export const PlusIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M5 12h14M12 5v14" />
  </Icon>
);
export const TrashIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </Icon>
);
export const ChevronLeftIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
export const TerminalIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="m4 17 6-6-6-6M12 19h8" />
  </Icon>
);
export const FolderIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);
export const SoundOnIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Icon>
);
export const SoundOffIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6" />
  </Icon>
);
export const LockIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
export const UnlockIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Icon>
);
export const KeyboardIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
  </Icon>
);
export const ChevronDownIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const SearchIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const ChevronsUpDownIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </Icon>
);
export const CheckIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
