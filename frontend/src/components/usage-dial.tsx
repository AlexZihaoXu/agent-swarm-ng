// Small circular usage dial. Kibo's catalogue has no radial progress pattern
// (its `progress` patterns are linear bars and `chart/radial` is Recharts
// data-viz), so this is a hand-written SVG in the dashboard's inline-SVG style.
export function UsageDial({ label, value, caption, fraction }: { label: string; value: string; caption?: string; fraction: number | null }) {
  const size = 34, stroke = 3.5, radius = (size - stroke) / 2, circumference = 2 * Math.PI * radius;
  // null means "no reading": the ring stays empty rather than pretending 0%.
  const ratio = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return <div className="flex min-w-0 items-center gap-2" data-testid="usage-dial" data-usage-label={label}>
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
      {/* Standard dash-offset arc: a full circumference dash, revealed by the
          offset. A two-value dasharray can render as a dot when the remainder
          rounds to zero. */}
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)}
        className={ratio >= 0.9 ? 'text-red-400' : 'text-primary'} />
    </svg>
    <div className="min-w-0 leading-tight">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-medium tabular-nums" title={caption ? `${value} ${caption}` : value}>{value}</div>
      {caption && <div className="truncate text-[10px] text-muted-foreground">{caption}</div>}
    </div>
  </div>;
}
