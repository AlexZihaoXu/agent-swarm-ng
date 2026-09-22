import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';

export function EditAgentAvatarForm({ agent, onSave, onDone, onBusyChange }: {
  agent: ChatAgent; onSave: (agent: ChatAgent, avatar: AvatarAppearance) => Promise<void>;
  onDone: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [avatar, setAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError('');
    try { await onSave(agent, avatar); onDone(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the avatar.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <Dialog.Title className="text-lg font-semibold">Edit avatar</Dialog.Title>
    <Dialog.Description className="mt-2 break-words text-sm text-muted-foreground">Update {agent.name}’s appearance. Model settings and chat history stay unchanged.</Dialog.Description>
    <div className="mt-5"><AgentAvatarPreview name={agent.name} value={avatar} onChange={setAvatar} disabled={busy} /></div>
    {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
    <div className="mt-6 flex justify-end gap-2">
      <Dialog.Close asChild><Button type="button" variant="outline" size="sm" disabled={busy}>Cancel</Button></Dialog.Close>
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save avatar'}</Button>
    </div>
  </form>;
}
