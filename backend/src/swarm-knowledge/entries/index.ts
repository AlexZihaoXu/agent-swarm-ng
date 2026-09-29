import { KnowledgeCatalog } from '../catalog';
import {
  concepts,
  agentsConcept,
  channelsConcept,
  platformEventsConcept,
  timeConcept,
  computersConcept,
  desktopConcept,
  terminalsConcept,
  filesConcept,
  watchesConcept,
  scratchpadConcept,
  chatFilesConcept,
} from './concepts';
import { toolsConcept, systemConcept } from './system';
import {
  practices,
  communicationPractice,
  computerUsePractice,
  desktopPractice,
  browserPractice,
  terminalsPractice,
  filesPractice,
  sharingFilesPractice,
  waitingPractice,
  schedulingPractice,
} from './practices';
import { harnessesPractice, claudeCodePractice } from './harnesses';
import { dashboardPractice, dashboardAgents, dashboardComputers, dashboardChat, dashboardSettings } from './dashboard';

// Explicit imports make the curated tree reviewable. No filesystem scanning or agent writes.
// Two roots: concepts (what things are) and practices (how and when), linked to each other.
export const swarmKnowledge = new KnowledgeCatalog(
  [
    concepts,
    toolsConcept,
    systemConcept,
    agentsConcept,
    channelsConcept,
    platformEventsConcept,
    timeConcept,
    scratchpadConcept,
    chatFilesConcept,
    computersConcept,
    desktopConcept,
    terminalsConcept,
    filesConcept,
    watchesConcept,
    practices,
    communicationPractice,
    computerUsePractice,
    desktopPractice,
    browserPractice,
    terminalsPractice,
    filesPractice,
    sharingFilesPractice,
    waitingPractice,
    schedulingPractice,
    harnessesPractice,
    claudeCodePractice,
    dashboardPractice,
    dashboardAgents,
    dashboardComputers,
    dashboardChat,
    dashboardSettings,
  ],
  // IDs from before the concepts/practices split, still remembered in agents' saved conversations.
  {
    swarm: 'concepts',
    'swarm/channels': 'concepts/channels',
    'swarm/computers': 'concepts/computers',
    'swarm/computers/use': 'practices/computer-use',
    'swarm/computers/actions': 'practices/desktop',
    'swarm/computers/browser': 'practices/browser',
    'swarm/computers/files': 'concepts/computers/files',
    'swarm/computers/terminals': 'concepts/computers/terminals',
    'swarm/time': 'concepts/time',
  },
);
