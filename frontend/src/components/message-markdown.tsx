import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkSpoiler from 'remark-inline-spoiler';
import { toString } from 'hast-util-to-string';
import type { Parent, PhrasingContent } from 'mdast';
import { Button } from '@/components/ui/button';
import 'highlight.js/styles/github-dark.css';
import './message-markdown.css';

interface SpoilerNode extends Parent { type: 'spoiler'; children: PhrasingContent[] }
declare module 'mdast' {
  interface PhrasingContentMap { spoiler: SpoilerNode }
  interface RootContentMap { spoiler: SpoilerNode }
}

function safeUrl(value: string, key: string) {
  try {
    const url = new URL(value);
    const allowed = key === 'src' ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:'];
    return allowed.includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return <button type="button" aria-label={revealed ? 'Hide spoiler' : 'Reveal spoiler'} aria-expanded={revealed}
    onClick={event => { event.preventDefault(); event.stopPropagation(); setRevealed(value => !value); }} className={`rounded px-1 text-left align-baseline outline-none focus-visible:ring-1 focus-visible:ring-current ${revealed ? 'bg-black/10' : 'bg-muted'}`}>
    <span aria-hidden={!revealed} className={revealed ? '' : 'invisible'}>{children}</span>
  </button>;
}

// Kibo Code Block header/body/copy composition, without demo file selectors or icon packs.
function CodeBlock({ code, language, children }: { code: string; language: string; children: ReactNode }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copyCode() {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(code.replace(/\n$/, '')); setCopy('copied'); }
    catch { setCopy('failed'); }
    timer.current = setTimeout(() => setCopy('idle'), 2000);
  }
  return <div className="message-code overflow-hidden rounded-lg border border-border bg-sidebar text-foreground">
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1">
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{language || 'text'}</span>
      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 border-0 px-2 text-xs" aria-label={copy === 'copied' ? 'Copied code' : 'Copy code'} onClick={() => void copyCode()}>
        {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
    </div>
    <pre tabIndex={0} aria-label={`${language || 'Plain text'} code`} className="overflow-x-auto p-3 text-xs leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">{children}</pre>
  </div>;
}

const components: Components = {
  pre: ({ node, children }) => {
    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
    const classes = code?.type === 'element' ? code.properties.className : [];
    const language = Array.isArray(classes) ? String(classes.find(value => typeof value === 'string' && value.startsWith('language-')) ?? '').replace(/^language-/, '') : '';
    return <CodeBlock code={node ? toString(node) : ''} language={language}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  // No automatic third-party image requests from model-generated Markdown.
  img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">[Image: {alt || 'View image'}]</a> : <span>[Image: {alt || 'unavailable'}]</span>,
  table: ({ children }) => <div className="message-table" role="region" aria-label="Message table" tabIndex={0}><table>{children}</table></div>,
  span: ({ node, ...props }) => node?.properties['dataSpoiler'] ? <Spoiler>{props.children}</Spoiler> : <span {...props} />,
};

function InlineBlock({ children }: { children?: ReactNode }) { return <span>{children}{' '}</span>; }
function InlineHeading({ children }: { children?: ReactNode }) { return <strong>{children}{' '}</strong>; }

// Cards are buttons: flatten blocks and omit nested controls, navigation, and spoiler contents.
const previewComponents: Components = {
  p: InlineBlock, pre: InlineBlock, blockquote: InlineBlock, section: InlineBlock,
  ul: InlineBlock, ol: InlineBlock, li: InlineBlock,
  table: InlineBlock, thead: InlineBlock, tbody: InlineBlock, tr: InlineBlock, th: InlineBlock, td: InlineBlock,
  h1: InlineHeading, h2: InlineHeading, h3: InlineHeading, h4: InlineHeading, h5: InlineHeading, h6: InlineHeading,
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>[Image{alt ? `: ${alt}` : ''}]</span>,
  br: () => <>{' '}</>, hr: () => <span> — </span>,
  input: ({ checked }) => <span>{checked ? '☑ ' : '☐ '}</span>,
  span: ({ node, children }) => <span>{node?.properties['dataSpoiler'] ? '[Spoiler]' : children}</span>,
};

export function renderMessagePreview(text: string) { return <MessageMarkdown text={text} preview />; }

// The syntax highlighter (and its language grammars) is large, so it loads the first time a message actually has a code block.
type Highlighter = typeof import('rehype-highlight').default;
let highlighter: Highlighter | undefined;
let highlighterLoading: Promise<Highlighter> | undefined;
const hasCode = (text: string) => text.includes('```') || text.includes('~~~');
function useHighlighter(text: string, enabled: boolean) {
  const [plugin, setPlugin] = useState<Highlighter | undefined>(highlighter);
  useEffect(() => {
    if (plugin || !enabled || !hasCode(text)) return;
    let cancelled = false;
    highlighterLoading ??= import('rehype-highlight').then(module => (highlighter = module.default));
    void highlighterLoading.then(loaded => { if (!cancelled) setPlugin(() => loaded); }).catch(() => { highlighterLoading = undefined; });
    return () => { cancelled = true; };
  }, [plugin, enabled, text]);
  return plugin;
}

export const MessageMarkdown = memo(function MessageMarkdown({ text, preview = false }: { text: string; preview?: boolean }) {
  const highlight = useHighlighter(text, !preview);
  const Wrapper = preview ? 'span' : 'div';
  return <Wrapper className={preview ? 'message-preview' : 'message-markdown'}>
    <Markdown skipHtml urlTransform={safeUrl} remarkPlugins={[remarkGfm, remarkBreaks, remarkSpoiler]}
      remarkRehypeOptions={{ handlers: { spoiler: (state, node) => ({
        type: 'element', tagName: 'span', properties: { dataSpoiler: true },
        children: 'children' in node ? state.all(node) : [],
      }) } }}
      rehypePlugins={preview || !highlight ? [] : [[highlight, { detect: false, ignoreMissing: true }]]} components={preview ? previewComponents : components}>
      {text}
    </Markdown>
  </Wrapper>;
});
