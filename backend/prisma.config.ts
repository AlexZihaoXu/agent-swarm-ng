import { defineConfig } from 'prisma/config';
import { databaseFile } from './src/database-location';

/** Message search's queue, FTS5 indexes and their shadow tables (migration 20261005030000_message_search): not Prisma's. */
const searchTables = [
  'MessageSearchQueue',
  ...['MessageSearch', 'GroupMessageSearch', 'DmMessageSearch'].flatMap(name => [
    name,
    ...['config', 'data', 'docsize', 'idx'].map(part => `${name}_${part}`),
  ]),
];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: `file:${databaseFile().replace(/\\/g, '/')}` },
  experimental: { externalTables: true },
  tables: { external: searchTables },
});
