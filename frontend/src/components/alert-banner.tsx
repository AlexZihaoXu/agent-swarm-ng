import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { useSignedIn } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Alert = operations['listAlerts']['responses'][200]['content']['application/json']['alerts'][number];

const when = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "from Oct 3, 09:12 to Oct 3, 11:40", or "since …" while it lasts. */
function span(alert: Alert) {
  const from = when.format(new Date(alert.startedAt));
  return alert.endedAt ? `from ${from} to ${when.format(new Date(alert.endedAt))}` : `since ${from}`;
}

/**
 * Critical events across the top of the app (docs/dashboard.md#critical-events): a possible power outage or crash, a
 * burst of failed sign-ins, a lockdown, a full disk. Kibo's alert/error/alert-error-5 (Error with Everything), full
 * width; warnings (failed sign-ins) in amber. Each links to its logs; events can be dismissed, ongoing conditions
 * stay until they end.
 */
export function AlertBanner({
  onNavigate,
  insetTop = false,
}: {
  onNavigate: (path: string) => void;
  /** Phones without the top bar above: clear the notch here. */
  insetTop?: boolean;
}) {
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  // Critical events are admin's (docs/users.md): users never ask.
  const { admin } = useSignedIn();
  const query = useQuery({
    queryKey: ['alerts'],
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/alerts', { signal });
      return data?.alerts ?? [];
    },
    refetchInterval: 30_000,
    enabled: admin,
  });
  const alerts = query.data ?? [];
  if (!admin || !alerts.length) return null;
  const dismiss = async (alert: Alert) => {
    queryClient.setQueryData<Alert[]>(['alerts'], current => current?.filter(item => item.id !== alert.id));
    await api.POST('/api/alerts/{id}/dismiss', { params: { path: { id: alert.id } } }).catch(() => undefined);
  };
  return (
    <div
      className={cn('shrink-0 space-y-px', insetTop && 'max-md:pt-[env(safe-area-inset-top)]')}
      role="region"
      aria-label="Critical events"
    >
      {(all ? alerts : alerts.slice(0, 3)).map(alert => {
        const warning = alert.kind === 'signin-failures';
        return (
          <div
            key={alert.id}
            role="alert"
            className={cn(
              'flex flex-row items-start gap-3 border-b px-4 py-2.5 text-sm motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)]',
              warning
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="mt-0.5 size-4 shrink-0 opacity-70"
            >
              <circle cx="12" cy="12" r="10" />
              {warning ? <path d="M12 8v4M12 16h.01" /> : <path d="m15 9-6 6M9 9l6 6" />}
            </svg>
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium">
                  {alert.title} <span className="font-normal opacity-80">· {span(alert)}</span>
                </p>
                {/* Phones keep the strip short: the title and span; the logs say the rest. */}
                <p className="opacity-80 max-md:hidden">{alert.detail}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {alert.logs && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 bg-transparent sm:min-h-0"
                    onClick={() => onNavigate(`/settings/audit?category=${alert.logs}`)}
                  >
                    View logs
                  </Button>
                )}
                {alert.dismissable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 bg-transparent sm:min-h-0"
                    onClick={() => void dismiss(alert)}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {alerts.length > 3 && !all && (
        <button
          type="button"
          className="block min-h-9 w-full border-b border-red-500/40 bg-red-500/10 px-4 py-1 text-left text-xs text-red-300 hover:underline sm:min-h-0"
          onClick={() => setAll(true)}
        >
          Show {alerts.length - 3} more
        </button>
      )}
    </div>
  );
}
