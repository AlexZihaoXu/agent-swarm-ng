import createClient from 'openapi-fetch';
import type { paths } from './schema';

// Looked up per request, so the sign-in watcher (lib/auth.tsx) sees every answer whatever loads first.
export const api = createClient<paths>({ baseUrl: '/', fetch: request => window.fetch(request) });
