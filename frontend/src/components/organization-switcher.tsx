import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from '@/components/ui/icons';
import { initialsOf, useOrganizations, type Organization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

const counts = (org: Pick<Organization, 'agents' | 'computers'>) =>
  `${org.agents} agent${org.agents === 1 ? '' : 's'} · ${org.computers} computer${org.computers === 1 ? '' : 's'}`;

function Badge({ text, className }: { text: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-foreground',
        className,
      )}
    >
      {text}
    </span>
  );
}

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none focus:bg-muted focus:text-foreground md:min-h-9';

/**
 * Which organization the dashboard shows (docs/organizations.md). Composition: Kibo dropdown-menu-profile-4
 * (Multi-Account Switcher): the current organization with its counts, a list to switch, then New organization
 * (Settings → Organizations, where they are also renamed and deleted). On a
 * phone it is a square badge beside the floating tab bar (mirroring Portal).
 */
export function OrganizationSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const { organizations, current, setCurrent, refresh } = useOrganizations();
  const navigate = useNavigate();
  const shown = organizations.find(org => org.id === current);
  const all = {
    name: 'All organizations',
    agents: organizations.reduce((sum, org) => sum + org.agents, 0),
    computers: organizations.reduce((sum, org) => sum + org.computers, 0),
  };
  const label = shown?.name ?? (organizations.length === 1 ? organizations[0].name : all.name);
  const summary = shown ?? (organizations.length === 1 ? organizations[0] : all);
  return (
    // Counts change as things are created and moved: look again whenever it opens.
    <DropdownMenu.Root onOpenChange={open => open && void refresh()}>
      <DropdownMenu.Trigger
        aria-label={`Organization: ${label}`}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'size-[50px] justify-center shadow-lg' : 'h-10 w-56 justify-between px-2',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Badge
            text={shown || organizations.length === 1 ? initialsOf(label) : '∗'}
            className={compact ? 'size-8 text-xs' : ''}
          />
          {!compact && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium leading-tight">{label}</span>
              <span className="truncate text-[11px] leading-tight text-muted-foreground">{counts(summary)}</span>
            </span>
          )}
        </span>
        {!compact && <ChevronsUpDownIcon className="size-4 opacity-50" />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side={compact ? 'top' : 'bottom'}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-64 rounded-lg border border-border bg-background p-1 text-sm shadow-lg motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Organizations
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          {organizations.length > 1 && (
            <DropdownMenu.Item className={itemClass} onSelect={() => setCurrent('all')}>
              <Badge text="∗" className="size-8" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{all.name}</span>
                <span className="truncate text-xs text-muted-foreground">{counts(all)}</span>
              </span>
              {current === 'all' && <CheckIcon className="size-4" />}
            </DropdownMenu.Item>
          )}
          {organizations.map(org => (
            <DropdownMenu.Item key={org.id} className={itemClass} onSelect={() => setCurrent(org.id)}>
              <Badge text={initialsOf(org.name)} className="size-8" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{org.name}</span>
                <span className="truncate text-xs text-muted-foreground">{counts(org)}</span>
              </span>
              {(current === org.id || (organizations.length === 1 && current === 'all')) && (
                <CheckIcon className="size-4" />
              )}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <DropdownMenu.Item className={itemClass} onSelect={() => navigate('/settings#organizations')}>
            <PlusIcon className="text-muted-foreground" />
            New organization
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
