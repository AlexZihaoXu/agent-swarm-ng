import { request, type FullConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** Where the signed-in browser state lives between the setup and the tests (gitignored scratch). */
export const signedInState = fileURLToPath(new URL('../../.scratch/e2e-signed-in.json', import.meta.url));
export const TEST_PASSWORD = 'e2e test password';

// The suite's backend starts with a fresh database, so Admin has no password yet: set it once (the first sign-in) and
// keep that cookie for every test. tests/sign-in.spec.ts covers the sign-in screens themselves.
export default async function signIn(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const context = await request.newContext({ baseURL });
  let response = await context.post('/api/auth/setup', { data: { name: 'Admin', password: TEST_PASSWORD } });
  // The opt-in live configs reuse a dev stack whose password is already set: sign in with E2E_ADMIN_PASSWORD.
  if (response.status() === 409)
    response = await context.post('/api/auth/login', {
      data: { name: 'Admin', password: process.env.E2E_ADMIN_PASSWORD ?? TEST_PASSWORD },
    });
  if (!response.ok()) throw new Error(`Could not sign in for the tests: ${response.status()} ${await response.text()}`);
  await context.storageState({ path: signedInState });
  await context.dispose();
}
