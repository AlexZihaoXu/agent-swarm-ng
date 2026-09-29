import { useId } from 'react';
import * as Slider from '@radix-ui/react-slider';

/** A labelled slider with its value beside the label (Kibo slider-settings-1, "Volume Control"). */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 0.05,
  format = (value: number) => value.toFixed(2),
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label id={id} className="text-xs font-medium">
          {label}
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider.Root
        aria-labelledby={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([next]) => onChange(next)}
        className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-50"
      >
        <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-muted">
          <Slider.Range className="absolute h-full bg-foreground/60" />
        </Slider.Track>
        <Slider.Thumb
          aria-label={label}
          className="block size-4 cursor-grab rounded-full border border-foreground/40 bg-foreground shadow outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing motion-reduce:transition-none"
        />
      </Slider.Root>
    </div>
  );
}
