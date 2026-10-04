import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';

export type Organization =
  operations['listOrganizations']['responses'][200]['content']['application/json']['organizations'][number];
/** The organization the dashboard shows, or every one. */
export type OrganizationScope = 'all' | string;
const KEY = 'swarm.organization';
/** The address names the organization shown (`?org=<id>`; none for all), so a refresh or a shared link keeps it. */
const PARAM = 'org';
const fromUrl = (search: string) => new URLSearchParams(search).get(PARAM);
const read = () => {
  try {
    return localStorage.getItem(KEY) || 'all';
  } catch {
    return 'all';
  }
};

type Value = {
  organizations: Organization[];
  current: OrganizationScope;
  setCurrent: (scope: OrganizationScope) => void;
  /** Whether something of this organization shows in the current scope. */
  inScope: (organizationId: string | undefined) => boolean;
  /** Where new things go: the current organization, or undefined while showing all (the form asks). */
  target: string | undefined;
  nameOf: (organizationId: string | undefined) => string;
  refresh: () => Promise<void>;
};
const Context = createContext<Value | null>(null);

/**
 * Organizations (docs/organizations.md): which one the dashboard shows is a view (it never changes what agents can
 * reach), named in the address and remembered by the browser for addresses without one. With a single organization,
 * "all" and that one are the same.
 */
export function OrganizationsProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['organizations'],
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/organizations', { signal });
      return data?.organizations ?? [];
    },
    staleTime: 30_000,
  });
  const organizations = useMemo(() => query.data ?? [], [query.data]);
  const location = useLocation();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<OrganizationScope>(() => fromUrl(location.search) ?? read());
  // A deleted (or unknown) organization falls back to all.
  const current = chosen !== 'all' && query.data && !organizations.some(org => org.id === chosen) ? 'all' : chosen;
  const setCurrent = useCallback((scope: OrganizationScope) => {
    setChosen(scope);
    try {
      localStorage.setItem(KEY, scope);
    } catch {
      // Private windows: the choice lasts for this page only.
    }
  }, []);
  // An address naming another organization (back/forward, a pasted link) shows that one.
  const named = fromUrl(location.search);
  useEffect(() => {
    if (named && named !== chosen) setCurrent(named);
    // Only when the address changes: a choice made here updates the address below.
  }, [named]);
  // Keep the address naming the shown organization: in-app links carry only paths.
  useEffect(() => {
    const want = current === 'all' ? null : current;
    if ((named ?? null) === want || (named && !query.data)) return;
    // The address as it is now: a page's effect may have just moved it (this provider's effects run after the page's).
    const { pathname, search: now, hash } = window.location;
    if (fromUrl(now) === want) return;
    const params = new URLSearchParams(now);
    if (want) params.set(PARAM, want);
    else params.delete(PARAM);
    const search = params.toString();
    navigate({ pathname, search: search ? `?${search}` : '', hash }, { replace: true });
  }, [current, named, query.data, location, navigate]);
  const value = useMemo<Value>(() => {
    const single = organizations.length === 1 ? organizations[0].id : undefined;
    return {
      organizations,
      current,
      setCurrent,
      inScope: id => current === 'all' || !id || id === current,
      target: current !== 'all' ? current : single,
      nameOf: id => organizations.find(org => org.id === id)?.name ?? '',
      refresh: () => client.invalidateQueries({ queryKey: ['organizations'] }),
    };
  }, [organizations, current, setCurrent, client]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOrganizations() {
  const value = useContext(Context);
  if (!value) throw new Error('useOrganizations needs OrganizationsProvider.');
  return value;
}

/** A short badge for an organization: its initials. */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join('') || '?';
