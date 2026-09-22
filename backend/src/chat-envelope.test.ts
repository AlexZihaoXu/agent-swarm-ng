import { expect, it } from 'vitest';
import { channelInput } from './chat-runtime';

it('labels the originating conversation, not the receiving agent’s private channel', () => {
  const source = { agentId: 'sender', name: 'Sender', channelId: 'group:team', groupId: 'team', chainId: 'chain', messageId: 'message' };
  const group = channelInput('private', 'Hello', { role: 'user', text: 'Hello', source });
  expect(group).toMatch(/^\[channel: group:team\]/);
  expect(group).toContain('Source is another agent, not the human owner');
  const human = channelInput('private', 'Hello', { role: 'user', text: 'Hello', source: { ...source, human: true, agentId: 'human' } });
  expect(human).toContain('Source is the human owner');
  const dm = channelInput('private', 'Hello', { role: 'user', text: 'Hello', source: { ...source, groupId: undefined, channelId: 'dm:a:b' } });
  expect(dm).toMatch(/^\[channel: dm:a:b\]/);
  expect(channelInput('private', 'Hello')).toMatch(/^\[channel: private\]/);
});
