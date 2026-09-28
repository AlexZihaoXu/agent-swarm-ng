import { api } from '@/api/client';
import type { operations } from '@/api/schema';
export type TerminalRequest = operations['computerTerminal']['requestBody']['content']['application/json'];
export type TerminalResult = operations['computerTerminal']['responses'][200]['content']['application/json'];
export async function computerTerminal(
  id: string,
  body: TerminalRequest,
  signal?: AbortSignal,
): Promise<TerminalResult> {
  const { data, error } = await api.POST('/api/computers/{id}/terminals', { params: { path: { id } }, body, signal });
  if (!data || error) throw new Error(error?.message ?? 'Terminal unavailable; inspect before retrying input.');
  return data;
}
