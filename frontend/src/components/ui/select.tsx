import * as SelectPrimitive from '@radix-ui/react-select';

// Adapted from Kibo field/selects/field-selects-1 and its shadcn Select composition.
export function Select({ id, value, onValueChange, options, placeholder, disabled, required }: {
  id: string; value: string; onValueChange: (value: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean; required?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} required={required}>
      <SelectPrimitive.Trigger id={id} className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 text-left text-sm outline-none data-[placeholder]:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted enabled:data-[state=open]:bg-muted transition-colors duration-120 motion-reduce:transition-none [&>span:first-child]:truncate">
        <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
        <SelectPrimitive.Icon><Chevron /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" align="start" sideOffset={4} collisionPadding={12} className="z-[60] flex flex-col max-h-[min(18rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-sidebar text-foreground shadow-lg origin-[var(--radix-select-content-transform-origin)] motion-safe:data-[state=open]:animate-[dialog-in_120ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_100ms_ease-in]">
          <SelectPrimitive.ScrollUpButton className="flex justify-center py-1"><Chevron up /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="min-h-0 p-1">
            {options.map(option => (
              <SelectPrimitive.Item key={option.value} value={option.value} className="relative flex cursor-pointer items-center rounded-md py-2 pl-3 pr-8 text-sm outline-none select-none hover:bg-muted data-[highlighted]:bg-muted transition-colors duration-120 motion-reduce:transition-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40">
                <SelectPrimitive.ItemText><span className="block break-words [overflow-wrap:anywhere]">{option.label}</span></SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m5 12 4 4L19 6" /></svg></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex justify-center py-1"><Chevron /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 shrink-0 text-muted-foreground ${up ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 9 6 6 6-6" /></svg>;
}
