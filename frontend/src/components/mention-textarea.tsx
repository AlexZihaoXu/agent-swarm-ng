import { useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { mentionAt, mentionMatches } from '@/lib/mentions';
import { cn } from '@/lib/utils';
import type { ChatAgent } from '@/use-chat';

/**
 * A textarea that completes @mentions of the organization's agents: typing @ lists them under the field; ↑/↓ pick,
 * Enter or Tab insert "@Name " (names may hold spaces), Esc closes. A WAI-ARIA combobox with a listbox popup.
 */
export function MentionTextarea({
  value,
  onValueChange,
  agents,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  agents: ChatAgent[];
}) {
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = mentionAt(value, caret);
  const matches = mention && dismissed !== mention.start ? mentionMatches(agents, mention.query) : [];
  const open = matches.length > 0;
  const current = Math.min(active, matches.length - 1);

  const pick = (agent: ChatAgent) => {
    if (!mention) return;
    const insert = `@${agent.name} `;
    const next = value.slice(0, mention.start) + insert + value.slice(caret);
    const at = mention.start + insert.length;
    onValueChange(next);
    setCaret(at);
    placeCaret.current = at;
  };
  // After the new value is rendered, before anything else is typed: a later frame would move the caret back over
  // what was typed meanwhile.
  const placeCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (placeCaret.current === null || !field.current) return;
    field.current.setSelectionRange(placeCaret.current, placeCaret.current);
    placeCaret.current = null;
  }, [value]);
  const track = (target: HTMLTextAreaElement) => {
    setCaret(target.selectionStart ?? target.value.length);
  };

  return (
    <div className="relative">
      <textarea
        {...props}
        ref={field}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        className={className}
        onChange={event => {
          onValueChange(event.target.value);
          track(event.target);
          setActive(0);
          setDismissed(null);
        }}
        onSelect={event => track(event.currentTarget)}
        onClick={event => track(event.currentTarget)}
        onBlur={() => setDismissed(mention?.start ?? null)}
        onFocus={() => setDismissed(null)}
        onKeyDown={event => {
          if (open && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current + step + matches.length) % matches.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              pick(matches[current]!);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(mention!.start);
              return;
            }
          }
          props.onKeyDown?.(event);
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention an agent"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl motion-safe:animate-[view-in_140ms_ease-out]"
        >
          {matches.map((agent, index) => (
            <li
              key={agent.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              // Keep the focus (and the caret) in the field.
              onMouseDown={event => event.preventDefault()}
              onClick={() => pick(agent)}
              onMouseMove={() => setActive(index)}
              className={cn(
                'flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm md:min-h-0',
                index === current && 'bg-muted',
              )}
            >
              <span className="relative size-6 shrink-0">
                <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={24} state="idle" />
              </span>
              <span className="truncate">{agent.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
