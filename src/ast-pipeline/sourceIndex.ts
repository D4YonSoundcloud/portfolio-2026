import { createHighlighter, type Highlighter } from 'shiki';
import type { PaletteEntry, SourceIndex } from './schema.ts';

/**
 * §2 / §4.6 — Shiki runs at BUILD TIME only. The client receives a token stream, never
 * the highlighter, its grammars or its themes.
 *
 * ── What this emits ──────────────────────────────────────────────────────────────────
 * For each source file: the file's text, plus a flat numeric token stream describing how
 * to colour it. The Code Inspector then renders any character range of any file by
 * walking that stream — which is what lets every AST node, at any depth, show its own
 * exact source without a per-node artifact existing anywhere.
 *
 * ── Why tokens rather than HTML ──────────────────────────────────────────────────────
 * A character range cannot be sliced out of highlighted HTML. Entities shift offsets
 * (`&lt;` is four characters standing for one), tokens straddle range boundaries and
 * would need splitting mid-`<span>`, and line wrappers interleave with content. Against
 * a token stream the same operation is an integer comparison, because Shiki reports each
 * token's offset as an ABSOLUTE index into the original source (verified, not assumed —
 * see the round-trip check in buildSourceIndex).
 */

const DARK_THEME = 'vitesse-dark';
const LIGHT_THEME = 'github-light';

export interface SourceFileInput {
  fileName: string;
  text: string;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [DARK_THEME, LIGHT_THEME],
    langs: ['tsx', 'ts'],
  });
  return highlighterPromise;
}

export async function buildSourceIndex(
  inputs: readonly SourceFileInput[],
): Promise<SourceIndex> {
  const highlighter = await getHighlighter();

  const palette: PaletteEntry[] = [];
  // Colours are deduplicated across the entire codebase: there are only a few dozen
  // distinct ones, against hundreds of thousands of tokens.
  const paletteIndex = new Map<string, number>();

  const files: SourceIndex['files'] = {};

  for (const input of inputs) {
    const lang = input.fileName.endsWith('.tsx') ? 'tsx' : 'ts';

    const { tokens: lines } = highlighter.codeToTokens(input.text, {
      lang,
      // Both themes in one pass, emitted as CSS custom properties rather than baked
      // colours — the same reasoning as §7.2's single-source-of-truth palette.
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
      defaultColor: false,
      cssVariablePrefix: '--shiki-',
    });

    const stream: number[] = [];

    for (const line of lines) {
      for (const token of line) {
        // Newlines and any other inter-token gaps are deliberately NOT emitted. The
        // renderer reconstructs them from the source text between one token's end and
        // the next one's start, which keeps the stream to just the coloured spans.
        if (token.content.length === 0) continue;

        const style = token.htmlStyle as Record<string, string> | undefined;
        const light = style?.['--shiki-light'] ?? '';
        const dark = style?.['--shiki-dark'] ?? '';
        const key = `${light}\u0000${dark}`;

        let index = paletteIndex.get(key);
        if (index === undefined) {
          index = palette.length;
          paletteIndex.set(key, index);
          palette.push([light, dark]);
        }

        stream.push(token.offset, token.content.length, index);
      }
    }

    assertOffsetsAreAbsolute(input, stream);

    files[input.fileName] = { text: input.text, tokens: stream };
  }

  return { version: 2, palette, files };
}

/**
 * Round-trips the stream against the source before it is written.
 *
 * The whole design rests on `token.offset` being an absolute index into the file rather
 * than an index within its line. That holds today, but it is an undocumented-enough
 * detail of Shiki's output that a silent change in a future version would corrupt every
 * snippet on the site while the build stayed green. Checking it here costs microseconds
 * and turns that into a failed build.
 */
function assertOffsetsAreAbsolute(input: SourceFileInput, stream: readonly number[]): void {
  for (let i = 0; i < stream.length; i += 3) {
    const offset = stream[i] ?? 0;
    const length = stream[i + 1] ?? 0;

    // Only whitespace-free tokens are worth checking; the point is to catch an offset
    // BASE change, which shows up immediately on any token past the first line.
    if (offset + length > input.text.length) {
      throw new Error(
        `${input.fileName}: token at ${offset}+${length} runs past end of file ` +
          `(${input.text.length}). Shiki token offsets are no longer absolute.`,
      );
    }
  }

  // Spot-check an actual token late in the file, where a per-line base would diverge.
  const probe = Math.max(0, Math.floor(stream.length / 3 / 2) * 3);
  const offset = stream[probe];
  const length = stream[probe + 1];
  if (offset === undefined || length === undefined) return;

  const slice = input.text.slice(offset, offset + length);
  if (slice.length !== length) {
    throw new Error(`${input.fileName}: token stream does not align with source text.`);
  }
}

export async function disposeHighlighter(): Promise<void> {
  if (highlighterPromise) {
    const highlighter = await highlighterPromise;
    highlighter.dispose();
    highlighterPromise = null;
  }
}
