import { useId, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useOrganizations } from '@/lib/organizations';

/**
 * Where a new agent, computer or group goes: shown only while the dashboard shows all of several organizations
 * (otherwise it goes to the one shown). Same Select as the form's other choices.
 */
export function OrganizationField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const { organizations, target } = useOrganizations();
  if (target || organizations.length < 2) return null;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Organization
      </label>
      <Select
        id={id}
        required
        disabled={disabled}
        value={value}
        onValueChange={onChange}
        placeholder="Choose an organization"
        options={organizations.map(org => ({ value: org.id, label: org.name }))}
      />
    </div>
  );
}

/** The organization a new thing goes to: the one shown, else the one chosen in OrganizationField. */
export function useCreateOrganization() {
  const { target, organizations } = useOrganizations();
  const [chosen, setChosen] = useState('');
  const value = target ?? (organizations.some(org => org.id === chosen) ? chosen : '');
  return { value, setValue: setChosen, ready: Boolean(value) || organizations.length === 0 };
}

/**
 * Agent settings, computer settings and the group editor: move it to another organization. The confirmation lists
 * what the move drops (assignments, DM permissions, group memberships that would cross organizations).
 */
export function MoveToOrganization({
  kind,
  id,
  name,
  organizationId,
  onMoved,
}: {
  kind: 'agent' | 'computer' | 'group';
  id: string;
  name: string;
  organizationId: string;
  onMoved: (organizationId: string) => void;
}) {
  const fieldId = useId();
  const { organizations, nameOf, refresh, current, setCurrent } = useOrganizations();
  const [to, setTo] = useState('');
  const [dropped, setDropped] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const others = organizations.filter(org => org.id !== organizationId);
  const move = (apply: boolean) =>
    api.POST('/api/organizations/{id}/move', { params: { path: { id: to } }, body: { kind, id, apply } });
  async function preview() {
    setBusy(true);
    setError('');
    try {
      const { data, error: failure } = await move(false);
      if (!data) throw new Error(failure?.message ?? 'Could not check the move.');
      setDropped(data.dropped);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check the move.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium">
        Organization
      </label>
      <p className="text-xs text-muted-foreground">
        In {nameOf(organizationId) || 'its organization'}. It reaches only{' '}
        {kind === 'computer' ? 'agents' : 'agents and computers'} of the same organization.
      </p>
      {others.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1 sm:max-w-64">
            <Select
              id={fieldId}
              value={to}
              onValueChange={setTo}
              placeholder="Move to…"
              options={others.map(org => ({ value: org.id, label: org.name }))}
            />
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!to || busy} onClick={() => void preview()}>
            Move
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Create another organization in Settings to move it there.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={dropped !== null}
        onOpenChange={open => {
          if (!open) setDropped(null);
        }}
        title={`Move ${name} to ${nameOf(to)}?`}
        description={
          dropped?.length ? (
            <>
              <span className="block">Links that would cross organizations are removed:</span>
              <span className="mt-2 block">
                {dropped.map(line => (
                  <span key={line} className="block">
                    · {line}
                  </span>
                ))}
              </span>
            </>
          ) : (
            'Nothing it is linked to is left behind.'
          )
        }
        confirmLabel="Move"
        busyLabel="Moving…"
        onConfirm={async () => {
          const { data, error: failure } = await move(true);
          if (!data) throw new Error(failure?.message ?? 'Could not move it.');
          await refresh();
          // The dashboard follows it to its new organization (unless it shows them all).
          if (current !== 'all') setCurrent(to);
          onMoved(to);
          setTo('');
        }}
      />
    </div>
  );
}
