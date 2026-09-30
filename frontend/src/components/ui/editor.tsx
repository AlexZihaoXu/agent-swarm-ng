import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { EditorProvider as TiptapProvider, useCurrentEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { cn } from '@/lib/utils';

/*
 * Adapted from Kibo UI's Editor (components/editor, TipTap): the provider, the bubble menu with a node selector and
 * format buttons, and the word count. Kept to what agent instructions need (Markdown in and out, headings, lists,
 * quotes, code); tables, sub/superscript, links, slash commands and syntax highlighting are left out.
 */

export function EditorProvider({
  markdown,
  onChange,
  placeholder,
  limit,
  label,
  className,
  children,
}: {
  /** The document as Markdown (read once; later changes come from typing). */
  markdown: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  limit?: number;
  /** The accessible name of the editing area. */
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <TiptapProvider
      content={markdown}
      contentType="markdown"
      immediatelyRender
      extensions={[
        StarterKit.configure({
          link: false,
          bulletList: { HTMLAttributes: { class: 'list-outside list-disc pl-4' } },
          orderedList: { HTMLAttributes: { class: 'list-outside list-decimal pl-4' } },
          blockquote: { HTMLAttributes: { class: 'border-l-2 border-border pl-2 text-muted-foreground' } },
          code: {
            HTMLAttributes: { class: 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]', spellcheck: 'false' },
          },
          codeBlock: {
            HTMLAttributes: { class: 'rounded-md border border-border bg-background p-3 font-mono text-xs' },
          },
          horizontalRule: { HTMLAttributes: { class: 'my-4 border-t border-border' } },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass:
            'before:pointer-events-none before:float-left before:h-0 before:text-muted-foreground before:content-[attr(data-placeholder)]',
        }),
        CharacterCount.configure({ limit }),
        Markdown,
      ]}
      editorContainerProps={{ className: cn('relative', className) }}
      editorProps={{
        attributes: {
          'aria-label': label,
          'aria-multiline': 'true',
          role: 'textbox',
          class:
            'min-h-40 w-full cursor-text px-3 pb-10 pt-3 text-sm leading-relaxed outline-none [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:my-1',
        },
      }}
      onUpdate={({ editor }) => onChange((editor as Editor).getMarkdown())}
    >
      {children}
    </TiptapProvider>
  );
}

type Command = { name: string; icon: ReactNode; isActive: (editor: Editor) => boolean; run: (editor: Editor) => void };
const glyph = (text: string, className = '') => (
  <span aria-hidden="true" className={cn('inline-flex w-4 justify-center text-xs', className)}>
    {text}
  </span>
);
const nodes: Command[] = [
  {
    name: 'Text',
    icon: glyph('¶'),
    isActive: editor =>
      editor.isActive('paragraph') && !editor.isActive('bulletList') && !editor.isActive('orderedList'),
    run: editor => editor.chain().focus().toggleNode('paragraph', 'paragraph').run(),
  },
  ...([1, 2, 3] as const).map(level => ({
    name: `Heading ${level}`,
    icon: glyph(`H${level}`, 'font-semibold'),
    isActive: (editor: Editor) => editor.isActive('heading', { level }),
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level }).run(),
  })),
  {
    name: 'Bullet list',
    icon: glyph('•'),
    isActive: editor => editor.isActive('bulletList'),
    run: editor => editor.chain().focus().toggleBulletList().run(),
  },
  {
    name: 'Numbered list',
    icon: glyph('1.'),
    isActive: editor => editor.isActive('orderedList'),
    run: editor => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    name: 'Quote',
    icon: glyph('❝'),
    isActive: editor => editor.isActive('blockquote'),
    run: editor => editor.chain().focus().toggleNode('paragraph', 'paragraph').toggleBlockquote().run(),
  },
  {
    name: 'Code',
    icon: glyph('</>', 'font-mono text-[10px]'),
    isActive: editor => editor.isActive('codeBlock'),
    run: editor => editor.chain().focus().toggleCodeBlock().run(),
  },
];
const marks: Command[] = [
  {
    name: 'Bold',
    icon: glyph('B', 'font-bold'),
    isActive: e => e.isActive('bold'),
    run: e => e.chain().focus().toggleBold().run(),
  },
  {
    name: 'Italic',
    icon: glyph('I', 'italic font-serif'),
    isActive: e => e.isActive('italic'),
    run: e => e.chain().focus().toggleItalic().run(),
  },
  {
    name: 'Strikethrough',
    icon: glyph('S', 'line-through'),
    isActive: e => e.isActive('strike'),
    run: e => e.chain().focus().toggleStrike().run(),
  },
  {
    name: 'Inline code',
    icon: glyph('`', 'font-mono'),
    isActive: e => e.isActive('code'),
    run: e => e.chain().focus().toggleCode().run(),
  },
  {
    name: 'Clear formatting',
    icon: glyph('⌫'),
    isActive: () => false,
    run: e => e.chain().focus().clearNodes().unsetAllMarks().run(),
  },
];

const buttonClass =
  'flex min-h-8 cursor-pointer items-center gap-2 px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted';

/** Kibo's bubble menu: a node selector ("Text", headings, lists…), then the format buttons, shown on a selection. */
export function EditorBubbleMenu() {
  const { editor } = useCurrentEditor();
  const [open, setOpen] = useState(false);
  // Re-render on selection and content changes, so the node name and pressed marks stay current.
  useEditorState({ editor, selector: context => context.editor?.state });
  if (!editor) return null;
  const current = nodes.find(node => node.isActive(editor)) ?? nodes[0];
  return (
    <BubbleMenu
      editor={editor}
      className="flex overflow-hidden rounded-xl border border-border bg-background p-0.5 shadow-lg"
    >
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className={cn(buttonClass, 'rounded-l-[9px]')} aria-label="Turn into">
            <span className="whitespace-nowrap">{current.name}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m3 4.5 3 3 3-3" />
            </svg>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={5}
            className="z-[70] w-48 rounded-lg border border-border bg-background p-1 shadow-lg"
          >
            {nodes.map(node => (
              <button
                key={node.name}
                type="button"
                className={cn(buttonClass, 'w-full rounded-md')}
                onClick={() => {
                  node.run(editor);
                  setOpen(false);
                }}
              >
                {node.icon}
                <span className="flex-1 text-left">{node.name}</span>
                {node.isActive(editor) && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span aria-hidden="true" className="mx-0.5 my-1 w-px bg-border" />
      {marks.map((mark, index) => (
        <button
          key={mark.name}
          type="button"
          aria-label={mark.name}
          title={mark.name}
          aria-pressed={mark.isActive(editor)}
          className={cn(buttonClass, index === marks.length - 1 && 'rounded-r-[9px]')}
          onClick={() => mark.run(editor)}
        >
          {mark.icon}
        </button>
      ))}
    </BubbleMenu>
  );
}

/** Kibo's word count badge, bottom right of the editor. */
export function EditorWordCount({ limit }: { limit?: number }) {
  const { editor } = useCurrentEditor();
  const counts = useEditorState({
    editor,
    selector: context => ({
      words: (context.editor?.storage.characterCount.words() as number | undefined) ?? 0,
      characters: (context.editor?.storage.characterCount.characters() as number | undefined) ?? 0,
    }),
  });
  if (!editor || !counts) return null;
  const { characters } = counts;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-2 right-2 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground shadow"
    >
      Words: {counts.words}
      {limit ? ` · ${characters.toLocaleString()}/${limit.toLocaleString()}` : ''}
    </div>
  );
}
