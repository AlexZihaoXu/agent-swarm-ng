import { describe, expect, it } from 'vitest';
import { mentionAt, mentionMatches } from './mentions';
import type { ChatAgent } from '@/use-chat';

const agents = ['Atlas', 'Artificial Idiot', 'Morgan', 'Big Atlas'].map(name => ({ id: name, name }) as ChatAgent);

describe('mention completion', () => {
  it('finds the @word at the caret, names with spaces included', () => {
    expect(mentionAt('hi @at', 6)).toEqual({ start: 3, query: 'at' });
    expect(mentionAt('@Artificial Id', 14)).toEqual({ start: 0, query: 'Artificial Id' });
    expect(mentionAt('mail me@host', 12)).toBeNull();
    expect(mentionAt('@at\nnext', 8)).toBeNull();
    expect(mentionAt('@ x', 3)).toBeNull();
  });
  it('lists names starting with the query first, then a later word', () => {
    expect(mentionMatches(agents, 'at').map(agent => agent.name)).toEqual(['Atlas', 'Big Atlas']);
    expect(mentionMatches(agents, 'artificial i').map(agent => agent.name)).toEqual(['Artificial Idiot']);
    expect(mentionMatches(agents, '').length).toBe(4);
  });
});
