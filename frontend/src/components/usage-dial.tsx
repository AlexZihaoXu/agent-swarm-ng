import { cn } from '@/lib/utils';

// Small circular usage dial. Kibo's catalogue has no radial progress pattern
// (its `progress` patterns are linear bars and `chart/radial` is Recharts
// data-viz), so this is a hand-written SVG in the dashboard's inline-SVG style.
export function UsageDial({
  label,
  value,
  caption,
  fraction,
  large = false,
  color,
}: {
  label: string;
  value: string;
  caption?: string;
  fraction: number | null;
  /** The Dashboard's Now strip: a bigger ring with the share inside it, label and caption beside. */
  large?: boolean;
  /** The arc's colour below 90% (it turns red from there, like everywhere). */
  color?: string;
}) {
  const size = large ? 52 : 34,
    stroke = large ? 5 : 3.5,
    radius = (size - stroke) / 2,
    circumference = 2 * Math.PI * radius;
  // null means "no reading": the ring stays empty rather than pretending 0%.
  const ratio = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <div
      className={large ? 'flex min-w-0 items-center gap-3' : 'flex min-w-0 items-center gap-2'}
      data-testid="usage-dial"
      data-usage-label={label}
    >
      <span className="relative shrink-0">
        <svg
          aria-hidden="true"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="shrink-0 -rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-border"
          />
          {/* Standard dash-offset arc: a full circumference dash, revealed by the
          offset. A two-value dasharray can render as a dot when the remainder
          rounds to zero. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            className={ratio >= 0.9 ? 'text-red-400' : color ? '' : 'text-primary'}
            style={ratio < 0.9 && color ? { color } : undefined}
          />
        </svg>
        {large && (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium tabular-nums">
            {fraction === null ? '—' : `${Math.round(ratio * 100)}%`}
          </span>
        )}
      </span>
      <div className="min-w-0 leading-tight">
        <div className={large ? 'text-sm font-semibold' : 'text-[10px] uppercase tracking-wide text-muted-foreground'}>
          {label}
        </div>
        <div
          className={cn('truncate tabular-nums', large ? 'text-xs text-muted-foreground' : 'text-xs font-medium')}
          title={caption ? `${value} ${caption}` : value}
        >
          {value}
        </div>
        {caption && <div className="truncate text-[10px] text-muted-foreground">{caption}</div>}
      </div>
    </div>
  );
}
