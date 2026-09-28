import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { MessageReply } from '@/components/message-reply';

export function ChatComposer({ name, draft, onChange, onSend, busy, onStop, disabled, inputRef, reply, onCancelReply }: {
  name: string; draft: string; onChange: (text: string) => void; onSend: () => void; busy?: boolean; onStop?: () => void; disabled?: boolean; inputRef?: RefObject<HTMLTextAreaElement | null>;
  reply?: { author: string; text: string }; onCancelReply?: () => void;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  useLayoutEffect(() => {
    const input = ref.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 128)}px`; }
  }, [draft, name]);
  const send = () => { if (!disabled && draft.trim()) onSend(); };
  return <form aria-label="Message composer" onSubmit={event => { event.preventDefault(); send(); }} className="rounded-3xl border border-foreground/20 bg-transparent p-3 focus-within:ring-1 focus-within:ring-ring sm:p-2">
    {reply && <div className="mb-2 px-2 pt-1"><MessageReply {...reply} onCancel={onCancelReply} /></div>}
    <div className="flex items-end gap-2">
    <textarea ref={ref} rows={1} value={draft} maxLength={20000} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      // Phone keyboards have no Shift+Enter: there Enter starts a new line and the Send button sends.
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); send(); }
    }} enterKeyHint={typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'enter' : 'send'} aria-label={`Message ${name}`} placeholder={`Message ${name}…`} className="max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-3 text-base leading-5 outline-none placeholder:text-muted-foreground sm:min-h-7 sm:py-1 sm:text-sm" />
    {busy && onStop && <Button type="button" size="sm" aria-label="Stop response" className="size-11 shrink-0 rounded-full p-0 sm:size-7" onClick={onStop}><span aria-hidden="true" className="size-2.5 rounded-sm bg-current" /></Button>}
    {(!busy || draft.trim()) && <Button type="submit" size="sm" disabled={disabled || !draft.trim()} aria-label="Send message" className="size-11 shrink-0 rounded-full p-0 sm:size-7"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>}</div>
  </form>;
}
