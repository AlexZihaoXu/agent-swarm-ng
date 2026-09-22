import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';

export function ChatComposer({ name, draft, onChange, onSend, busy, onStop, disabled, inputRef }: {
  name: string; draft: string; onChange: (text: string) => void; onSend: () => void; busy?: boolean; onStop?: () => void; disabled?: boolean; inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  useLayoutEffect(() => {
    const input = ref.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 128)}px`; }
  }, [draft, name]);
  const send = () => { if (!disabled && draft.trim()) onSend(); };
  return <form aria-label="Message composer" onSubmit={event => { event.preventDefault(); send(); }} className="flex items-end gap-2 rounded-3xl border border-foreground/20 bg-transparent p-2 focus-within:ring-1 focus-within:ring-ring">
    <button type="button" disabled aria-label="Add attachment" title="Attachments aren’t available in this preview" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
    </button>
    <textarea ref={ref} rows={1} value={draft} maxLength={20000} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(); }
    }} aria-label={`Message ${name}`} placeholder={`Message ${name}…`} className="max-h-32 min-h-7 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground" />
    {busy && onStop && <Button type="button" size="sm" aria-label="Stop response" className="size-7 shrink-0 rounded-full p-0" onClick={onStop}><span aria-hidden="true" className="size-2.5 rounded-sm bg-current" /></Button>}
    {(!busy || draft.trim()) && <Button type="submit" size="sm" disabled={disabled || !draft.trim()} aria-label="Send message" className="size-7 shrink-0 rounded-full p-0"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>}
  </form>;
}
