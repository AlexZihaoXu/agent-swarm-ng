import { describe, expect, it } from 'vitest';
import {
  absorbTokens,
  addFilter,
  filterChoices,
  highlightParts,
  pageItems,
  parseHistory,
  rememberSearch,
  searchQuery,
  searchable,
  typingFilter,
  withoutTyping,
} from './message-search';

describe('message search', () => {
  it('reads the filter being typed', () => {
    expect(typingFilter('deploy from:ad')).toEqual({ key: 'from', value: 'ad' });
    expect(typingFilter('has:')).toEqual({ key: 'has', value: '' });
    expect(typingFilter('see http://x')).toBeNull();
    expect(typingFilter('deploy')).toBeNull();
    expect(withoutTyping('deploy from:ad')).toBe('deploy');
  });

  it('offers choices for each filter', () => {
    const people = [
      { id: 'a1', name: 'Ada' },
      { id: 'b2', name: 'Bo' },
    ];
    expect(filterChoices('from', 'a', people).map(choice => choice.value)).toEqual(['agent:a1']);
    expect(filterChoices('from', '', people).map(choice => choice.label)).toEqual(['You', 'Ada', 'Bo']);
    expect(filterChoices('has', 'im', []).map(choice => choice.value)).toEqual(['image']);
    const now = new Date(2026, 9, 5, 12);
    expect(filterChoices('before', '', [], now)[0]).toMatchObject({ value: '2026-10-05', label: 'Today' });
    expect(filterChoices('during', '2026-09-01', [], now)).toEqual([
      { key: 'during', value: '2026-09-01', label: '2026-09-01' },
    ]);
  });

  it('keeps one filter per key, several has values, and before/after apart from during', () => {
    let filters = addFilter([], { key: 'has', value: 'link', label: 'link' });
    filters = addFilter(filters, { key: 'has', value: 'file', label: 'file' });
    filters = addFilter(filters, { key: 'has', value: 'link', label: 'link' });
    expect(filters.map(filter => filter.value)).toEqual(['file', 'link']);
    filters = addFilter(filters, { key: 'before', value: '2026-10-01', label: '2026-10-01' });
    filters = addFilter(filters, { key: 'after', value: '2026-09-01', label: '2026-09-01' });
    expect(filters.map(filter => filter.key)).toEqual(['has', 'has', 'before', 'after']);
    filters = addFilter(filters, { key: 'during', value: '2026-09-15', label: '2026-09-15' });
    expect(filters.map(filter => filter.key)).toEqual(['has', 'has', 'during']);
    filters = addFilter(filters, { key: 'after', value: '2026-09-01', label: '2026-09-01' });
    expect(filters.map(filter => filter.key)).toEqual(['has', 'has', 'after']);
  });

  it('turns whole typed tokens into filters', () => {
    expect(absorbTokens({ text: 'deploy has:link in:all before:2026-10-01 from:you plan', filters: [] })).toEqual({
      text: 'deploy plan',
      filters: [
        { key: 'has', value: 'link', label: 'link' },
        { key: 'in', value: 'all', label: 'All chats' },
        { key: 'before', value: '2026-10-01', label: '2026-10-01' },
        { key: 'from', value: 'you', label: 'You' },
      ],
    });
    expect(absorbTokens({ text: 'has:nothing', filters: [] }).text).toBe('has:nothing');
  });

  it('builds the request', () => {
    const state = {
      text: ' deploy ',
      filters: [
        { key: 'from' as const, value: 'agent:a1', label: 'Ada' },
        { key: 'has' as const, value: 'link' as const, label: 'link' },
        { key: 'has' as const, value: 'file' as const, label: 'file' },
      ],
    };
    expect(searchQuery(state, { conversation: 'chat:c1', organizationId: 'o1', sort: 'newest', page: 1 })).toEqual({
      q: 'deploy',
      conversation: 'chat:c1',
      from: 'agent:a1',
      has: 'link,file',
    });
    const everywhere = {
      ...state,
      filters: [...state.filters, { key: 'in' as const, value: 'all' as const, label: '' }],
    };
    expect(
      searchQuery(everywhere, { conversation: 'chat:c1', organizationId: 'o1', sort: 'oldest', page: 3 }),
    ).toMatchObject({ organizationId: 'o1', sort: 'oldest', page: 3 });
    expect(
      searchQuery(everywhere, { conversation: null, organizationId: null, sort: 'newest', page: 1 }),
    ).not.toHaveProperty('organizationId');
    expect(searchable({ text: ' ', filters: [{ key: 'in', value: 'all', label: '' }] })).toBe(false);
  });

  it('remembers recent searches without repeats', () => {
    let history = rememberSearch([], { text: 'deploy', filters: [] });
    history = rememberSearch(history, { text: 'plan', filters: [] });
    history = rememberSearch(history, { text: ' deploy', filters: [] });
    expect(history.map(item => item.text)).toEqual(['deploy', 'plan']);
    expect(rememberSearch(history, { text: '', filters: [] })).toBe(history);
    expect(parseHistory(JSON.stringify(history))).toEqual(history);
    expect(parseHistory('{nope')).toEqual([]);
    expect(parseHistory(JSON.stringify([{ text: 1 }]))).toEqual([]);
  });

  it('splits highlighted text and pages', () => {
    expect(highlightParts('a match b', [{ start: 2, end: 7 }])).toEqual([
      { text: 'a ', match: false },
      { text: 'match', match: true },
      { text: ' b', match: false },
    ]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 40)).toEqual([1, 2, 3, 4, 'gap', 40]);
    expect(pageItems(20, 40)).toEqual([1, 'gap', 19, 20, 21, 'gap', 40]);
    expect(pageItems(40, 40)).toEqual([1, 'gap', 37, 38, 39, 40]);
  });
});
