import type { KnowledgeEntry } from '../catalog';

export const computers = {
  id: 'swarm/computers', parentId: 'swarm', title: 'Computers',
  summary: 'Shared resources that can provide separately granted capabilities.',
  source: 'docs/vision.md',
  content: 'A computer is an assignable environment, separate from agent identity and communication channels. An agent can exist without a computer, and multiple agents may access the same computer under configured access and coordination rules. Creating a computer or joining a conversation does not automatically grant an agent computer use or console access.',
} satisfies KnowledgeEntry;
