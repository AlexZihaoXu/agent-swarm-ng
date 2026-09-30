import type { RealAgent } from '../src/use-chat';

// Test-only API fixtures. Never imported by the application.
const samples = [
  {
    id: 'avery',
    name: 'Avery',
    hour: 3,
    minute: 23,
    messages: [
      ['assistant', 'Hey! What would you like to work on?'],
      ['user', 'Let’s start with a simple place to talk.'],
      ['assistant', 'Sounds good. We can take it one step at a time.'],
    ],
  },
  {
    id: 'morgan',
    name: 'Morgan',
    hour: 2,
    minute: 14,
    messages: [
      ['user', 'I have a few ideas I’d like to think through.'],
      ['assistant', 'I’m listening. Where would you like to start?'],
    ],
  },
  {
    id: 'riley',
    name: 'Riley',
    hour: 17,
    minute: 17,
    messages: [
      ['assistant', 'Hi there. Good to meet you.'],
      ['user', 'We’ll pick this up a little later.'],
      ['assistant', 'See you soon.'],
    ],
  },
  {
    id: 'quinn',
    name: 'Quinn',
    hour: 16,
    minute: 8,
    messages: [
      ['user', 'Just stopping by to say hello.'],
      ['assistant', 'Hello! Nice to have you here.'],
    ],
  },
] as const;

type Message = NonNullable<RealAgent['lastMessage']>;
export const sampleHistory: Record<string, Message[]> = Object.fromEntries(
  samples.map(agent => [
    agent.id,
    agent.messages.map(([role, text], index) => ({
      id: `${agent.id}-${index}`,
      sequence: index + 1,
      channelId: agent.id,
      role,
      text,
      replyTo: null,
      timestamp: new Date(2030, 0, 1, agent.hour, agent.minute).getTime(),
    })),
  ]),
);
export const sampleAgents: RealAgent[] = samples.map(agent => ({
  id: agent.id,
  name: agent.name,
  channelId: agent.id,
  endpointId: 'test-endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  compaction: { atPercent: 65, idleMinutes: 30, idlePercent: 50 },
  instructions: '',
  createdAt: sampleHistory[agent.id][0].timestamp,
  lastMessage: sampleHistory[agent.id].at(-1)!,
}));
