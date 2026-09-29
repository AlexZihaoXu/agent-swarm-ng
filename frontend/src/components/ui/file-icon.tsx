/** A plain folder or document glyph, shared by the file browsers and chat files. */
export function FileIcon({ directory = false, className }: { directory?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-4 shrink-0 text-muted-foreground'}
    >
      <path d={directory ? 'M3 7V5h6l2 2h10v13H3z' : 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6'} />
    </svg>
  );
}
