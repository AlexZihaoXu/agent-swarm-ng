import { useId } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import { Button } from '@/components/ui/button';
import type { ComputerLimits, ComputerSettingsDraft } from '@/lib/computer-settings';

const zones = [
  'America/Toronto',
  'Etc/UTC',
  ...((typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []) as string[]),
];

export function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  disabled: boolean;
  /** Replaces the default "min–max unit available for one computer" line. */
  hint?: string;
}) {
  const id = useId();
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {/* Kibo's Number Input with Controls composition, using existing Button
        primitives and bounded values rather than its demo-only state. */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Decrease ${label}`}
          disabled={disabled || !valid || parsed <= min}
          onClick={() => onChange(String(Math.max(min, parsed - 1)))}
          className="min-h-11 min-w-11 cursor-pointer px-2"
        >
          −
        </Button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-sidebar px-3 text-center text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Increase ${label}`}
          disabled={disabled || !valid || parsed >= max}
          onClick={() => onChange(String(Math.min(max, parsed + 1)))}
          className="min-h-11 min-w-11 cursor-pointer px-2"
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint ?? `${min}–${max} ${unit} available for one computer`}</p>
    </div>
  );
}

export function ComputerResourceFields({
  limits,
  value,
  onChange,
  disabled = false,
}: {
  limits: ComputerLimits;
  value: ComputerSettingsDraft;
  onChange: (value: ComputerSettingsDraft) => void;
  disabled?: boolean;
}) {
  const timezoneId = useId(),
    listId = useId();
  return (
    <div className="mt-5 space-y-5">
      <NumberField
        label="CPU cores"
        unit="cores"
        value={value.cpuCores}
        min={limits.cpuCores.min}
        max={limits.cpuCores.max}
        disabled={disabled}
        onChange={cpuCores => onChange({ ...value, cpuCores })}
      />
      <NumberField
        label="Memory (GiB RAM)"
        unit="GiB RAM"
        value={value.memoryGiB}
        min={limits.memoryGiB.min}
        max={limits.memoryGiB.max}
        disabled={disabled}
        onChange={memoryGiB => onChange({ ...value, memoryGiB })}
      />
      <p className="text-xs text-muted-foreground">
        This computer may use up to the same amount of additional host swap. Swap is slower than RAM and does not live
        in its Keep or Cache folder. Several computers can reserve more than the host has available.
      </p>
      <div className="space-y-2">
        <label htmlFor={timezoneId} className="block text-sm font-medium">
          Timezone
        </label>
        <input
          id={timezoneId}
          list={listId}
          type="text"
          maxLength={64}
          {...noAutofill}
          spellCheck={false}
          value={value.timezone}
          disabled={disabled}
          onChange={event => onChange({ ...value, timezone: event.target.value })}
          className="ao-inset h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <datalist id={listId}>
          {[...new Set(zones)].map(zone => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
