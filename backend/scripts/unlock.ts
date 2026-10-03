// Lifts a sign-in lockdown (docs/login.md#known-addresses-and-lockdown) from the host:
//   scripts/compose.sh <stack> exec backend bun scripts/unlock.ts
import { AuditLog } from '../src/audit/store';
import { PlatformStore } from '../src/platform-store';
import { KnownAddresses } from '../src/security/addresses';
import { Alerts } from '../src/security/alerts';
import { SignInGuard } from '../src/security/guard';
import { SwarmSettingsStore } from '../src/swarm-settings';

const database = new PlatformStore();
await database.initialize();
const guard = new SignInGuard(
  database,
  new KnownAddresses(database),
  new SwarmSettingsStore(database),
  new AuditLog(database),
  new Alerts(database),
);
const lifted = await guard.unlock('host', null, 'host command');
console.log(lifted ? 'The lockdown is lifted: anyone can sign in again.' : 'Sign-in was not locked down.');
await database.client.$disconnect();
