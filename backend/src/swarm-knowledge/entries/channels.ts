import type { KnowledgeEntry } from '../catalog';

export const channels = {
  id: 'swarm/channels', parentId: 'swarm', title: 'Channels',
  summary: 'Ways to communicate with the same agent, with explicit publication boundaries.',
  source: 'docs/vision.md',
  content: 'A channel is a way to reach an agent, not a separate identity. The same agent can be aware of context across channels, but it chooses what to disclose to each audience. Thinking and ordinary model output are internal. An explicit, authorized channel tool publishes a visible message. A communication grant does not grant file, shell, or computer access.',
} satisfies KnowledgeEntry;
