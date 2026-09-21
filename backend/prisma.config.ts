import { defineConfig } from 'prisma/config';
import { databaseFile } from './src/database-location';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: `file:${databaseFile().replace(/\\/g, '/')}` },
});
