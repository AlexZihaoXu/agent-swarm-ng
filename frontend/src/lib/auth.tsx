import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { api } from '@/api/client';
import { surface } from '@/lib/motion';
import { SignIn } from '@/components/sign-in';

export const SESSION_KEY = ['auth', 'session'] as const;
export type AuthSession = { signedIn: true; name: string } | { signedIn: false; setupRequired: boolean; name?: string };

const SignedInContext = createContext<{ name: string; signOut: () => Promise<void> } | null>(null);

/** The signed-in person and sign-out, for Settings → Account. */
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
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state?.signedIn ? (
        <m.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={surface}>
          <SignedInContext.Provider value={{ name: state.name, signOut }}>{children}</SignedInContext.Provider>
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
