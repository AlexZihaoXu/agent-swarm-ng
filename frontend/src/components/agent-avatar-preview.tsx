import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { AvatarFace, PresenceIndicator, TypingDots } from '@/components/typing-indicator';
import { lookDirections, type Gaze } from '@/lib/avatar-perspective';
import { avatarShapes, avatarColors, avatarStates, randomizeAvatar, type AvatarAppearance, type AvatarState } from '@/lib/agent-avatar';

function AvatarSample({ value, state, size, animated, look }: { value: AvatarAppearance; state: AvatarState; size: number; animated: boolean; look?: Gaze }) {
  const status = { ready: true, working: state !== 'idle', typing: state === 'typing' };
  return <span aria-hidden="true" className="relative shrink-0" style={{ width: size, height: size }} data-avatar-sample={size}>
    <span className="absolute left-0 top-0 size-8 origin-top-left" style={{ transform: `scale(${size / 32})` }}>
      <AvatarFace avatarSize={32} size="md" {...status}><AgentAvatarArt {...value} state={state} size={32} animated={animated} look={look} /></AvatarFace>
      <PresenceIndicator size="md" {...status} />
    </span>
  </span>;
}

export function AgentAvatarPreview({ name, value, onChange, disabled = false, collapsible = true }: {
  name: string; value: AvatarAppearance; onChange: (avatar: AvatarAppearance) => void; disabled?: boolean; collapsible?: boolean;
}) {
  const id = useId();
  const [state, setState] = useState<AvatarState>('idle');
  const [disclosed, setExpanded] = useState(true);
  const expanded = !collapsible || disclosed;
  const [direction, setDirection] = useState('natural');
  const look = lookDirections.find(item => item.value === direction)?.gaze;
  const label = avatarShapes.find(item => item.id === value.shape)!.label;
  const stateLabel = avatarStates.find(item => item.value === state)!.label;
  const colors = avatarColors.map(item => ({ value: String(item.value), label: String(item.label) }));
  if (!colors.some(item => item.value === value.color)) colors.push({ value: value.color, label: `Custom (${value.color})` });
  return <section className="rounded-lg border border-border bg-sidebar/30 p-3">
    {collapsible && <button type="button" aria-expanded={expanded} aria-controls={`${id}-content`} onClick={() => setExpanded(open => !open)} className="flex w-full cursor-pointer items-center gap-1 rounded-sm text-left text-sm font-medium outline-none transition-colors hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
      <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} fill="currentColor"><path d="m4 2 5 4-5 4z" /></svg>Avatar
    </button>}
    <div id={`${id}-content`} data-slot="avatar-disclosure" aria-hidden={!expanded} inert={!expanded} className={`grid transition-[grid-template-rows,opacity] duration-240 ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
    <div className="min-h-0 overflow-hidden"><div className={`${collapsible ? 'mt-3 ' : ''}space-y-3`}>
      <div role="img" aria-label={`${label} avatar, ${stateLabel.toLowerCase()} state`} data-testid="agent-avatar-preview" className="flex items-center gap-4 rounded-lg bg-background px-3 py-2">
        <AvatarSample value={value} state={state} size={80} animated={expanded && !disabled} look={look} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={name.trim() || 'Your agent'}>{name.trim() || 'Your agent'}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">{state === 'typing' && <TypingDots compact />}{state === 'idle' ? 'Ready to chat' : state === 'working' ? 'Agent is working…' : 'Agent is typing…'}</p>
          <div className="mt-1 flex items-center gap-2"><AvatarSample value={value} state={state} size={32} animated={expanded && !disabled} look={look} /><span className="text-[11px] text-muted-foreground">Sidebar size</span></div>
        </div>
      </div>
      <div role="group" aria-label="Avatar shape" className="grid grid-cols-4 gap-2">
        {avatarShapes.map(item => <Button key={item.id} type="button" variant="outline" disabled={disabled} aria-label={`Preview ${item.label}`} aria-pressed={value.shape === item.id} onClick={() => onChange({ ...value, shape: item.id })} className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-[11px] aria-pressed:border-foreground/60 aria-pressed:bg-muted">
          <AgentAvatarArt {...value} shape={item.id} size={32} />{item.label}
        </Button>)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-color`} className="block text-xs font-medium">Avatar color</label>
          <Select id={`${id}-color`} value={value.color} disabled={disabled} options={colors} onValueChange={color => onChange({ ...value, color })} />
        </div>
        <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-eyes`} className="block text-xs font-medium">Eye shape</label>
          <Select id={`${id}-eyes`} value={value.eyeStyle ?? 'pill'} disabled={disabled} options={[{ value: 'pill', label: 'Rounded pills' }, { value: 'round', label: 'Circles' }]} onValueChange={eyeStyle => { if (eyeStyle === 'pill' || eyeStyle === 'round') onChange({ ...value, eyeStyle }); }} />
        </div>
        <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-state`} className="block text-xs font-medium">State preview</label>
          <Select id={`${id}-state`} value={state} disabled={disabled} options={avatarStates} onValueChange={next => { const found = avatarStates.find(item => item.value === next); if (found) setState(found.value); }} />
        </div>
        <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-look`} className="block text-xs font-medium">Look preview</label>
          <Select id={`${id}-look`} value={direction} disabled={disabled} options={[...lookDirections]} onValueChange={next => { if (lookDirections.some(item => item.value === next)) setDirection(next); }} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(randomizeAvatar(value))}>Randomize</Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">New shape, color, eyes and motion variation. State preview stays unchanged.</p>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Shape, color and variation are saved. State and look previews are not saved. Live agents use their actual state and natural glances.</p>
    </div></div></div>
  </section>;
}
