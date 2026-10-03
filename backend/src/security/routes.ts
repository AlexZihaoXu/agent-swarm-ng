import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import type { AuditLog } from '../audit/store';
import { clientAddress } from '../auth/routes';
import { KnownAddressError, type KnownAddresses } from './addresses';
import type { Alerts, AlertView } from './alerts';
import type { SignInGuard } from './guard';

/** A disk this full raises an ongoing banner (until it is below again). */
export const DISK_FULL = 0.9;

const Message = Type.Object({ message: Type.String() });
const Address = Type.Object({
  id: Type.String(),
  address: Type.String(),
  label: Type.String(),
  trusted: Type.Boolean(),
  createdAt: Type.String(),
});
const Security = Type.Object({
  /** The address this request came from, as the sign-in limits and the audit log see it. */
  yourAddress: Type.String(),
  yourLabel: Type.Union([Type.String(), Type.Null()]),
  yourTrusted: Type.Boolean(),
  lockdown: Type.Union([Type.Object({ since: Type.String(), failures: Type.Integer() }), Type.Null()]),
  addresses: Type.Array(Address),
});
const AlertSchema = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  title: Type.String(),
  detail: Type.String(),
  startedAt: Type.String(),
  endedAt: Type.Union([Type.String(), Type.Null()]),
  dismissable: Type.Boolean(),
  logs: Type.Union([Type.Literal('signin'), Type.Literal('system'), Type.Null()]),
});
const NewAddress = Type.Object({
  address: Type.String({ minLength: 1, maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 60, pattern: '\\S' }),
  trusted: Type.Boolean(),
});
const AddressChange = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 60, pattern: '\\S' })),
  trusted: Type.Optional(Type.Boolean()),
});
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

/** Settings → Security (known addresses, the lockdown) and the critical-event banners. */
export function registerSecurityRoutes(
  app: FastifyInstance,
  platform: PlatformStore,
  addresses: KnownAddresses,
  guard: SignInGuard,
  alerts: Alerts,
  audit: AuditLog,
) {
  const view = async (ip: string): Promise<Static<typeof Security>> => {
    const [match, lockdown, list] = await Promise.all([addresses.match(ip), guard.state(), addresses.list()]);
    return {
      yourAddress: ip,
      yourLabel: match?.label ?? null,
      yourTrusted: Boolean(match?.trusted),
      lockdown: lockdown ? { since: lockdown.since.toISOString(), failures: lockdown.failures } : null,
      addresses: list.map(({ range: _range, ...entry }) => entry),
    };
  };
  const record = (request: Parameters<typeof clientAddress>[0], detail: Record<string, unknown>, target?: string) =>
    audit.record({
      kind: 'auth.address',
      outcome: 'ok',
      actor: request.signedIn?.name ?? null,
      ip: clientAddress(request),
      targetName: target ?? null,
      detail,
    });

  app.get(
    '/api/security',
    { schema: { operationId: 'getSecurity', response: { 200: Security } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return view(clientAddress(request));
    },
  );

  app.post(
    '/api/security/addresses',
    { schema: { operationId: 'addKnownAddress', body: NewAddress, response: { 200: Security, 400: Message } } },
    async (request, reply) => {
      const body = request.body as Static<typeof NewAddress>;
      try {
        const row = await addresses.add(body);
        await record(request, { change: 'added', trusted: row.trusted }, `${row.label} (${row.address})`);
      } catch (error) {
        if (error instanceof KnownAddressError) return reply.code(400).send({ message: error.message });
        throw error;
      }
      return view(clientAddress(request));
    },
  );

  app.patch(
    '/api/security/addresses/:id',
    {
      schema: {
        operationId: 'updateKnownAddress',
        params: IdParams,
        body: AddressChange,
        response: { 200: Security, 404: Message },
      },
    },
    async (request, reply) => {
      const { id } = request.params as Static<typeof IdParams>;
      const changes = request.body as Static<typeof AddressChange>;
      const row = await addresses.update(id, changes).catch(() => null);
      if (!row) return reply.code(404).send({ message: 'That address is not listed.' });
      await record(
        request,
        { change: 'edited', fields: Object.keys(changes), trusted: row.trusted },
        `${row.label} (${row.address})`,
      );
      return view(clientAddress(request));
    },
  );

  app.delete(
    '/api/security/addresses/:id',
    { schema: { operationId: 'removeKnownAddress', params: IdParams, response: { 200: Security, 404: Message } } },
    async (request, reply) => {
      const { id } = request.params as Static<typeof IdParams>;
      const row = await addresses.remove(id).catch(() => null);
      if (!row) return reply.code(404).send({ message: 'That address is not listed.' });
      await record(request, { change: 'removed' }, `${row.label} (${row.address})`);
      return view(clientAddress(request));
    },
  );

  // Lifting a lockdown from the dashboard needs a trusted address, like signing in during one.
  app.post(
    '/api/security/unlock',
    { schema: { operationId: 'unlockSignIn', response: { 200: Security, 403: Message } } },
    async (request, reply) => {
      const ip = clientAddress(request);
      if (!(await addresses.trusted(ip)))
        return reply.code(403).send({ message: 'Only a trusted address can lift the lockdown.' });
      await guard.unlock(request.signedIn?.name ?? 'unknown', ip, 'lifted in Settings from a trusted address');
      return view(ip);
    },
  );

  app.get(
    '/api/alerts',
    { schema: { operationId: 'listAlerts', response: { 200: Type.Object({ alerts: Type.Array(AlertSchema) }) } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      const ongoing: AlertView[] = [];
      const lockdown = await guard.state();
      if (lockdown)
        ongoing.push({
          id: 'lockdown',
          kind: 'lockdown',
          title: 'Sign-in is locked down',
          detail: `After ${lockdown.failures} failed sign-ins within an hour, only trusted addresses can sign in. A sign-in from a trusted address lifts it, or the host's unlock command.`,
          startedAt: lockdown.since.toISOString(),
          endedAt: null,
          dismissable: false,
          logs: 'signin',
        });
      // The newest reading of each disk.
      await platform.initialize();
      const latest = await platform.client.$queryRawUnsafe<
        { label: string; used: number; total: number; at: string }[]
      >(
        `SELECT "label", "used", "total", "at" FROM "DiskSample" d
         WHERE "sequence" = (SELECT MAX("sequence") FROM "DiskSample" WHERE "disk" = d."disk")
           AND unixepoch("at") >= unixepoch('now') - 3600`,
      );
      for (const disk of latest)
        if (Number(disk.total) > 0 && Number(disk.used) / Number(disk.total) >= DISK_FULL)
          ongoing.push({
            id: `disk:${disk.label}`,
            kind: 'disk-full',
            title: `Disk ${disk.label} is ${Math.round((Number(disk.used) / Number(disk.total)) * 100)}% full`,
            detail: 'Free space or move computers’ files to another disk (Settings → Computer storage).',
            startedAt: new Date(disk.at).toISOString(),
            endedAt: null,
            dismissable: false,
            logs: null,
          });
      return { alerts: [...ongoing, ...(await alerts.open())] };
    },
  );

  app.post(
    '/api/alerts/:id/dismiss',
    {
      schema: { operationId: 'dismissAlert', params: IdParams, response: { 200: Type.Object({ ok: Type.Boolean() }) } },
    },
    async request => ({ ok: await alerts.dismiss((request.params as Static<typeof IdParams>).id) }),
  );
}
