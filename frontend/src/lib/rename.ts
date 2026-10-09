import { api } from '@/api/client';

/** Renames an agent (its menu's Rename agent); throws the server's message. */
export async function renameAgent(id: string, name: string) {
  const { data, error } = await api.PATCH('/api/agents/{id}', { params: { path: { id } }, body: { name } });
  if (!data || error) throw new Error(error?.message ?? 'Could not rename the agent.');
  return data;
}

/** Renames a group chat, keeping its members (the edit route takes both). */
export async function renameGroup(id: string, name: string, agentIds: string[]) {
  const { data, error } = await api.PATCH('/api/groups/{id}', { params: { path: { id } }, body: { name, agentIds } });
  if (!data || error) throw new Error(error?.message ?? 'Could not rename the group chat.');
  return data;
}
