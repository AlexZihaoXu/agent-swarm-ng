import { expect, it } from 'vitest';
import { enterAction, parseQuery, search, type PortalItem } from './portal-search';

const items: PortalItem[] = [
  { id: 'agent:a', kind: 'agent', title: 'Ada', path: '/agents/a', float: { kind: 'chat', agentId: 'a' } },
  { id: 'agent:b', kind: 'agent', title: 'Bob', keywords: ['researcher'], path: '/agents/b' },
  { id: 'chat:g', kind: 'chat', title: 'Launch planning', subtitle: 'Group', path: '/chat/groups/g' },
  { id: 'computer:d', kind: 'computer', title: 'Desk', float: { kind: 'computer', computerId: 'd' } },
  {
    id: 'terminal:d:1',
    kind: 'terminal',
    title: 'build-web',
    keywords: ['Desk'],
    float: { kind: 'terminal', computerId: 'd', session: '1' },
  },
  { id: 'page:settings', kind: 'page', title: 'Settings', path: '/settings' },
  { id: 'knowledge:time', kind: 'knowledge', title: 'Time, timers and reminders', path: '/settings/knowledge/x' },
  { id: 'command:group', kind: 'command', title: 'New group', run: () => {} },
  { id: 'file:1', kind: 'file', title: 'report.pdf', path: '/chat/agents/a' },
];
const titles = (input: string) => search(items, input).map(group => [group.heading, group.items.map(i => i.title)]);

it('reads a typed prefix as a chip that narrows the search to its kinds', () => {
  expect(parseQuery('@ad')).toMatchObject({ prefix: { label: 'Agents' }, text: 'ad' });
  expect(parseQuery('  desk ')).toEqual({ text: 'desk' });
  expect(titles('@')).toEqual([['Agents', ['Ada', 'Bob']]]);
  expect(titles(':build')).toEqual([['Terminals', ['build-web']]]);
  expect(titles(':')).toEqual([
    ['Computers', ['Desk']],
    ['Terminals', ['build-web']],
  ]);
  expect(titles('>')).toEqual([['Commands', ['New group']]]);
  expect(titles('?timer')).toEqual([['Knowledge', ['Time, timers and reminders']]]);
});

it('ranks title matches over keyword matches, and keeps commands and files until asked', () => {
  expect(titles('')).not.toContainEqual(['Commands', ['New group']]);
  expect(titles('').flatMap(([heading]) => heading)).not.toContain('Files');
  expect(titles('desk')).toEqual([
    ['Computers', ['Desk']],
    ['Terminals', ['build-web']],
  ]);
  expect(titles('research')).toEqual([['Agents', ['Bob']]]);
  expect(titles('lp')).toEqual([['Chats', ['Launch planning']]]);
  expect(titles('new')).toEqual([['Commands', ['New group']]]);
  expect(titles('report')).toEqual([['Files', ['report.pdf']]]);
  expect(titles('zzz')).toEqual([]);
});

it('says what Enter does for each kind of result', () => {
  expect(items.map(enterAction)).toEqual(['open', 'go to', 'go to', 'open', 'open', 'go to', 'go to', 'run', 'go to']);
});
