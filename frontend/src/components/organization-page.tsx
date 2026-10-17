import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { OrganizationIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/page-header';
import { TicketSettings } from '@/components/ticket-settings';
import {
  DeleteOrganizationDialog,
  deleteBlocked,
  describeOrganization,
  organizationField,
  renameOrganization,
} from '@/components/organization-settings';
import { useSignedIn } from '@/lib/auth';
import { initialsOf, useOrganizations, type Organization } from '@/lib/organizations';
import { settingsCard } from '@/lib/styles';

function SectionTitle({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The Organization tab (`/organization`, docs/organizations.md): settings of the organization in view, the one the
 * switcher shows. Its name, what it holds, its Tickets, and deleting it when empty. Creating organizations and the
 * whole list stay in global Settings → Organizations. With All organizations in view (and several), it asks which.
 */
export function OrganizationPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { organizations, target, setCurrent, refresh } = useOrganizations();
  const { name: me } = useSignedIn();
  // Counts change as things are created and moved elsewhere: look again on arrival.
  useEffect(() => void refresh(), []);
  const organization = organizations.find(org => org.id === target);
  const ownerOf = (org: Organization) => org.ownerName ?? me;
  if (!organization)
    return (
      <section aria-label="Organization" className="flex min-h-full flex-col">
        <PageHeader title="Organization" width="max-w-3xl" sticky />
        {organizations.length === 0 ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Loading…
          </p>
        ) : (
          // Kibo empty/actions-1 composition, as the Tickets tab's "Choose an organization".
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <OrganizationIcon />
              </EmptyMedia>
              <EmptyTitle>Choose an organization</EmptyTitle>
              <EmptyDescription>
                All organizations are in view. Pick one to see and change its settings; the switcher at the top left
                then shows it too.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ul aria-label="Organizations" className="w-full space-y-2">
                {organizations.map(org => (
                  <li key={org.id}>
                    <button
                      type="button"
                      onClick={() => setCurrent(org.id)}
                      className="ao-raised flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold"
                      >
                        {initialsOf(org.name)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{org.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {ownerOf(org) === me
                            ? describeOrganization(org)
                            : `${ownerOf(org)}'s · ${describeOrganization(org)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" onClick={() => onNavigate('/settings#organizations')}>
                Create or manage organizations
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>
    );
  return (
    <div>
      <PageHeader
        title={organization.name}
        description={
          ownerOf(organization) === me ? 'Organization settings' : `Organization settings · ${ownerOf(organization)}'s`
        }
        width="max-w-3xl"
        sticky
      />
      {/* Keyed: switching organization starts its sections fresh (drafts and messages belong to one). */}
      <OrganizationSections key={organization.id} organization={organization} organizations={organizations} />
    </div>
  );
}

function OrganizationSections({
  organization,
  organizations,
}: {
  organization: Organization;
  organizations: Organization[];
}) {
  const id = useId();
  const { refresh } = useOrganizations();
  const [name, setName] = useState(organization.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const blocked = deleteBlocked(organization, organizations);
  const changed = name.trim() !== organization.name;
  const rename = async () => {
    setBusy(true);
    setMessage('');
    try {
      await renameOrganization(organization.id, name);
      await refresh();
      setMessage('Renamed.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const held = [
    ['Agents', organization.agents],
    ['Computers', organization.computers],
    ['Group chats', organization.groups],
  ] as const;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-8 pt-6 md:px-6 md:pb-10">
      <section aria-labelledby={`${id}-name`} className="space-y-4">
        <SectionTitle id={`${id}-name`} title="Name">
          How it is listed in the organization switcher.
        </SectionTitle>
        <form
          className={settingsCard}
          onSubmit={event => {
            event.preventDefault();
            if (changed && name.trim()) void rename();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${id}-name-field`} className="sr-only">
              Organization name
            </label>
            <input
              id={`${id}-name-field`}
              value={name}
              maxLength={60}
              disabled={busy}
              onChange={event => setName(event.target.value)}
              className={organizationField}
            />
            {changed && (
              <Button type="submit" size="sm" disabled={busy || !name.trim()} className="min-h-11 sm:min-h-0">
                Rename
              </Button>
            )}
          </div>
          {message && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {message}
            </p>
          )}
        </form>
      </section>
      <section aria-labelledby={`${id}-holds`} className="space-y-4">
        <SectionTitle id={`${id}-holds`} title="What it holds">
          Kept apart from other organizations: computers are assigned, DMs allowed and groups formed only within it.
          Move something to another organization from its own settings.
        </SectionTitle>
        <dl className="grid grid-cols-3 gap-3">
          {held.map(([label, count]) => (
            <div key={label} className={settingsCard}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <TicketSettings card={settingsCard} organization={organization} />
      <section aria-labelledby={`${id}-delete`} className="space-y-4">
        <SectionTitle id={`${id}-delete`} title="Delete organization">
          Only an empty organization can be deleted, and everyone keeps at least one.
        </SectionTitle>
        <div className={`${settingsCard} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-sm text-muted-foreground">{blocked ?? 'It is empty and can be deleted.'}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(blocked)}
            className="min-h-11 text-red-400 sm:min-h-0"
            onClick={() => setDeleting(true)}
          >
            Delete {organization.name}
          </Button>
        </div>
      </section>
      <DeleteOrganizationDialog
        organization={deleting ? organization : null}
        onClose={() => setDeleting(false)}
        // The switcher then falls back to All organizations, and this page asks which one.
        onDeleted={refresh}
      />
    </div>
  );
}
