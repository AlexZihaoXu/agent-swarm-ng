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

export const DashboardIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M18 17V9M13 17V5M8 17v-3" />
  </Icon>
);
/** Agents: a person with a gear (Lucide user-cog), the page where agents are configured. */
export const AgentsIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <circle cx="18" cy="15" r="3" />
    <circle cx="9" cy="7" r="4" />
    <path d="M10 15H6a4 4 0 0 0-4 4v2" />
    <path d="m21.7 16.4-.9-.3M15.2 13.9l-.9-.3M16.6 18.7l.3-.9M19.1 12.2l.3-.9M19.6 18.7l-.4-1M16.8 12.3l-.4-1M14.3 16.6l1-.4M20.7 13.8l1-.4" />
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
/** Agent settings sections (Lucide geometry). */
export const ChannelsIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zM18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
  </Icon>
);
export const ModelIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" rx="1" />
    <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
  </Icon>
);
export const InstructionsIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
  </Icon>
);
export const HeartbeatIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
  </Icon>
);
export const ClockIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Icon>
);
export const NotepadIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4M2 6h4M2 10h4M2 14h4M2 18h4" />
    <path d="M21.38 5.63a1 1 0 0 0-3-3l-5.01 5.01a2 2 0 0 0-.5.86l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .86-.5z" />
  </Icon>
);
export const MemoryIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4M17.6 6.5A3 3 0 0 0 18 5M6 5a3 3 0 0 0 .4 1.5" />
  </Icon>
);
export const SmileIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
  </Icon>
);
export const OrganizationIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" />
  </Icon>
);
/** Create buttons: the thing being made with a plus at its lower right (as Tabler's *-plus icons). */
export const ComputerAddIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M13 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v7" />
    <path d="M7 21h5M9.5 17v4M16 18h6M19 15v6" />
  </Icon>
);
export const AgentAddIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </Icon>
);
export const GroupAddIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 2.5.88" />
    <circle cx="9" cy="7" r="4" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75M16 18h6M19 15v6" />
  </Icon>
);
export const DownloadIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5" />
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
/** Fallback model rows: drag to rank, move up, remove (Lucide grip-vertical, chevron-up, x). */
export const GripIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <circle cx="9" cy="5" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="19" r="1" />
    <circle cx="15" cy="5" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="19" r="1" />
  </Icon>
);
export const ChevronUpIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="m18 15-6-6-6 6" />
  </Icon>
);
export const XIcon = (props: ComponentProps<'svg'>) => (
  <Icon {...props}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
