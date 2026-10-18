import { cn } from '@/lib/utils';
import { modelsOf } from '@/components/model-choice-list';
import type { RealAgent } from '@/use-chat';

/** A model id without its provider path ("anthropic/claude-sonnet-4" → "claude-sonnet-4"). */
const shortName = (model: string) => model.slice(model.lastIndexOf('/') + 1) || model;

/** The model the agent is on now and its rank, or null when it has none chosen. */
export function currentModel(agent: RealAgent) {
  const models = modelsOf(agent);
  const index = Math.min(Math.max(agent.activeModel ?? 0, 0), models.length - 1);
  const choice = models[index];
  return choice?.model ? { choice, index, models } : null;
}

/**
 * The model the agent is on now, beside its Activity button (docs/agent-models.md): its #1 normally, or a lower one
 * (amber, with its rank) after #1 failed, until #1 works again. Updates live with the agent's model events.
 */
export function CurrentModel({ agent, className }: { agent: RealAgent; className?: string }) {
  const current = currentModel(agent);
  if (!current) return null;
  const { choice, index, models } = current;
  const fallback = index > 0;
  const thinking = choice.thinkingLevel === 'off' ? 'no thinking' : `${choice.thinkingLevel} thinking`;
  const description = fallback
    ? `On model #${index + 1} of ${models.length} since #1 failed: ${choice.model}, ${thinking}`
    : `Model: ${choice.model}, ${thinking}`;
  return (
    <span
      title={description}
      data-testid="current-model"
      className={cn(
        'inline-flex h-7 min-w-0 max-w-[9rem] items-center gap-1 rounded-md border px-2 text-xs sm:max-w-[14rem]',
        fallback
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          : 'border-border bg-muted/40 text-muted-foreground',
        className,
      )}
    >
      <span className="sr-only">{description}</span>
      {fallback && (
        <span aria-hidden="true" className="shrink-0 font-medium">
          #{index + 1}
        </span>
      )}
      <span aria-hidden="true" className="truncate">
        {shortName(choice.model)}
      </span>
    </span>
  );
}
