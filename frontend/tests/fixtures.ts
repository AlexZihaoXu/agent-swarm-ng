import { test as base } from '@playwright/test';
import { sampleAgents, sampleHistory } from './sample-agents';
export { expect, type Page } from '@playwright/test';

// All sample agents live behind test-only API mocks, never in the application.
export const test = base.extend({
  page: async ({ page }, use) => {
    // Exercise notification wiring without playing sounds on the developer's speakers.
    await page.addInitScript(() => {
      const stats = { starts: 0, decodes: 0 };
      class SilentAudioContext {
        state = 'suspended';
        destination = {};
        async resume() {
          this.state = 'running';
        }
        async close() {
          this.state = 'closed';
        }
        async decodeAudioData(bytes: ArrayBuffer) {
          if (!bytes.byteLength) throw new Error('Empty audio');
          stats.decodes++;
          return {};
        }
        createGain() {
          return { gain: { value: 1 }, connect() {} };
        }
        createBufferSource() {
          return {
            buffer: null,
            onended: null,
            connect() {},
            disconnect() {},
            stop() {},
            start() {
              stats.starts++;
            },
          };
        }
      }
      Object.assign(window, { AudioContext: SilentAudioContext, notificationAudio: stats });
      const scope = window as unknown as {
        agentRunSnapshot?: object[];
        emitAgentEvent: (event: object) => void;
        disconnectAgentEvents: () => void;
      };
      const original = window.fetch.bind(window);
      let current: ReadableStreamDefaultController<Uint8Array> | undefined;
      scope.emitAgentEvent = event => current?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      scope.disconnectAgentEvents = () => {
        current?.close();
        current = undefined;
      };
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url, location.href).pathname !== '/api/events') return original(input, init);
        const signal = input instanceof Request ? input.signal : init?.signal;
        let streamController: ReadableStreamDefaultController<Uint8Array>;
        let closed = false;
        const abort = () => {
          if (!closed) {
            closed = true;
            streamController.error(new DOMException('Aborted', 'AbortError'));
          }
        };
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                current = controller;
                streamController = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    `${JSON.stringify({ type: 'snapshot', runs: scope.agentRunSnapshot ?? [] })}\n`,
                  ),
                );
                signal?.addEventListener('abort', abort, { once: true });
              },
              cancel() {
                closed = true;
                signal?.removeEventListener('abort', abort);
                if (current === streamController) current = undefined;
              },
            }),
            { headers: { 'Content-Type': 'application/x-ndjson' } },
          ),
        );
      };
    });
    let agents = structuredClone(sampleAgents);
    const history = structuredClone(sampleHistory);
    await page.route(/\/api\/agents(?:\?.*)?$/, route =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { agents, nextCursor: null } })
        : route.fulfill({ status: 501, json: { message: 'Configure an agent-creation mock for this test.' } }),
    );
    const grants = new Map<string, string[]>();
    await page.route('**/api/agents/*/settings', route => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      const agent = agents.find(item => item.id === id);
      if (!agent) return route.fulfill({ status: 404, json: { message: 'Agent not found.' } });
      if (route.request().method() === 'PATCH') {
        const { avatar, allowedDmAgentIds } = route.request().postDataJSON();
        if (avatar) Object.assign(agent, { avatar });
        if (allowedDmAgentIds) {
          for (const peer of agents)
            if (peer.id !== id) {
              const current = (grants.get(peer.id) ?? []).filter(other => other !== id);
              grants.set(peer.id, allowedDmAgentIds.includes(peer.id) ? [...current, id] : current);
            }
          grants.set(id, allowedDmAgentIds);
        }
      }
      return route.fulfill({
        json: {
          avatar: 'avatar' in agent ? agent.avatar : null,
          allowedDmAgents: agents
            .filter(peer => (grants.get(id) ?? []).includes(peer.id))
            .map(({ id, name }) => ({ id, name })),
        },
      });
    });
    await page.route('**/api/agents/*/activity*', route =>
      route.fulfill({ json: { entries: [], nextCursor: null, contextUsage: null } }),
    );
    await page.route('**/api/agents/*/computers', route => route.fulfill({ json: { computers: [] } }));
    // No Discord bot by default; tests that need one route these themselves.
    await page.route(/\/api\/agents\/[^/]+\/discord(\/token)?$/, route =>
      route.fulfill({
        json: {
          configured: false,
          status: { state: 'off' },
          bot: null,
          inviteUrl: null,
          admission: 'mention',
          strangerDms: false,
          catchUp: true,
          channels: [],
        },
      }),
    );
    await page.route('**/api/discord/owner', route => route.fulfill({ json: { accounts: [] } }));
    await page.route(/\/api\/computers(?:\?.*)?$/, route =>
      route.fulfill({ json: { computers: [], controllerConnected: true } }),
    );
    await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
    await page.route('**/api/agents/*/dm-peers*', route => route.fulfill({ json: { peers: [], nextCursor: null } }));
    await page.route('**/api/agents/*/dm-inbox*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
    await page.route('**/api/agents/*/dms/*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
    await page.route(/\/api\/agents\/[^/?]+$/, route => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
      const agent = agents.find(item => item.id === id);
      if (!agent) return route.fulfill({ status: 404, json: { message: 'Agent not found.' } });
      if (route.request().postDataJSON().confirmation !== agent.name)
        return route.fulfill({ status: 400, json: { message: 'Wrong confirmation.' } });
      agents = agents.filter(item => item.id !== id);
      delete history[agent.channelId];
      return route.fulfill({ json: { deleted: true } });
    });
    await page.route('**/api/channels/*/messages*', route => {
      const channel = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      return route.fulfill({ json: { messages: history[channel] ?? [], nextCursor: null } });
    });
    await page.route(/\/api\/groups(?:\?.*)?$/, route =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { groups: [], nextCursor: null } })
        : route.fulfill({ status: 501, json: { message: 'Configure a group-creation mock for this test.' } }),
    );
    await page.route('**/api/chats/*/reactions*', route =>
      route.fulfill({
        json: {
          messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: [] })),
        },
      }),
    );
    await page.route('**/api/chat', async route => {
      const body = route.request().postDataJSON();
      const agent = agents.find(item => item.id === body.agentId);
      if (!agent) return route.fulfill({ status: 501, json: { message: 'Configure a chat mock for this test.' } });
      const messages = history[agent.channelId];
      const parent = messages.find(item => item.id === body.replyToMessageId);
      const message = {
        id: body.clientMessageId,
        channelId: agent.channelId,
        sequence: messages.length + 1,
        role: 'user' as const,
        text: body.message,
        timestamp: await page.evaluate(() => Date.now()),
        replyTo: parent ? { id: parent.id, role: parent.role, text: parent.text.slice(0, 160) } : null,
      };
      messages.push(message);
      agent.lastMessage = message;
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${JSON.stringify({ type: 'user_message', ...message })}\n${JSON.stringify({ type: 'done' })}\n`,
      });
    });
    await page.route('**/api/agents/*/stop', route => route.fulfill({ json: { stopped: true } }));
    await page.route('**/api/model-endpoints', route => route.fulfill({ json: [] }));
    await page.route(/\/api\/providers\/openai-codex(?:\/login)?$/, route =>
      route.fulfill({ json: { connected: false, models: [], login: { state: 'idle' } } }),
    );
    await use(page);
  },
});
