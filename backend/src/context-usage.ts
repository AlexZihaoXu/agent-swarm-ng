import type { AgentSession } from '@earendil-works/pi-coding-agent';

/** Pi's current-context estimate, not summed usage across requests or forks. */
export function formatContextUsage(usage: ReturnType<AgentSession['getContextUsage']>) {
  if (!usage || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return 'Context usage unavailable.';
  const number = (value: number) => Math.round(value).toLocaleString('en-US');
  const known = usage.tokens !== null && Number.isFinite(usage.tokens) && usage.tokens >= 0;
  const amount = known
    ? `≈ ${number(usage.tokens!)} / ${number(usage.contextWindow)} tokens · ${((usage.tokens! / usage.contextWindow) * 100).toFixed(1)}%`
    : `Context tokens unknown / ${number(usage.contextWindow)}`;
  return `${amount}\nMain session estimate · configured context limit, not cumulative billing.\nUses provider usage when available plus estimated trailing messages; without provider usage, system-prompt/tool-schema overhead may be missing. Triage forks are separate and are not included.`;
}
