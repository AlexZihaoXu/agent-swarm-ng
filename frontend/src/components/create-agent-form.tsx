import { useEffect, useId, useRef, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { randomizeAvatar } from '@/lib/agent-avatar';
import type { RealAgent } from '@/use-chat';
import { useModelSelection } from '@/use-model-selection';
import { OrganizationField, useCreateOrganization } from '@/components/organization-fields';

const fieldClass =
  'h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:h-10';

export function CreateAgentForm({ onCreated }: { onCreated: (agent: RealAgent) => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => randomizeAvatar());
  // Into the organization shown, or the one chosen while showing all (docs/organizations.md); its owner's
  // connections (docs/users.md).
  const organization = useCreateOrganization();
  const choice = useModelSelection(undefined, organization.value || undefined);
  const { endpoints, endpointId, models, model, levels, thinking, loading } = choice;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const error = createError || choice.error;
  const creation = useRef<AbortController | null>(null);
  useEffect(() => () => creation.current?.abort(), []);

  async function create() {
    setCreating(true);
    setCreateError('');
    const controller = new AbortController();
    creation.current = controller;
    try {
      const { data, error } = await api.POST('/api/agents', {
        body: {
          name: name.trim(),
          endpointId,
          model,
          thinkingLevel: thinking,
          avatar,
          ...(organization.value ? { organizationId: organization.value } : {}),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (error || !data) setCreateError(error?.message ?? 'Could not create agent.');
      else onCreated(data);
    } catch {
      if (!controller.signal.aborted) setCreateError('Could not reach the backend.');
    } finally {
      if (!controller.signal.aborted) setCreating(false);
    }
  }

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void create();
      }}
    >
      <Dialog.Title className="text-lg font-semibold">Create new agent</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
        A Pi agent with saved platform-chat history. It can research the public web and read Swarm Knowledge. It has no
        computer, file, or command access until you assign a computer in its settings.
      </Dialog.Description>
      <fieldset disabled={creating} className="mt-5 min-w-0 space-y-4">
        <div className="space-y-2">
          <label htmlFor={`${id}-name`} className="block text-sm font-medium">
            Agent name
          </label>
          <input
            id={`${id}-name`}
            required
            maxLength={80}
            value={name}
            onChange={event => setName(event.target.value)}
            className={fieldClass}
            {...noAutofill}
            placeholder="Name your agent"
          />
        </div>
        <AgentAvatarPreview name={name} value={avatar} onChange={setAvatar} disabled={creating} />
        <div className="space-y-2">
          <label htmlFor={`${id}-endpoint`} className="block text-sm font-medium">
            Endpoint
          </label>
          <Select
            id={`${id}-endpoint`}
            required
            disabled={creating || endpoints.length === 0}
            value={endpointId}
            onValueChange={choice.chooseEndpoint}
            placeholder="Select a model connection"
            options={endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))}
          />
          {!loading && !choice.loadFailed && endpoints.length === 0 && (
            <p className="text-xs text-muted-foreground">Connect ChatGPT or save an API endpoint in Settings first.</p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-model`} className="block text-sm font-medium">
            Model
          </label>
          <Select
            id={`${id}-model`}
            required
            disabled={creating || loading || models.length === 0}
            value={model}
            onValueChange={choice.chooseModel}
            placeholder={loading && endpointId ? 'Loading models…' : 'Select a model'}
            options={models.map(value => ({ value, label: value }))}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-thinking`} className="block text-sm font-medium">
            Thinking level
          </label>
          <Select
            id={`${id}-thinking`}
            value={thinking}
            disabled={creating || levels.length <= 1}
            onValueChange={value => {
              if (levels.includes(value as RealAgent['thinkingLevel']))
                choice.setThinking(value as RealAgent['thinkingLevel']);
            }}
            options={(levels.length ? levels : ['off']).map(level => ({
              value: level,
              label:
                level === 'off'
                  ? levels.length <= 1
                    ? 'Not configurable'
                    : 'Off'
                  : level[0].toUpperCase() + level.slice(1),
            }))}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {levels.length <= 1
              ? 'Configurable thinking is unsupported or not verified for this model.'
              : 'Pi model capabilities; reasoning support depends on the selected provider.'}
          </p>
        </div>
        <OrganizationField value={organization.value} onChange={organization.setValue} disabled={creating} />
      </fieldset>
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}
          {choice.loadFailed && (
            <>
              {' '}
              <button type="button" onClick={choice.reload} className="cursor-pointer underline">
                Retry
              </button>
            </>
          )}
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Agent and chat history are saved locally. Drafts and internal activity clear on refresh. Only channel-tool
        messages are shown.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0">
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          type="submit"
          size="sm"
          className="min-h-11 sm:min-h-0"
          disabled={creating || !name.trim() || !model || !levels.includes(thinking) || !organization.ready}
        >
          {creating ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </form>
  );
}
