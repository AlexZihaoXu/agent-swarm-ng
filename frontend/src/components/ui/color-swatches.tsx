import * as RadioGroup from '@radix-ui/react-radio-group';

/** Colours shown as colours: a row of round swatches, the chosen one ringed (a radio group underneath). */
export function ColorSwatches({
  label,
  value,
  colors,
  onChange,
  disabled,
  automatic,
}: {
  label: string;
  value: string;
  colors: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Offers an "Automatic" swatch first (value "auto"), drawn in the colour it would produce. */
  automatic?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value.toLowerCase()}
      disabled={disabled}
      orientation="horizontal"
      onValueChange={onChange}
      className="flex flex-wrap gap-2"
    >
      {automatic && (
        <RadioGroup.Item
          value="auto"
          aria-label="Automatic"
          title="Automatic: follows the body color"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-foreground/50 text-[10px] font-semibold text-black/60 outline-none ring-offset-2 ring-offset-background transition-[transform,box-shadow] duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground motion-reduce:transition-none sm:size-7"
          style={{ backgroundColor: automatic }}
        >
          A
        </RadioGroup.Item>
      )}
      {colors.map(color => (
        <RadioGroup.Item
          key={color.value}
          value={color.value.toLowerCase()}
          aria-label={color.label}
          title={color.label}
          className="size-8 cursor-pointer rounded-full border-2 border-transparent outline-none ring-offset-2 ring-offset-background transition-[transform,box-shadow] duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground motion-reduce:transition-none sm:size-7"
          style={{ backgroundColor: color.value }}
        />
      ))}
    </RadioGroup.Root>
  );
}
