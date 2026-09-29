import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { swarmSettingBounds, SwarmSettingsError, type SwarmSettings, type SwarmSettingsStore } from './swarm-settings';

const keys = Object.keys(swarmSettingBounds) as (keyof typeof swarmSettingBounds)[];
const settingsSchema = Type.Object(Object.fromEntries(keys.map(key => [key, Type.Integer()])));
const boundSchema = Type.Object({
  min: Type.Integer(),
  max: Type.Integer(),
  default: Type.Integer(),
  label: Type.String(),
  unit: Type.String(),
});
const responseSchema = Type.Object({
  settings: settingsSchema,
  bounds: Type.Object(Object.fromEntries(keys.map(key => [key, boundSchema]))),
});
const error = Type.Object({ message: Type.String() });

/** Settings → Swarm: the operator's limits for computers and file storage. Trusted dashboard surface. */
export function registerSwarmSettingsRoutes(app: FastifyInstance, store: SwarmSettingsStore) {
  const respond = (settings: SwarmSettings) => ({ settings, bounds: swarmSettingBounds });
  app.get(
    '/api/settings/swarm',
    { schema: { operationId: 'getSwarmSettings', response: { 200: responseSchema } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return respond(await store.get());
    },
  );
  app.patch<{ Body: Partial<SwarmSettings> }>(
    '/api/settings/swarm',
    {
      schema: {
        operationId: 'updateSwarmSettings',
        body: Type.Partial(Type.Object(Object.fromEntries(keys.map(key => [key, Type.Integer()]))), {
          additionalProperties: false,
          minProperties: 1,
        }),
        response: { 200: responseSchema, 400: error },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!Object.keys(request.body ?? {}).length) return reply.code(400).send({ message: 'Nothing to change.' });
      try {
        return respond(await store.update(request.body));
      } catch (caught) {
        if (caught instanceof SwarmSettingsError) return reply.code(400).send({ message: caught.message });
        throw caught;
      }
    },
  );
}
