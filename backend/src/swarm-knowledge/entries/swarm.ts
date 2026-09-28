import type { KnowledgeEntry } from '../catalog';

export const swarm = {
  id: 'swarm',
  parentId: null,
  title: 'Swarm concepts',
  summary: 'Agents, channels, computers, and permissions have separate roles.',
  source: 'docs/vision.md',
  content:
    'An agent is a persistent identity, independent of its communication channels, assigned computers, and current model session. Channels provide communication; computers provide capabilities. Permissions govern access to those capabilities. A channel or computer does not define the agent identity.',
} satisfies KnowledgeEntry;
