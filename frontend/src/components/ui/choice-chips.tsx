import type { ReactNode } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

/**
 * One choice from a short list, as a row of chips (a single-selection toggle group in the style of Kibo
 * toggle-group-standard, built on a radio group so arrow keys move between choices).
 */
export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      disabled={disabled}
      orientation="horizontal"
      onValueChange={next => onChange(next as T)}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {options.map(option => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-foreground/50 data-[state=checked]:bg-muted data-[state=checked]:text-foreground sm:min-h-7"
        >
          {option.icon}
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
