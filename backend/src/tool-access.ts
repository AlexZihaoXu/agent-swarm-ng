import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * What a tool does to the world, declared where its tools are made and enforced centrally (heartbeats, help):
 * r reads only (nothing anyone else can see changes); w changes something; rw both, or cannot be told apart (bash
 * runs anything, so even `ls` counts); claim selects or claims a computer (use_computer), not a change in itself.
 */
export type ToolAccess = 'r' | 'w' | 'rw' | 'claim';
const access = Symbol('tool access');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentTool = ToolDefinition<any, any> & { readonly [access]: ToolAccess };

/**
 * Tags a factory's tools with their classes. Every tool it makes must be listed (some are made only when available),
 * so a new tool cannot ship unclassified: sessions accept only tagged tools, by type and again when created.
 */
export function classify<Name extends string>(
  classes: Record<Name, ToolAccess>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ToolDefinition<any, any>[],
): AgentTool[] {
  for (const tool of tools)
    if (!Object.hasOwn(classes, tool.name)) throw new Error(`Tool ${tool.name} has no access class.`);
  return tools.map(tool => Object.assign(tool, { [access]: classes[tool.name as Name] }) as AgentTool);
}

export function accessOf(tool: { name: string }): ToolAccess | undefined {
  return (tool as Partial<AgentTool>)[access];
}

/** What each class means for the agent, in help and refusals. */
export const ACCESS_MEANING: Record<ToolAccess, string> = {
  r: 'reads only; changes nothing anyone else can see',
  w: 'changes something (a message, a file, a timer, the computer)',
  rw: 'reads and changes, or may change anything (bash)',
  claim: 'selects a computer to read, or with write:true claims it to change it; not a change in itself',
};
