import { noAutofill } from '@/lib/no-autofill';
import { settingsInput } from '@/lib/styles';

/** Model limits (docs/development.md#model-limits): the backend's ranges, shared by endpoints and agents' models. */
export const CONTEXT_RANGE = { min: 1024, max: 10_000_000 };
export const REPLY_RANGE = { min: 256, max: 1_000_000 };
export const tokens = (value: number) => value.toLocaleString('en-US');
/** A typed token count ("131,072" works too): undefined when empty, NaN when it is not a whole number in range. */
export function parseTokens(value: string, range: { min: number; max: number }) {
  const digits = value.replace(/[\s,_]/g, '');
  if (!digits) return undefined;
  const parsed = /^\d+$/.test(digits) ? Number(digits) : NaN;
  return parsed >= range.min && parsed <= range.max ? parsed : NaN;
}

/** An optional token count with its explanation (empty: the default its placeholder names). */
export function TokenField({
  id,
  label,
  value,
  onChange,
  invalid,
  range,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  range: { min: number; max: number };
  placeholder: string;
  help: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        {...noAutofill}
        className={settingsInput}
      />
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
        {invalid ? `Enter a whole number from ${tokens(range.min)} to ${tokens(range.max)}.` : help}
      </p>
    </div>
  );
}
