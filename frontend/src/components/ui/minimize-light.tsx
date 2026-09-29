/** A floating window's single traffic light: yellow, showing "−" on hover, minimizing the window. */
export function MinimizeLight({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Minimize"
      onClick={onClick}
      className="group flex size-3 shrink-0 items-center justify-center rounded-full border border-[#dc9e2b] bg-[#febc2e] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="h-[1.5px] w-1.5 rounded bg-[#8d5a0e] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
