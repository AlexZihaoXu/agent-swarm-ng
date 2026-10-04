import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { api } from '@/api/client';
import { surface } from '@/lib/motion';
import { SignIn } from '@/components/sign-in';

export const SESSION_KEY = ['auth', 'session'] as const;
export type AuthSession =
  | { signedIn: true; name: string; admin: boolean; timeZone: string }
  | { signedIn: false; setupRequired: boolean; name?: string; lockedDown?: boolean };

const SignedInContext = createContext<{
  name: string;
  admin: boolean;
  timeZone: string;
  setTimeZone: (timeZone: string) => Promise<void>;
  signOut: () => Promise<void>;
} | null>(null);

/**
 * The signed-in person and sign-out, for Settings → Account. `admin`: the admin account, which sees every
 * organization and the admin-only settings (docs/users.md); what it may do is enforced on the server.
 */
export function useSignedIn() {
  const value = useContext(SignedInContext);
  if (!value) throw new Error('useSignedIn needs the AuthGate');
  return value;
}

let onSignedOut = () => {};

// Any API answer of 401 means the session ended (signed out elsewhere, password changed, reset on the host): show the
// sign-in card again. Installed once, before the first request, so plain fetch calls are covered too.
if (typeof window !== 'undefined' && !(window.fetch as { swarmAuth?: true }).swarmAuth) {
  const original = window.fetch.bind(window);
  const watched = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (response.status === 401) {
      const target = args[0] instanceof Request ? args[0].url : String(args[0]);
      const path = new URL(target, window.location.href).pathname;
      if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) onSignedOut();
    }
    return response;
  };
  window.fetch = Object.assign(watched, { swarmAuth: true as const });
}

async function loadSession(): Promise<AuthSession> {
  const { data } = await api.GET('/api/auth/session');
  if (!data) throw new Error('Could not reach the dashboard.');
  return data;
}

/**
 * The dashboard needs a signed-in person (docs/login.md). Until then only the sign-in card shows; the first visit sets
 * the Admin password. Signing out (here or by a 401 anywhere) unmounts the app, closing its streams.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: loadSession, staleTime: Infinity, retry: 1 });
  useEffect(() => {
    onSignedOut = () => void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    return () => {
      onSignedOut = () => {};
    };
  }, [queryClient]);
  // Nothing from a previous session may linger in the cache (the session query itself stays: the gate watches it).
  const switchTo = (data: AuthSession) => {
    queryClient.removeQueries({ predicate: query => query.queryKey[0] !== SESSION_KEY[0] });
    queryClient.setQueryData(SESSION_KEY, data);
  };
  const signOut = async () => {
    await api.POST('/api/auth/logout').catch(() => undefined);
    switchTo({ signedIn: false, setupRequired: false });
  };
  const state = session.data;
  // A person's time zone (docs/users.md#time-zone): the browser's until they choose one.
  const setTimeZone = async (timeZone: string) => {
    const { data, error } = await api.PATCH('/api/auth/account', { body: { timeZone } });
    if (!data) throw new Error(error?.message ?? 'Could not save the time zone.');
    queryClient.setQueryData<AuthSession>(SESSION_KEY, current =>
      current?.signedIn ? { ...current, timeZone: data.timeZone } : current,
    );
  };
  const signedInZone = state?.signedIn ? state.timeZone : undefined;
  useEffect(() => {
    if (signedInZone !== '') return;
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browser) void setTimeZone(browser).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInZone]);
  const settled = Boolean(state) || session.isError;
  useEffect(() => {
    if (settled) hideSplash();
  }, [settled]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state?.signedIn ? (
        <m.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={surface}>
          <SignedInContext.Provider
            value={{ name: state.name, admin: state.admin, timeZone: state.timeZone, setTimeZone, signOut }}
          >
            {children}
          </SignedInContext.Provider>
        </m.div>
      ) : state ? (
        <SignIn key="sign-in" session={state} onSignedIn={switchTo} />
      ) : session.isError ? (
        <div key="error" role="alert" className="grid min-h-dvh place-items-center p-4 text-sm text-muted-foreground">
          Could not reach the dashboard. Reload to try again.
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/** Dissolves index.html's splash once the gate knows what to show, then removes it. */
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('done')) return;
  // After the app's first frame is painted beneath it, so the splash dissolves into real content.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add('done');
      setTimeout(() => splash.remove(), 560);
    }),
  );
}
