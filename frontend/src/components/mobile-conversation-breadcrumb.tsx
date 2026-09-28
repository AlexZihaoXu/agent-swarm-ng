import type { ReactNode } from 'react';

// Kibo breadcrumb-standard-1: an unbordered path with a compact ancestor on narrow phones.
export function MobileConversationBreadcrumb({
  parent,
  current,
  avatar,
  onBack,
  intermediate,
}: {
  parent: 'Agents' | 'Chats';
  current: string;
  avatar?: ReactNode;
  onBack: () => void;
  intermediate?: { label: string; onSelect: () => void };
}) {
  return (
    <nav aria-label="Conversation breadcrumb" className="min-w-0 flex-1 md:hidden">
      <ol className="flex min-h-11 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm max-[320px]:text-xs">
        <li className="shrink-0">
          <button
            type="button"
            aria-label={`Back to ${parent.toLowerCase()}`}
            onClick={onBack}
            className="flex min-h-11 min-w-11 cursor-pointer items-center text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {parent}
          </button>
        </li>
        <li aria-hidden="true" className="shrink-0 text-muted-foreground">
          ›
        </li>
        {intermediate && (
          <>
            <li className="min-w-0 max-w-[55%] shrink-0">
              <button
                type="button"
                aria-label={`Chat with You for ${intermediate.label}`}
                title={intermediate.label}
                onClick={intermediate.onSelect}
                className="flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 overflow-hidden text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span aria-hidden="true" className="hidden shrink-0 min-[351px]:inline-flex">
                  {avatar}
                </span>
                <span className="min-w-0 truncate max-[350px]:hidden">{intermediate.label}</span>
                <span aria-hidden="true" className="min-[351px]:hidden">
                  …
                </span>
              </button>
            </li>
            <li aria-hidden="true" className="shrink-0 text-muted-foreground">
              ›
            </li>
          </>
        )}
        <li aria-current="page" title={current} className="flex min-w-0 items-center gap-1.5 font-semibold">
          {!intermediate && avatar}
          <h2 className="min-w-0 truncate text-sm font-semibold max-[320px]:text-xs">{current}</h2>
        </li>
      </ol>
    </nav>
  );
}
