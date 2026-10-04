import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ColorSwatches } from '@/components/ui/color-swatches';
import { SliderField } from '@/components/ui/slider-field';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { AvatarFace, PresenceIndicator, TypingDots } from '@/components/typing-indicator';
import { lookDirections, type Gaze } from '@/lib/avatar-perspective';
import {
  accentColor,
  avatarAccessories,
  avatarColors,
  avatarMarkings,
  avatarMouths,
  avatarRanges,
  avatarShapes,
  avatarStates,
  clampTrait,
  mutateAvatar,
  randomizeAvatar,
  type AvatarAppearance,
  type AvatarRange,
  type AvatarState,
} from '@/lib/agent-avatar';

function AvatarSample({
  value,
  state,
  size,
  animated,
  look,
}: {
  value: AvatarAppearance;
  state: AvatarState;
  size: number;
  animated: boolean;
  look?: Gaze;
}) {
  const status = { ready: true, working: state !== 'idle', typing: state === 'typing' };
  return (
    <span
      aria-hidden="true"
      className="relative shrink-0"
      style={{ width: size, height: size }}
      data-avatar-sample={size}
    >
      <span className="absolute left-0 top-0 size-8 origin-top-left" style={{ transform: `scale(${size / 32})` }}>
        <AvatarFace avatarSize={32} size="md" {...status}>
          <AgentAvatarArt {...value} state={state} size={32} animated={animated} look={look} />
        </AvatarFace>
        <PresenceIndicator size="md" {...status} />
      </span>
    </span>
  );
}

const rangeDefaults: Record<AvatarRange, number> = { stretch: 0, taper: 0, wobble: 0, eyeSize: 1, eyeGap: 0 };
const VARIATIONS = 8;

/** One labelled group of the editor. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      {children}
    </div>
  );
}

export function AgentAvatarPreview({
  name,
  value,
  onChange,
  disabled = false,
  collapsible = true,
}: {
  name: string;
  value: AvatarAppearance;
  onChange: (avatar: AvatarAppearance) => void;
  disabled?: boolean;
  collapsible?: boolean;
}) {
  const id = useId();
  const [state, setState] = useState<AvatarState>('idle');
  const [disclosed, setExpanded] = useState(true);
  const expanded = !collapsible || disclosed;
  const [direction, setDirection] = useState('natural');
  const [fineTune, setFineTune] = useState(false);
  // Earlier looks, newest last, so a roll or a picked variation can be undone.
  const [history, setHistory] = useState<AvatarAppearance[]>([]);
  const [round, setRound] = useState(1);
  const look = lookDirections.find(item => item.value === direction)?.gaze;
  const label = avatarShapes.find(item => item.id === value.shape)!.label;
  const stateLabel = avatarStates.find(item => item.value === state)!.label;
  const animated = expanded && !disabled;
  const colors: { value: string; label: string }[] = avatarColors.map(item => ({
    value: item.value,
    label: item.label,
  }));
  if (!colors.some(item => item.value === value.color.toLowerCase()))
    colors.push({ value: value.color.toLowerCase(), label: `Custom (${value.color})` });
  const variations = Array.from({ length: VARIATIONS }, (_, i) => mutateAvatar(value, round * 100 + i + 1));
  /** A new look that can be undone. */
  const adopt = (next: AvatarAppearance) => {
    setHistory(current => [...current.slice(-9), value]);
    onChange(next);
  };
  const set = (patch: Partial<AvatarAppearance>) => onChange({ ...value, ...patch });

  return (
    <section className="rounded-lg border border-border bg-sidebar/30 ao-card p-3">
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={() => setExpanded(open => !open)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-1 rounded-sm text-left text-sm font-medium outline-none transition-colors sm:min-h-0 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
          >
            <path d="m4 2 5 4-5 4z" />
          </svg>
          Avatar
        </button>
      )}
      <div
        id={`${id}-content`}
        data-slot="avatar-disclosure"
        aria-hidden={!expanded}
        inert={!expanded}
        className={`grid transition-[grid-template-rows,opacity] duration-240 ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`${collapsible ? 'mt-3 ' : ''}space-y-4`}>
            {/* The live preview and its preview-only controls; nothing in this card is saved. */}
            <div className="space-y-3 rounded-lg bg-background p-3">
              <div
                role="img"
                aria-label={`${label} avatar, ${stateLabel.toLowerCase()} state`}
                data-testid="agent-avatar-preview"
                className="flex items-center gap-4"
              >
                <AvatarSample value={value} state={state} size={80} animated={animated} look={look} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={name.trim() || 'Your agent'}>
                    {name.trim() || 'Your agent'}
                  </p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {state === 'typing' && <TypingDots compact />}
                    {state === 'idle'
                      ? 'Ready to chat'
                      : state === 'working'
                        ? 'Agent is working…'
                        : 'Agent is typing…'}
                  </p>
                  {/* How it reads where it is actually used: a sidebar row. */}
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-sidebar/60 px-2 py-1.5">
                    <AvatarSample value={value} state={state} size={32} animated={animated} look={look} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{name.trim() || 'Your agent'}</span>
                      <span className="block text-[10px] text-muted-foreground">Sidebar size</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">State preview</p>
                  <ChoiceChips label="State preview" value={state} options={avatarStates} onChange={setState} />
                </div>
                <div className="min-w-36 flex-1 space-y-1.5">
                  <label htmlFor={`${id}-look`} className="block text-[11px] text-muted-foreground">
                    Look preview
                  </label>
                  <Select
                    id={`${id}-look`}
                    value={direction}
                    options={[...lookDirections]}
                    onValueChange={next => {
                      if (lookDirections.some(item => item.value === next)) setDirection(next);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Steer by picking: close relatives of the current look. */}
            <Field label="Variations">
              <div role="group" aria-label="Variations" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {variations.map((variant, index) => (
                  <button
                    key={`${round}:${index}`}
                    type="button"
                    disabled={disabled}
                    aria-label={`Use variation ${index + 1}`}
                    onClick={() => adopt(variant)}
                    className="card-enter flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-border bg-background outline-none transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ animationDelay: `${index * 25}ms` }}
                  >
                    <AgentAvatarArt {...variant} size={36} />
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  disabled={disabled}
                  onClick={() => setRound(value => value + 1)}
                >
                  More variations
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  disabled={disabled}
                  onClick={() => adopt(randomizeAvatar(value))}
                >
                  Randomize
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  disabled={disabled || history.length === 0}
                  onClick={() => {
                    const previous = history.at(-1);
                    if (!previous) return;
                    setHistory(current => current.slice(0, -1));
                    onChange(previous);
                  }}
                >
                  Undo
                </Button>
              </div>
            </Field>

            <div role="group" aria-label="Avatar shape" className="grid grid-cols-4 gap-2">
              {avatarShapes.map(item => (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`Preview ${item.label}`}
                  aria-pressed={value.shape === item.id}
                  onClick={() => set({ shape: item.id })}
                  className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-[11px] aria-pressed:border-foreground/60 aria-pressed:bg-muted"
                >
                  <AgentAvatarArt {...value} shape={item.id} size={32} />
                  {item.label}
                </Button>
              ))}
            </div>

            <Field label="Color">
              <ColorSwatches
                label="Avatar color"
                value={value.color}
                colors={colors}
                disabled={disabled}
                onChange={color => set({ color })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyes">
                <ChoiceChips
                  label="Eye shape"
                  value={value.eyeStyle ?? 'pill'}
                  disabled={disabled}
                  options={[
                    { value: 'pill', label: 'Rounded pills' },
                    { value: 'round', label: 'Circles' },
                  ]}
                  onChange={eyeStyle => set({ eyeStyle })}
                />
              </Field>
              <Field label="Mouth">
                <ChoiceChips
                  label="Mouth"
                  value={value.mouth ?? 'none'}
                  disabled={disabled}
                  options={avatarMouths}
                  onChange={mouth => set({ mouth })}
                />
              </Field>
              <Field label="Markings">
                <ChoiceChips
                  label="Markings"
                  value={value.marking ?? 'none'}
                  disabled={disabled}
                  options={avatarMarkings}
                  onChange={marking => set({ marking })}
                />
              </Field>
              <Field label="Accessory">
                <ChoiceChips
                  label="Accessory"
                  value={value.accessory ?? 'none'}
                  disabled={disabled}
                  options={avatarAccessories}
                  onChange={accessory => set({ accessory })}
                />
              </Field>
            </div>
            {((value.marking ?? 'none') !== 'none' || ['antenna', 'bow'].includes(value.accessory ?? 'none')) && (
              <Field label="Accent color">
                <ColorSwatches
                  label="Accent color"
                  value={value.accent ?? 'auto'}
                  colors={colors}
                  automatic={accentColor({ color: value.color })}
                  disabled={disabled}
                  onChange={accent => set({ accent: accent === 'auto' ? undefined : accent })}
                />
              </Field>
            )}

            <div className="rounded-lg border border-border">
              <button
                type="button"
                aria-expanded={fineTune}
                onClick={() => setFineTune(open => !open)}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              >
                Fine tune proportions
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 12"
                  className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${fineTune ? 'rotate-90' : ''}`}
                  fill="currentColor"
                >
                  <path d="m4 2 5 4-5 4z" />
                </svg>
              </button>
              {fineTune && (
                <div className="view-enter space-y-3 border-t border-border p-3">
                  {(Object.keys(avatarRanges) as AvatarRange[]).map(trait => (
                    <SliderField
                      key={trait}
                      label={avatarRanges[trait].label}
                      value={value[trait] ?? rangeDefaults[trait]}
                      min={avatarRanges[trait].min}
                      max={avatarRanges[trait].max}
                      disabled={disabled}
                      onChange={next => set({ [trait]: clampTrait(trait, next) })}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => set({ stretch: 0, taper: 0, wobble: 0, eyeSize: 1, eyeGap: 0 })}
                  >
                    Reset proportions
                  </Button>
                </div>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Everything below the preview card is saved. State and look previews are not; live agents show their actual
              state and natural glances.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
