import { buildApp } from '../src/app';

const app = await buildApp();
try {
  await Bun.write(new URL('../openapi.json', import.meta.url), `${JSON.stringify(app.swagger(), null, 2)}\n`);
} finally {
  await app.close();
}
