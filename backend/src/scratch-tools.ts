import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { ScratchError, SCRATCH_MAX_FOLDERS, type Scratchpad } from './scratchpad';
import { TextError } from './text-page';

const reply = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(isError ? { isError: true } : {}),
});
/** Scratchpad mistakes (a missing file, a limit) are the agent's to correct, not platform failures. */
const guarded = async (work: () => Promise<unknown>) => {
  try {
    return reply(await work());
  } catch (error) {
    if (error instanceof ScratchError || error instanceof TextError) return reply({ error: error.message }, true);
    throw error;
  }
};
const path = Type.String({
  minLength: 1,
  maxLength: 263,
  description: `Scratch path such as "drafts/plan.md" (at most ${SCRATCH_MAX_FOLDERS} folders deep).`,
});
const scope =
  'Your private scratchpad: text files kept by the platform (no computer needed), for drafting, editing and presenting artifacts to the human. Not memory. Read Swarm Knowledge concepts/scratchpad before first use. ';

/** The scratchpad tools every agent has, bound to its own scratchpad. */
export function createScratchTools(pad: Scratchpad, agentId: string): ToolDefinition[] {
  return [
    defineTool({
      name: 'scratch_list',
      label: 'List scratchpad',
      description: `${scope}Lists the folders and files directly inside a folder (the top level by default), with sizes, and your usage against the limits.`,
      parameters: Type.Object(
        { folder: Type.Optional(Type.String({ maxLength: 263 })) },
        { additionalProperties: false },
      ),
      async execute(_call, { folder }) {
        return guarded(() => pad.list(agentId, folder ?? ''));
      },
    }),
    defineTool({
      name: 'scratch_read',
      label: 'Read scratch file',
      description: `${scope}Reads a page of a scratch file like the computer read tool: 1-based lines, 200 by default (limit up to 2000, 50,000 bytes). Scroll with nextOffset/prevOffset.`,
      parameters: Type.Object(
        {
          path,
          offset: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
        },
        { additionalProperties: false },
      ),
      async execute(_call, { path, offset, limit }) {
        return guarded(() => pad.read(agentId, path, offset, limit));
      },
    }),
    defineTool({
      name: 'scratch_write',
      label: 'Write scratch file',
      description: `${scope}Creates or replaces a text file (parent folders are implied by the path). To keep an earlier version, copy_file it first (scratch:… to scratch:…). Limits come from Settings → Swarm; scratch_list shows your usage.`,
      parameters: Type.Object({ path, content: Type.String() }, { additionalProperties: false }),
      async execute(_call, { path, content }) {
        return guarded(() => pad.write(agentId, path, content));
      },
    }),
    defineTool({
      name: 'scratch_edit',
      label: 'Edit scratch file',
      description: `${scope}Applies 1–100 exact replacements to one file: every oldText must appear exactly once in the current text, and matches may not overlap. All are checked before anything changes. Read the file first; if it changed meanwhile, read again.`,
      parameters: Type.Object(
        {
          path,
          edits: Type.Array(
            Type.Object(
              { oldText: Type.String({ minLength: 1 }), newText: Type.String() },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_call, { path, edits }) {
        return guarded(() => pad.edit(agentId, path, edits));
      },
    }),
    defineTool({
      name: 'scratch_move',
      label: 'Move scratch file',
      description: `${scope}Moves or renames a file, or a folder with everything in it. The destination must not exist.`,
      parameters: Type.Object({ from: path, to: path }, { additionalProperties: false }),
      async execute(_call, { from, to }) {
        return guarded(() => pad.move(agentId, from, to));
      },
    }),
    defineTool({
      name: 'scratch_delete',
      label: 'Delete scratch file',
      description: `${scope}Deletes a file, or a folder and everything in it. Permanent; files you presented or uploaded to a chat are separate copies and stay there.`,
      parameters: Type.Object({ path }, { additionalProperties: false }),
      async execute(_call, { path }) {
        return guarded(() => pad.delete(agentId, path));
      },
    }),
  ];
}

export const SCRATCH_GUIDANCE = `## Scratchpad
You have a private scratchpad of text files (scratch_list, scratch_read, scratch_write, scratch_edit, scratch_move, scratch_delete), kept by the platform with or without a computer. Use it to draft and refine artifacts (plans, documents, code, demos) with precise edits instead of re-sending whole texts in chat, and to present them to the human. It is not memory: do not store notes about yourself there. Keep older versions by copying (copy_file scratch:a → scratch:b). Read Swarm Knowledge concepts/scratchpad before first use.`;
