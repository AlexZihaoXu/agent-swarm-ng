import { useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { api } from '@/api/client';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';

/** Notification icons are 192 px (Android's large icon, desktop notifications). */
export const AVATAR_PNG_SIZE = 192;

/** The agent's avatar as standalone SVG markup (the same art as the dashboard, at rest). */
export function renderAvatarSvg(avatar: AvatarAppearance, size = AVATAR_PNG_SIZE): string {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.append(host);
  const root = createRoot(host);
  try {
    // The art lays out its outline in a layout effect, so it is complete once rendering is flushed.
    flushSync(() => root.render(<AgentAvatarArt {...avatar} size={size} animated={false} />));
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('The avatar did not render.');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(svg);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Draws an agent's avatar as a PNG. */
export async function renderAvatarPng(avatar: AvatarAppearance, size = AVATAR_PNG_SIZE): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([renderAvatarSvg(avatar, size)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(size, size);
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.drawImage(image, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('No PNG.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves a file the person asked for (a download link, clicked). */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** At most this many drawn per pass, so a large swarm never stalls the dashboard. */
const PER_PASS = 20;

/**
 * Keeps each agent's notification icon current (docs/notifications.md#icons): asks which agents' PNGs are missing or
 * drawn from an older look, draws each exactly as the backend has it saved now and uploads it with that look (a look
 * that changed meanwhile is refused and drawn on the next pass). Runs again when a loaded agent's avatar changes.
 */
export function useAvatarPngSync(agents: { id: string; avatar?: AvatarAppearance; real?: unknown }[]) {
  const key = useMemo(
    () =>
      agents
        .filter(agent => agent.real)
        .map(agent => `${agent.id}:${JSON.stringify(agent.avatar ?? null)}`)
        .join('|'),
    [agents],
  );
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api.GET('/api/push/avatars');
        for (const { id, avatar, look } of (data?.stale ?? []).slice(0, PER_PASS)) {
          if (cancelled) return;
          const png = await renderAvatarPng((avatar as AvatarAppearance | null) ?? defaultAvatar(id));
          await window.fetch(`/api/agents/${encodeURIComponent(id)}/avatar.png?look=${encodeURIComponent(look)}`, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: png,
            credentials: 'same-origin',
          });
        }
      } catch {
        // Icons are a nicety: the app icon stands in until the next pass.
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);
}
