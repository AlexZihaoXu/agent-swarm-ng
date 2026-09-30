import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EditorBubbleMenu, EditorProvider, EditorWordCount } from '@/components/ui/editor';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';

const LIMIT = 20000;

/**
 * Agents → agent → Instructions: the owner's own instructions for this agent, written in a rich-text editor (Kibo
 * UI's Editor) and kept as Markdown. They come last in the agent's system prompt from its next turn. Saving warns,
 * in plain words, that the next reply re-reads everything once (the model's prompt cache no longer matches).
 */
export function AgentInstructionsSettings({
  agent,
  onSaved,
  register,
}: {
  agent: ChatAgent & { real: RealAgent };
  onSaved: (agent: RealAgent) => void;
  register: RegisterSection;
}) {
  const saved = agent.real.instructions ?? '';
  const [draft, setDraft] = useState(saved);
  // The editor reads its content once: a new key starts it over from the saved text (Discard, or after saving).
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const dirty = draft.trim() !== saved.trim();
  const tooLong = draft.length > LIMIT;

  async function persist() {
    const { data, error } = await api.PATCH('/api/agents/{id}', {
      params: { path: { id: agent.id } },
      body: { instructions: draft.trim() },
    });
    if (!data || error) throw new Error(error?.message ?? 'Could not save the instructions.');
    onSaved(data);
    setDraft(data.instructions);
    setStatus('Saved. The agent follows them from its next turn.');
  }
  const latest = useRef({
    save: async () => {},
    discard: () => {},
  });
  latest.current = {
    // The page's Save waits for the owner to confirm (or cancel) the warning.
    save: () => {
      if (tooLong) return Promise.reject(new Error(`Instructions are at most ${LIMIT.toLocaleString()} characters.`));
      setStatus('');
      setConfirming(true);
      return new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
      });
    },
    discard: () => {
      setDraft(saved);
      setVersion(value => value + 1);
      setStatus('');
    },
  };
  useEffect(() => {
    register('instructions', {
      label: 'Instructions',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('instructions');
  }, [dirty, register]);

  return (
    <section aria-label="Instructions" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Instructions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your own guidance for this agent: how it should work, what it should know about you, what to avoid. It reads
          them at the start of everything it does. Select text to format it. Use Save changes at the bottom.
        </p>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-sidebar/30 p-4">
        <div className="relative rounded-lg border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
          <EditorProvider
            key={`${agent.id}:${version}`}
            markdown={draft}
            onChange={markdown => {
              setDraft(markdown);
              setStatus('');
            }}
            placeholder="For example: Answer in British English. Keep replies short. Ask before spending money."
            limit={LIMIT}
            label={`Instructions for ${agent.name}`}
          >
            <EditorBubbleMenu />
            <EditorWordCount limit={LIMIT} />
          </EditorProvider>
        </div>
        {tooLong && (
          <p role="alert" className="text-xs text-red-400">
            Instructions are at most {LIMIT.toLocaleString()} characters.
          </p>
        )}
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={open => {
          setConfirming(open);
          // Closed without saving: the page keeps the change unsaved.
          if (!open && pending.current) {
            pending.current.reject(new Error('Instructions not saved.'));
            pending.current = null;
          }
        }}
        title="Save new instructions?"
        description={
          <>
            <span className="block">
              {agent.name} reads its instructions at the start of everything it does. To reply quickly and cheaply, the
              AI service keeps a ready-made copy of that beginning (a cache).
            </span>
            <span className="mt-2 block">
              New instructions no longer match that copy, so {agent.name}’s next reply has to read its whole
              conversation again from the start. That one reply is slower and uses more of your plan or budget; after
              it, things are back to normal. Nothing is forgotten: its conversation and history stay.
            </span>
          </>
        }
        confirmLabel="Save instructions"
        busyLabel="Saving…"
        onConfirm={async () => {
          try {
            await persist();
            pending.current?.resolve();
          } catch (error) {
            // Shown in the dialog; the owner can retry or cancel.
            throw error;
          }
          pending.current = null;
        }}
      />
    </section>
  );
}
