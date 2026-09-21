import { buildApp } from './app';
import { PlatformStore } from './platform-store';

process.umask(0o077);
const database = new PlatformStore();
await database.initialize();
const app = await buildApp({ database });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch((error) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
});
