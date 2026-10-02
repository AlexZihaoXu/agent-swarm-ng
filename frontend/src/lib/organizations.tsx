import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';

export type Organization =
  operations['listOrganizations']['responses'][200]['content']['application/json']['organizations'][number];
/** The organization the dashboard shows, or every one. */
export type OrganizationScope = 'all' | string;
const KEY = 'swarm.organization';
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
 * Organizations (docs/organizations.md): which one the dashboard shows is a per-browser choice (it never changes what
 * agents can reach). With a single organization, "all" and that one are the same.
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
  const [chosen, setChosen] = useState<OrganizationScope>(read);
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
