import { createHighlighter, type Highlighter } from 'shiki';
import type { Snippet } from './schema.ts';

/**
 * §2 / §4.6 — Shiki runs at BUILD TIME only. The Code Inspector receives pre-rendered
 * syntax-highlighted markup, so neither the highlighter nor its grammar/theme files ever
 * reach the browser bundle.
 *
 * Both themes are rendered up front rather than re-highlighting on theme change, because
 * §7.2's theme switch has to be instant and a snippet's markup is small.
 */

const DARK_THEME = 'vitesse-dark';
const LIGHT_THEME = 'github-light';

/** Lines beyond this are truncated — the panel is a preview, not a file viewer. */
const MAX_SNIPPET_LINES = 60;

export interface SnippetSource {
  nodeId: string;
  fileName: string;
  kind: string;
  label: string | null;
  startLine: number;
  endLine: number;
  /** Full text of the containing file, already read from disk. */
  fileText: string;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [DARK_THEME, LIGHT_THEME],
    langs: ['tsx', 'ts'],
  });
  return highlighterPromise;
}

export async function buildSnippets(
  sources: readonly SnippetSource[],
): Promise<Record<string, Snippet>> {
  const highlighter = await getHighlighter();
  const out: Record<string, Snippet> = {};

  for (const source of sources) {
    const lines = source.fileText.split('\n');
    const start = Math.max(0, source.startLine);
    const end = Math.min(lines.length, source.endLine + 1);

    let selected = lines.slice(start, end);
    let truncated = false;
    if (selected.length > MAX_SNIPPET_LINES) {
      selected = selected.slice(0, MAX_SNIPPET_LINES);
      truncated = true;
    }

    const code = dedent(selected).join('\n') + (truncated ? '\n// …' : '');
    const lang = source.fileName.endsWith('.tsx') ? 'tsx' : 'ts';

    out[source.nodeId] = {
      nodeId: source.nodeId,
      breadcrumb: source.label
        ? `${source.fileName} › ${source.kind} · ${source.label}`
        : `${source.fileName} › ${source.kind}`,
      // Dual-theme output: tokens carry `--shiki-dark` / `--shiki-light` custom
      // properties, and tokens.css picks the active one per `data-theme`.
      html: highlighter.codeToHtml(code, {
        lang,
        themes: { light: LIGHT_THEME, dark: DARK_THEME },
        defaultColor: false,
        cssVariablePrefix: '--shiki-',
      }),
      startLine: start + 1,
    };
  }

  return out;
}

/**
 * A snippet lifted from deep inside a file arrives with its original indentation, which
 * wastes most of the panel's width on a phone. Strip the common leading whitespace.
 */
function dedent(lines: readonly string[]): string[] {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    min = Math.min(min, indent);
  }
  if (!Number.isFinite(min) || min === 0) return [...lines];
  return lines.map((line) => line.slice(min));
}

export async function disposeHighlighter(): Promise<void> {
  if (highlighterPromise) {
    const highlighter = await highlighterPromise;
    highlighter.dispose();
    highlighterPromise = null;
  }
}
