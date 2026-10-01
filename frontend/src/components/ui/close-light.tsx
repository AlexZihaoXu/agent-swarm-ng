/** A floating window's single traffic light: red with its "×" (grey while its window is not focused). */
export function CloseLight({ label, onClick, dim = false }: { label: string; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Close"
      onClick={onClick}
      className={`group flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        dim ? 'border-white/15 bg-white/20 hover:border-[#e0443e] hover:bg-[#ff5f57]' : 'border-[#e0443e] bg-[#ff5f57]'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className={`size-2 ${dim ? 'text-black/40 group-hover:text-[#4d0000]' : 'text-[#4d0000]'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="m3.5 3.5 5 5m0-5-5 5" />
      </svg>
    </button>
  );
}

/** A floating window's yellow light: minimizes it into the dock (grey while its window is not focused). */
export function MinimizeLight({ label, onClick, dim = false }: { label: string; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Minimize"
      onClick={onClick}
      className={`group flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        dim ? 'border-white/15 bg-white/20 hover:border-[#dea123] hover:bg-[#febc2e]' : 'border-[#dea123] bg-[#febc2e]'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className={`size-2 ${dim ? 'text-black/40 group-hover:text-[#5a3d00]' : 'text-[#5a3d00]'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M3 6h6" />
      </svg>
    </button>
  );
}
