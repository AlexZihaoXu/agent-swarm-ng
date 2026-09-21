import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { getModels } from '@earendil-works/pi-ai/compat';
import { validateWebCall, webToolNames } from './web-policy';

// One process per turn: upstream caches/configuration are module-global.
// This is configuration/state isolation, not an OS security sandbox.
const require = createRequire(import.meta.url);
const entry = pathToFileURL(join(dirname(require.resolve('pi-web-access/package.json')), 'dist/index.js')).href;
const webAccess = (await import(entry)).default as ExtensionFactory;
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: process.cwd(),
  settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  extensionFactories: [webAccess],
});
await resourceLoader.reload();
if (resourceLoader.getExtensions().errors.length) throw new Error('Could not load web extension.');
const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
const { session } = await createAgentSession({
  model: getModels('openai')[0], modelRuntime, resourceLoader, settingsManager,
  sessionManager: SessionManager.inMemory(), noTools: 'all', tools: [...webToolNames],
});
const tools = session.agent.state.tools;
if (tools.length !== webToolNames.length || tools.some(tool => !webToolNames.includes(tool.name as typeof webToolNames[number]))) throw new Error('Unexpected web tool grant.');
process.on('message', async (message: { id: string; name: string; args: Record<string, unknown> }) => {
  try {
    validateWebCall(message.name, message.args);
    const tool = tools.find(tool => tool.name === message.name)!;
    const result = await tool.execute(message.id, message.args);
    process.send?.({ id: message.id, result });
  } catch {
    process.send?.({ id: message.id, error: 'Web request failed or is not permitted.' });
  }
});
process.on('disconnect', () => { session.dispose(); process.exit(0); });
process.send?.({ tools: tools.map(({ name, label, description, parameters }) => ({ name, label, description, parameters })) });
