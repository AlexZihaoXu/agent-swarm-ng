import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A local stand-in for Discord in tests (Node): the REST API with captured requests and scripted replies, and a
 * Gateway that performs the real handshake (Hello → Identify → READY → GUILD_CREATE), then lets a test push events.
 */
export type MockRequest = { method: string; path: string; query: URLSearchParams; body: any; files: string[] };
type Handler = (request: MockRequest) => { status?: number; json: unknown } | undefined;

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export class MockDiscord {
  readonly requests: MockRequest[] = [];
  readonly identifies: { token: string; intents: number }[] = [];
  private server!: Server;
  private gateway!: WebSocketServer;
  private sockets = new Set<WebSocket>();
  private sequence = 0;
  private handlers: Handler[] = [];
  /** Tokens Discord accepts; anything else gets 401 (REST) or close 4004 (Gateway). */
  tokens = new Map<string, { id: string; username: string }>();
  guilds: object[] = [];
  /** Gateway close code sent right after Identify (e.g. 4014 for a missing privileged intent). */
  closeAfterIdentify?: number;

  get port() {
    return (this.server.address() as AddressInfo).port;
  }
  get api() {
    return `http://127.0.0.1:${this.port}/api`;
  }
  on(handler: Handler) {
    this.handlers.push(handler);
  }

  async start() {
    this.server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://mock');
      const reply = (status: number, json: unknown) => {
        if (status === 204) return void response.writeHead(204).end();
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
      };
      const token = String(request.headers.authorization ?? '').replace(/^Bot /, '');
      const user = this.tokens.get(token);
      if (!user) return reply(401, { message: '401: Unauthorized', code: 0 });
      const raw = await readBody(request);
      const type = String(request.headers['content-type'] ?? '');
      let body: any = null;
      const files: string[] = [];
      if (type.startsWith('multipart/')) {
        const form = await new Response(raw, { headers: { 'content-type': type } }).formData();
        for (const [key, value] of form.entries() as Iterable<[string, string | File]>)
          if (typeof value === 'string') {
            if (key === 'payload_json') body = JSON.parse(value);
          } else files.push(`${value.name}:${value.size}`);
      } else if (raw.length) body = JSON.parse(raw.toString());
      const path = decodeURIComponent(url.pathname.replace(/^\/api\/v10/, ''));
      const captured = { method: request.method ?? 'GET', path, query: url.searchParams, body, files };
      this.requests.push(captured);
      for (const handler of this.handlers) {
        const result = handler(captured);
        if (result) return reply(result.status ?? 200, result.json);
      }
      if (path === '/users/@me')
        return reply(200, { id: user.id, username: user.username, global_name: null, bot: true });
      if (path === '/gateway/bot')
        return reply(200, {
          url: `ws://127.0.0.1:${this.port}`,
          shards: 1,
          session_start_limit: { total: 1000, remaining: 999, reset_after: 86_400_000, max_concurrency: 1 },
        });
      reply(404, { message: `No mock for ${request.method} ${path}`, code: 0 });
    });
    this.gateway = new WebSocketServer({ server: this.server });
    this.gateway.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 }, s: null, t: null }));
      socket.on('message', raw => {
        const payload = JSON.parse(String(raw));
        if (payload.op === 1) return socket.send(JSON.stringify({ op: 11 }));
        if (payload.op !== 2) return;
        this.identifies.push({ token: payload.d.token, intents: payload.d.intents });
        const user = this.tokens.get(payload.d.token);
        if (!user) return socket.close(4004, 'Authentication failed.');
        if (this.closeAfterIdentify) return socket.close(this.closeAfterIdentify, 'Closed by mock.');
        this.send(socket, 'READY', {
          v: 10,
          user: { ...user, bot: true },
          guilds: this.guilds.map(guild => ({ id: (guild as { id: string }).id, unavailable: true })),
          session_id: 'mock-session',
          resume_gateway_url: `ws://127.0.0.1:${this.port}`,
          application: { id: user.id, flags: 0 },
          shard: [0, 1],
        });
        for (const guild of this.guilds) this.send(socket, 'GUILD_CREATE', guild);
      });
    });
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return this;
  }
  private send(socket: WebSocket, t: string, d: unknown) {
    socket.send(JSON.stringify({ op: 0, s: ++this.sequence, t, d }));
  }
  /** Pushes a dispatch event to every connected bot. */
  dispatch(t: string, d: unknown) {
    for (const socket of this.sockets) this.send(socket, t, d);
  }
  get connected() {
    return this.sockets.size;
  }
  async stop() {
    for (const socket of this.sockets) socket.terminate();
    this.gateway.close();
    await new Promise(resolve => this.server.close(resolve));
  }
}
