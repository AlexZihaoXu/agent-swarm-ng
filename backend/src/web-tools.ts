import { fork } from 'node:child_process';
import { classify } from './tool-access';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { databaseFile } from './database-location';
import { validateWebCall, webConfig, webEnvironment, webToolNames } from './web-policy';

type Result = Awaited<ReturnType<ToolDefinition['execute']>>;
type Descriptor = Pick<ToolDefinition, 'name' | 'label' | 'description' | 'parameters'>;

export async function createWebTools() {
  const root = join(dirname(databaseFile()), 'web-turns');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'turn-'));
  await writeFile(join(directory, 'web-search.json'), JSON.stringify(webConfig), { mode: 0o600 });
  const child = fork(fileURLToPath(new URL('./web-worker.ts', import.meta.url)), [], {
    execPath: 'bun',
    execArgv: [],
    cwd: directory,
    env: webEnvironment(directory),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let closed = false;
  const pending = new Map<string, { resolve: (result: Result) => void; reject: (error: Error) => void }>();
  let rejectReady: (error: Error) => void = () => {};
  const fail = () => {
    const error = new Error('Web tools stopped.');
    rejectReady(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const exited = new Promise<void>(resolveExit => {
    child.once('exit', () => {
      fail();
      resolveExit();
    });
    child.once('error', () => {
      fail();
      resolveExit();
    });
  });
  const close = async () => {
    if (!closed) {
      closed = true;
      child.kill();
      fail();
    }
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const descriptors = await new Promise<Descriptor[]>((resolveReady, reject) => {
      rejectReady = reject;
      const timer = setTimeout(() => reject(new Error('Web tools did not start.')), 30000);
      child.on('message', (message: { tools?: Descriptor[]; id?: string; result?: Result; error?: string }) => {
        if (message.tools) {
          clearTimeout(timer);
          resolveReady(message.tools);
        } else if (message.id) {
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) request?.reject(new Error(message.error));
          else if (message.result) request?.resolve(message.result);
        }
      });
      child.once('exit', () => clearTimeout(timer));
      child.once('error', () => clearTimeout(timer));
    });
    if (
      descriptors.length !== webToolNames.length ||
      descriptors.some(tool => !webToolNames.includes(tool.name as (typeof webToolNames)[number]))
    )
      throw new Error('Unexpected web tools.');
    const tools = descriptors.map(descriptor => {
      const parameters = structuredClone(descriptor.parameters) as typeof descriptor.parameters & {
        properties?: Record<string, unknown>;
      };
      for (const key of ['proxy', 'auth', 'answerModel', 'model', 'timestamp', 'frames', 'forceClone', 'prompt'])
        delete parameters.properties?.[key];
      if (parameters.properties?.provider) parameters.properties.provider = { type: 'string', enum: ['exa'] };
      if (parameters.properties?.workflow) parameters.properties.workflow = { type: 'string', enum: ['none'] };
      return defineTool({
        ...descriptor,
        parameters,
        async execute(_toolCallId, args, signal) {
          validateWebCall(descriptor.name, args);
          if (closed || signal?.aborted) throw new Error('Web request cancelled.');
          const id = crypto.randomUUID();
          const abort = () => {
            void close().catch(() => {});
          };
          const timer = setTimeout(abort, 60000);
          signal?.addEventListener('abort', abort, { once: true });
          try {
            return await new Promise<Result>((resolveResult, reject) => {
              pending.set(id, { resolve: resolveResult, reject });
              child.send({ id, name: descriptor.name, args }, error => {
                if (error) {
                  pending.delete(id);
                  reject(new Error('Web request could not start.'));
                }
              });
            });
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
          }
        },
      });
    });
    return {
      tools: classify({ web_search: 'r', source_check: 'r', fetch_content: 'r', get_search_content: 'r' }, tools),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
