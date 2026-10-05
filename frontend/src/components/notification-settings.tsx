import { useEffect, useId, useState } from 'react';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSignedIn } from '@/lib/auth';
import { listTime } from '@/lib/format-time';
import { currentDevice, disablePush, enablePush, pushSupport, type Device } from '@/lib/push';
import { settingsCard } from '@/lib/styles';

type Preferences = operations['getPushPreferences']['responses'][200]['content']['application/json'];
const entering = 'motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]';

const TYPES: { key: keyof Preferences; title: string; description: string; admin?: true }[] = [
  { key: 'agentMessages', title: 'Agent messages', description: 'When an agent writes to you in its private chat.' },
  { key: 'groupChats', title: 'Group chats', description: 'When an agent writes in a group chat of yours.' },
  {
    key: 'agentProblems',
    title: 'Agent problems',
    description: 'When an agent couldn’t finish what you asked because of an error.',
  },
  {
    key: 'critical',
    title: 'Critical alerts',
    description: 'A lockdown, failed sign-ins, an outage or a full disk.',
    admin: true,
  },
  { key: 'swarmUpdates', title: 'Swarm updates', description: 'When the Swarm is updated to a new version.' },
  { key: 'swarmStarts', title: 'Swarm started', description: 'When the Swarm starts again after a stop or restart.' },
  { key: 'swarmStops', title: 'Swarm stopping', description: 'When the Swarm is about to stop or restart.' },
  {
    key: 'preview',
    title: 'Show message text',
    description: 'Off: notifications say “New message”, so nothing of a chat shows on the lock screen.',
  },
];

/**
 * Settings → Account → Notifications (docs/notifications.md): turn on push notifications on this device, the devices
 * that receive them, what to be notified about, and a test. Nothing is pushed while you have the dashboard open in
 * front of you. The toggles adapt Kibo `switch-cards-3` (Settings List), like the agent's Discord settings.
 */
export function NotificationSettings() {
  const id = useId();
  const { admin } = useSignedIn();
  const support = pushSupport();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'default'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadDevices = async () => {
    const { data } = await api.GET('/api/push/subscriptions');
    if (data) setDevices(data.devices);
  };
  useEffect(() => {
    void api
      .GET('/api/push/preferences')
      .then(({ data }) => data && setPreferences(data))
      .catch(() => undefined);
    // This device's subscription is saved again on each visit (browsers rotate them), which also tells which it is.
    void currentDevice()
      .then(device => setThisDevice(device?.id ?? null))
      .catch(() => undefined)
      .finally(() => void loadDevices().catch(() => undefined));
  }, []);

  const act = async (work: () => Promise<string>, failure: string) => {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : failure);
    } finally {
      setBusy(false);
      if ('Notification' in window) setPermission(Notification.permission);
    }
  };

  const turnOn = () =>
    act(async () => {
      const device = await enablePush();
      setThisDevice(device.id);
      await loadDevices();
      // "On for this device" says it.
      return '';
    }, 'Could not turn notifications on.');

  const remove = (device: Device) =>
    act(async () => {
      if (device.id === thisDevice) {
        await disablePush(device.id);
        setThisDevice(null);
      } else {
        const { response } = await api.DELETE('/api/push/subscriptions/{id}', { params: { path: { id: device.id } } });
        if (!response.ok) throw new Error('Could not remove it.');
      }
      await loadDevices();
      return `${device.label} no longer gets notifications.`;
    }, 'Could not remove it.');

  const test = () =>
    act(async () => {
      const { data, error } = await api.POST('/api/push/test');
      if (!data) throw new Error((error as { message?: string } | undefined)?.message ?? 'Could not send it.');
      if (!data.delivered) return 'No device took it. Turn notifications on first, or remove and add the device again.';
      return `Sent to ${data.delivered} ${data.delivered === 1 ? 'device' : 'devices'}.`;
    }, 'Could not send it.');

  const toggle = async (key: keyof Preferences, value: boolean) => {
    const previous = preferences;
    setPreferences(current => (current ? { ...current, [key]: value } : current));
    const { data } = await api.PATCH('/api/push/preferences', { body: { [key]: value } }).catch(() => ({ data: null }));
    if (data) setPreferences(data);
    else {
      setPreferences(previous);
      setMessage('Could not save that.');
    }
  };

  const on = Boolean(thisDevice);
  return (
    <div className={`${settingsCard} space-y-4`} aria-labelledby={`${id}-title`} role="group">
      <div>
        <h4 id={`${id}-title`} className="text-sm font-semibold">
          Notifications
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Your agents’ messages and problems on your phone or computer, even when the dashboard is closed. Nothing is
          sent while you have it open in front of you.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {support === 'supported' && !on && (
          <Button
            type="button"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={busy || permission === 'denied'}
            onClick={() => void turnOn()}
          >
            Turn on notifications on this device
          </Button>
        )}
        {support === 'supported' && on && (
          <p className={`text-sm ${entering}`}>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
            On for this device.
          </p>
        )}
        {(devices?.length ?? 0) > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={busy}
            onClick={() => void test()}
          >
            Send test notification
          </Button>
        )}
      </div>
      {support === 'supported' && permission === 'denied' && !on && (
        <p className="text-xs text-muted-foreground">
          Notifications are blocked for this site. Allow them in the browser’s site settings, then come back here.
        </p>
      )}
      {support === 'ios-browser' && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          On iPhone and iPad, notifications need the app on your Home Screen. Tap Share, choose{' '}
          <b>Add to Home Screen</b>, then open Agent Swarm from there and turn them on in its Settings.
        </p>
      )}
      {support === 'unsupported' && (
        <p className="text-xs text-muted-foreground">
          This browser can’t receive notifications from the dashboard (they need HTTPS and a browser with Web Push).
        </p>
      )}

      {devices && devices.length > 0 && (
        <ul aria-label="Devices" className="divide-y divide-border rounded-lg border border-border bg-background">
          {devices.map(device => (
            <li key={device.id} className={`flex items-center justify-between gap-3 p-3 ${entering}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {device.label}
                  {device.id === thisDevice && (
                    <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {device.paused
                    ? 'Stopped after repeated failures: turn it on again on that device.'
                    : device.lastSuccessAt
                      ? `Last delivered ${listTime(Date.parse(device.lastSuccessAt))}`
                      : `Added ${listTime(Date.parse(device.createdAt))}, nothing delivered yet`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={busy}
                aria-label={`Remove ${device.label}${device.id === thisDevice ? ' (this device)' : ''}`}
                onClick={() => void remove(device)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {preferences && (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {TYPES.filter(type => admin || !type.admin).map(type => (
            <div key={type.key} className="flex items-center justify-between gap-4 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <label htmlFor={`${id}-${type.key}`} className="cursor-pointer text-sm font-medium">
                  {type.title}
                </label>
                <p className="text-xs text-muted-foreground">{type.description}</p>
              </div>
              <Switch
                id={`${id}-${type.key}`}
                checked={preferences[type.key]}
                onCheckedChange={value => void toggle(type.key, value)}
              />
            </div>
          ))}
        </div>
      )}

      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
