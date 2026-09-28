import type { ReactNode } from 'react';

/** Search-with-icon composition: Kibo input-group/icons/input-group-icons-1, shared by the Agents and Chat sidebars. */
export function SidebarSearch({
  label,
  placeholder,
  value,
  onChange,
  maxLength,
  action,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-3">
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/15 bg-[#262626] px-2.5 focus-within:ring-1 focus-within:ring-ring sm:h-8">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="size-3.5 shrink-0 text-muted-foreground"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          aria-label={label}
          placeholder={placeholder}
          maxLength={maxLength}
          value={value}
          onChange={event => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      {action}
    </div>
  );
}
