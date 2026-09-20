// Static UI fixtures only. These are not agents, persisted chats, or backend activity.
export const previewAgents = [
  {
    id: 'avery', name: 'Avery', initials: 'AV', time: '3:23 AM',
    messages: [
      { author: 'agent', text: 'Hey! What would you like to work on?' },
      { author: 'user', text: 'Let’s start with a simple place to talk.' },
      { author: 'agent', text: 'Sounds good. We can take it one step at a time.' },
    ],
  },
  {
    id: 'morgan', name: 'Morgan', initials: 'MO', time: '2:14 AM',
    messages: [
      { author: 'user', text: 'I have a few ideas I’d like to think through.' },
      { author: 'agent', text: 'I’m listening. Where would you like to start?' },
    ],
  },
  {
    id: 'riley', name: 'Riley', initials: 'RI', time: 'Yesterday 5:17 PM',
    messages: [
      { author: 'agent', text: 'Hi there. Good to meet you.' },
      { author: 'user', text: 'We’ll pick this up a little later.' },
      { author: 'agent', text: 'See you soon.' },
    ],
  },
  {
    id: 'quinn', name: 'Quinn', initials: 'QU', time: 'Yesterday 4:08 PM',
    messages: [
      { author: 'user', text: 'Just stopping by to say hello.' },
      { author: 'agent', text: 'Hello! Nice to have you here.' },
    ],
  },
] as const;
