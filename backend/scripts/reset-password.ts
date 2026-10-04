// Forgotten password: forgets the account's password and signs out every browser. For Admin the next visit to the
// dashboard sets a new one (like the first sign-in); a user's is set by admin in Settings → Users (docs/users.md).
// Run on the host: docker compose exec backend bun scripts/reset-password.ts [name]
import { Accounts } from '../src/auth/sessions';
import { PlatformStore } from '../src/platform-store';

const name = process.argv[2] ?? 'Admin';
const database = new PlatformStore();
await database.initialize();
const user = await database.client.user.findUnique({ where: { name }, select: { role: true } });
const done = await new Accounts(database).resetPassword(name);
console.log(
  !done
    ? `No account named ${name}.`
    : user?.role === 'admin'
      ? `${name}'s password is cleared. The next visit to the dashboard sets a new one.`
      : `${name}'s password is cleared and they are signed out. Set a new one in Settings → Users.`,
);
await database.client.$disconnect();
process.exit(done ? 0 : 1);
