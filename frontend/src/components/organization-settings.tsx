import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useSignedIn } from '@/lib/auth';
import { useOrganizations, type Organization } from '@/lib/organizations';

// Shared with the Organization tab (organization-page.tsx), which edits the one in view.
export const organizationField =
  'h-11 min-w-0 flex-1 rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-9 sm:text-sm';
export const describeOrganization = (org: Organization) =>
  `${org.agents} agent${org.agents === 1 ? '' : 's'} · ${org.computers} computer${org.computers === 1 ? '' : 's'} · ${org.groups} group${org.groups === 1 ? '' : 's'}`;
const failure = (error: unknown, fallback: string) =>
  new Error((error as { message?: string } | undefined)?.message ?? fallback);
/** Why an organization cannot be deleted now, or undefined when it can (empty, and not its owner's last one). */
export const deleteBlocked = (org: Organization, organizations: Organization[]) =>
  // Everyone keeps at least one organization (docs/users.md).
  organizations.filter(item => item.ownerId === org.ownerId).length < 2
    ? 'Everyone keeps at least one organization.'
    : !org.agents && !org.computers && !org.groups
      ? undefined
      : org.agents
        ? 'Delete its agents first.'
        : 'Move or delete its computers and groups first.';
export async function renameOrganization(id: string, name: string) {
  const { data, error } = await api.PATCH('/api/organizations/{id}', {
    params: { path: { id } },
    body: { name: name.trim() },
  });
  if (!data) throw failure(error, 'Could not rename it.');
}
export async function deleteOrganization(id: string) {
  const { data, error } = await api.DELETE('/api/organizations/{id}', { params: { path: { id } } });
  if (!data) throw failure(error, 'Could not delete it.');
}
/** The delete confirmation both places share. */
export function DeleteOrganizationDialog({
  organization,
  onClose,
  onDeleted,
}: {
  organization: Organization | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={Boolean(organization)}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`Delete ${organization?.name ?? 'organization'}?`}
      description="It is empty; nothing else changes."
      confirmLabel="Delete"
      busyLabel="Deleting…"
      onConfirm={async () => {
        await deleteOrganization(organization!.id);
        await onDeleted();
      }}
    />
  );
}

/**
 * Settings → Organizations (global): folders of agents, computers and group chats kept apart
 * (docs/organizations.md). Create, rename, or delete an empty one; things move between them from their own settings.
 * The organization in view is also set up in its own tab (Organization).
 */
export function OrganizationSettings({ card }: { card: string }) {
  const id = useId();
  const { organizations, refresh, setCurrent } = useOrganizations();
  const { name: me } = useSignedIn();
  const location = useLocation();
  const section = useRef<HTMLElement>(null);
  const newName = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Organization | null>(null);
  // The switcher's New organization / Manage organizations land here.
  useEffect(() => {
    if (location.hash !== '#organizations') return;
    section.current?.scrollIntoView({ block: 'start' });
    newName.current?.focus({ preventScroll: true });
  }, [location.hash, location.key]);
  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage(done);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      const { data, error } = await api.POST('/api/organizations', { body: { name: name.trim() } });
      if (!data) throw failure(error, 'Could not create the organization.');
      const made = data.organizations.find(org => !organizations.some(known => known.id === org.id));
      setName('');
      if (made) setCurrent(made.id);
    }, 'Created. The dashboard now shows it; new agents and computers go there.');
  const rename = (org: Organization) =>
    run(async () => {
      await renameOrganization(org.id, drafts[org.id] ?? org.name);
      setDrafts(current => {
        const next = { ...current };
        delete next[org.id];
        return next;
      });
    }, 'Renamed.');

  return (
    <section ref={section} id="organizations" aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Organizations
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Folders for agents, computers and group chats. Different organizations are kept apart: computers are assigned,
          DMs allowed and groups formed only within one. Move things from their own settings; the switcher at the top
          left chooses which one the dashboard shows, and the Organization tab sets that one up (its tickets too).
        </p>
      </div>
      <div className={card}>
        <ul aria-label="Organizations" className="divide-y divide-border">
          {organizations.map(org => {
            const draft = drafts[org.id] ?? org.name;
            const changed = draft.trim() !== org.name;
            const blocked = deleteBlocked(org, organizations);
            return (
              <li key={org.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
                <input
                  aria-label={`Rename ${org.name}`}
                  value={draft}
                  maxLength={60}
                  disabled={busy}
                  onChange={event => setDrafts(current => ({ ...current, [org.id]: event.target.value }))}
                  className={organizationField}
                />
                <span className="w-full text-xs text-muted-foreground sm:order-last">
                  {(org.ownerName ?? me) === me
                    ? describeOrganization(org)
                    : `${org.ownerName}'s · ${describeOrganization(org)}`}
                </span>
                {changed && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !draft.trim()}
                    className="min-h-11 sm:min-h-0"
                    onClick={() => void rename(org)}
                  >
                    Rename
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || Boolean(blocked)}
                  title={blocked}
                  className="min-h-11 text-red-400 sm:min-h-0"
                  onClick={() => setDeleting(org)}
                >
                  Delete
                </Button>
              </li>
            );
          })}
        </ul>
        <form
          className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4"
          onSubmit={event => {
            event.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <label htmlFor={`${id}-new`} className="sr-only">
            New organization name
          </label>
          <input
            id={`${id}-new`}
            ref={newName}
            value={name}
            maxLength={60}
            disabled={busy}
            placeholder="New organization name"
            onChange={event => setName(event.target.value)}
            className={organizationField}
          />
          <Button type="submit" size="sm" disabled={busy || !name.trim()} className="min-h-11 sm:min-h-0">
            Create organization
          </Button>
        </form>
        {message && (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      <DeleteOrganizationDialog
        organization={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={async () => {
          await refresh();
          setMessage('Deleted.');
        }}
      />
    </section>
  );
}
