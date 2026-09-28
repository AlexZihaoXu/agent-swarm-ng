import { KnowledgeCatalog } from '../catalog';
import { swarm } from './swarm';
import { channels } from './channels';
import { computers } from './computers';
import { computerUse, computerActions, computerBrowser } from './computer-use';
import { computerFiles } from './computer-files';

// Explicit imports make the curated tree reviewable. No filesystem scanning or agent writes.
export const swarmKnowledge = new KnowledgeCatalog([swarm, channels, computers, computerUse, computerActions, computerBrowser, computerFiles]);
