import { describe, expect, it } from 'vitest';
import { chainColumns, choicesOf, ModelChains, RETRY_BASE, type ChainEvent, type ModelChoice } from './model-chain';

const choice = (model: string, options: Partial<ModelChoice> = {}): ModelChoice => ({
  endpointId: `e-${model}`,
  model,
  thinkingLevel: 'off',
  attempts: 3,
  tooBig: 'skip',
  comeBack: 5,
  ...options,
});

type Checks = { usable?: (index: number) => string | null; fits?: (index: number) => boolean };
function setup(choices: ModelChoice[], { usable = () => null, fits = () => true }: Checks = {}) {
  let now = 1_000_000;
  const chains = new ModelChains(() => now);
  const events: ChainEvent[] = [];
  const run = () => chains.run('a', choices, usable, fits, event => events.push(event));
  return { chains, events, run, advance: (ms: number) => (now += ms) };
}

describe('model chain storage', () => {
  it('keeps #1 in the agent columns and the rest with every option in modelChain', () => {
    const choices = [choice('one', { attempts: 2, comeBack: 0 }), choice('two', { tooBig: 'compact' })];
    const columns = chainColumns(choices);
    expect(columns).toMatchObject({ endpointId: 'e-one', model: 'one', thinkingLevel: 'off' });
    expect(choicesOf(columns)).toEqual(choices);
  });

  it('reads an agent saved before fallbacks as one choice with the default options', () => {
    expect(choicesOf({ endpointId: 'e', model: 'm', thinkingLevel: 'high', modelChain: '{}' })).toEqual([
      { endpointId: 'e', model: 'm', thinkingLevel: 'high', attempts: 3, tooBig: 'skip', comeBack: 5 },
    ]);
  });

  it('clamps options and drops incomplete fallbacks instead of guessing', () => {
    const modelChain = JSON.stringify({
      primary: { attempts: 99, comeBack: -4, tooBig: 'nope' },
      fallbacks: [
        { endpointId: '', model: 'x', thinkingLevel: 'off' },
        { endpointId: 'e2', model: 'y', thinkingLevel: 'low' },
      ],
    });
    expect(choicesOf({ endpointId: 'e', model: 'm', thinkingLevel: 'off', modelChain })).toEqual([
      { endpointId: 'e', model: 'm', thinkingLevel: 'off', attempts: 5, tooBig: 'skip', comeBack: 0 },
      { endpointId: 'e2', model: 'y', thinkingLevel: 'low', attempts: 3, tooBig: 'skip', comeBack: 5 },
    ]);
  });
});

describe('model chain policy', () => {
  it('tries a choice its number of attempts with backoff, then moves to the next', () => {
    const { run, events } = setup([choice('one', { attempts: 3 }), choice('two')]);
    const walk = run();
    expect(walk.failure(true, '503')).toEqual({ action: 'retry', delayMs: RETRY_BASE.ms });
    expect(walk.failure(true, '503')).toEqual({ action: 'retry', delayMs: 2 * RETRY_BASE.ms });
    expect(walk.failure(true, '503')).toEqual({ action: 'switch', index: 1, compact: false });
    expect(events.map(event => event.type)).toEqual(['retry', 'retry', 'switch']);
  });

  it('moves on at once when an error cannot succeed (a rejected login)', () => {
    const { run } = setup([choice('one'), choice('two')]);
    expect(run().failure(false, '401')).toEqual({ action: 'switch', index: 1, compact: false });
  });

  it('gives up after the last choice', () => {
    const { run, events } = setup([choice('one', { attempts: 1 }), choice('two', { attempts: 1 })]);
    const walk = run();
    walk.failure(true, 'x');
    expect(walk.failure(true, 'y')).toEqual({ action: 'fail' });
    expect(events.at(-1)).toMatchObject({ type: 'exhausted', index: 1 });
  });

  it('skips a choice it cannot reach, and one too small unless it may compact', () => {
    const small = setup([choice('one'), choice('two'), choice('three')], {
      usable: index => (index === 1 ? 'Reconnect' : null),
    });
    expect(small.run().failure(false, '401')).toEqual({ action: 'switch', index: 2, compact: false });
    expect(small.events).toContainEqual({ type: 'skip', index: 1, reason: 'Reconnect' });
    const compact = setup([choice('one'), choice('two', { tooBig: 'compact' })], { fits: index => index === 0 });
    expect(compact.run().failure(false, '401')).toEqual({ action: 'switch', index: 1, compact: true });
    const skip = setup([choice('one'), choice('two')], { fits: index => index === 0 });
    expect(skip.run().failure(false, '401')).toEqual({ action: 'fail' });
  });

  it('stays on the fallback, then tries #1 once after its come-back time and returns when it works', () => {
    const { run, advance, events, chains } = setup([choice('one', { comeBack: 5 }), choice('two')]);
    const first = run();
    first.failure(false, '401');
    first.success();
    expect(chains.active('a', [choice('one'), choice('two')])).toBe(1);
    advance(4 * 60_000);
    expect(run().index).toBe(1);
    advance(60_000);
    const later = run();
    expect(later.index).toBe(0);
    later.success();
    expect(events).toContainEqual({ type: 'recovered', index: 0, from: 1 });
  });

  it('a failed come-back try goes straight back to the fallback, with no second try of #1', () => {
    const { run, advance } = setup([choice('one', { comeBack: 5 }), choice('two')]);
    const first = run();
    first.failure(false, '401');
    first.success();
    advance(5 * 60_000);
    const probe = run();
    expect(probe.index).toBe(0);
    expect(probe.failure(true, '503')).toEqual({ action: 'switch', index: 1, compact: false });
  });

  it('within a long run, the next call after the come-back time tries #1', () => {
    const { run, advance } = setup([choice('one', { comeBack: 1 }), choice('two')]);
    const walk = run();
    walk.failure(false, '401');
    expect(walk.returnDue()).toBeUndefined();
    advance(60_000);
    expect(walk.returnDue()).toBe(0);
  });

  it('a manual-only choice waits for the owner, and a changed list starts at #1', () => {
    const choices = [choice('one', { comeBack: 0 }), choice('two')];
    const { run, advance, chains } = setup(choices);
    const first = run();
    first.failure(false, '401');
    first.success();
    advance(60 * 60_000);
    expect(run().index).toBe(1);
    chains.reset('a');
    expect(run().index).toBe(0);
    first.failure(false, '401');
    expect(chains.active('a', [choice('three'), ...choices])).toBe(0);
  });
});
