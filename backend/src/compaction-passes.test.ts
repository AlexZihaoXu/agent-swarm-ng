import { expect, it } from 'vitest';
import { estimateTokens } from '@earendil-works/pi-coding-agent';
import { summarizeInPasses } from './background-compaction';

type Preparation = Parameters<typeof summarizeInPasses>[0];
const note = (label: string, words: number) =>
  ({ role: 'user', content: `${label} ${'word '.repeat(words)}`, timestamp: 0 }) as const;
const preparation = (messages: ReturnType<typeof note>[], prefix: ReturnType<typeof note>[] = []) =>
  ({
    firstKeptEntryId: 'kept',
    messagesToSummarize: messages,
    turnPrefixMessages: prefix,
    isSplitTurn: prefix.length > 0,
    tokensBefore: 0,
    previousSummary: 'EARLIER',
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1024, keepRecentTokens: 512 },
  }) as unknown as Preparation;
const labels = (prepared: Preparation) =>
  prepared.messagesToSummarize.map(message => String((message as { content: string }).content).split(' ')[0]);

/** Records each pass and answers with a summary naming everything it has read so far. */
function recorder() {
  const passes: { read: string[]; previous?: string; split: boolean }[] = [];
  const summarize = async (prepared: Preparation) => {
    const read = labels(prepared);
    passes.push({ read, previous: prepared.previousSummary, split: prepared.isSplitTurn });
    return {
      summary: `${prepared.previousSummary ?? ''}+${read.join('+')}`,
      firstKeptEntryId: prepared.firstKeptEntryId,
      tokensBefore: 0,
    } as Awaited<ReturnType<Parameters<typeof summarizeInPasses>[2]>>;
  };
  return { passes, summarize };
}
const size = estimateTokens(note('a', 400));

it('summarizes oldest first in passes, each with the summary so far', async () => {
  const { passes, summarize } = recorder();
  const result = await summarizeInPasses(
    preparation([note('a', 400), note('b', 400), note('c', 400)]),
    () => size * 2,
    summarize,
  );
  expect(passes).toEqual([
    { read: ['a', 'b'], previous: 'EARLIER', split: false },
    { read: ['c'], previous: 'EARLIER+a+b', split: false },
  ]);
  expect(result?.summary).toBe('EARLIER+a+b+c');
});

it('a last pass left with only the split turn’s start reads it as history, keeping the summary so far', async () => {
  const { passes, summarize } = recorder();
  const result = await summarizeInPasses(
    preparation([note('a', 400), note('b', 400)], [note('turn', 400)]),
    () => size * 2,
    summarize,
  );
  // The history fills the first pass, so the turn's start has a pass of its own: as history, never an empty one.
  expect(passes).toEqual([
    { read: ['a', 'b'], previous: 'EARLIER', split: false },
    { read: ['turn'], previous: 'EARLIER+a+b', split: false },
  ]);
  expect(result?.summary).toBe('EARLIER+a+b+turn');
});

it('reads the turn start with the last history it fits beside', async () => {
  const { passes, summarize } = recorder();
  await summarizeInPasses(preparation([note('a', 400)], [note('turn', 400)]), () => size * 3, summarize);
  expect(passes).toEqual([{ read: ['a'], previous: 'EARLIER', split: true }]);
});

it('gives up when one message is bigger than a pass can read', async () => {
  const { passes, summarize } = recorder();
  expect(await summarizeInPasses(preparation([note('a', 400), note('huge', 4000)]), () => size * 2, summarize)).toBe(
    undefined,
  );
  expect(passes.map(pass => pass.read)).toEqual([['a']]);
});
