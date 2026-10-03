// Forgotten password: forgets the account's password and signs out every browser; the next visit to the dashboard
// sets a new one (like the first sign-in). Run on the host: docker compose exec backend bun scripts/reset-password.ts [name]
import { Accounts } from '../src/auth/sessions';
import { PlatformStore } from '../src/platform-store';

const name = process.argv[2] ?? 'Admin';
const database = new PlatformStore();
await database.initialize();
const done = await new Accounts(database).resetPassword(name);
console.log(
  done ? `${name}'s password is cleared. The next visit to the dashboard sets a new one.` : `No account named ${name}.`,
);
await database.client.$disconnect();
process.exit(done ? 0 : 1);
