/** A floating window's single traffic light: yellow with its "−" (grey while its window is not focused). */
export function MinimizeLight({ label, onClick, dim = false }: { label: string; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Minimize"
      onClick={onClick}
      className={`group flex size-3 shrink-0 items-center justify-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        dim ? 'border-white/15 bg-white/20 hover:border-[#dc9e2b] hover:bg-[#febc2e]' : 'border-[#dc9e2b] bg-[#febc2e]'
      }`}
    >
      <span className={`h-[1.5px] w-1.5 rounded ${dim ? 'bg-black/40 group-hover:bg-[#8d5a0e]' : 'bg-[#8d5a0e]'}`} />
    </button>
  );
}
