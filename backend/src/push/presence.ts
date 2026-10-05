/** A tab's "I am in front of the person" report lasts this long; the dashboard repeats it every 25 s while true. */
export const PRESENCE_MS = 60_000;
const MAX_TABS = 50;

/**
 * Whether a person has the dashboard in front of them (docs/notifications.md#when-not-to-notify): visible and focused
 * on any device, reported by each tab within the last minute. A tab that is hidden, blurred or closed reports so
 * (or stops reporting), and a person with no such tab gets push notifications. In memory: a restart forgets it, and
 * notifications go out until the tabs report again.
 */
export class Presence {
  private readonly tabs = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = Date.now) {}

  report(userId: string, tabId: string, active: boolean) {
    let tabs = this.tabs.get(userId);
    if (!active) {
      tabs?.delete(tabId);
      if (tabs && !tabs.size) this.tabs.delete(userId);
      return;
    }
    if (!tabs) this.tabs.set(userId, (tabs = new Map()));
    tabs.delete(tabId);
    tabs.set(tabId, this.now());
    // The oldest reports go first: a person never has this many tabs in front of them at once.
    while (tabs.size > MAX_TABS) tabs.delete(tabs.keys().next().value!);
  }

  present(userId: string) {
    const tabs = this.tabs.get(userId);
    if (!tabs) return false;
    const now = this.now();
    for (const [tab, at] of tabs) if (now - at >= PRESENCE_MS) tabs.delete(tab);
    if (!tabs.size) this.tabs.delete(userId);
    return tabs.size > 0;
  }
}
