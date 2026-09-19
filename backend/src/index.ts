import { buildApp } from './app';

const app = await buildApp();
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
