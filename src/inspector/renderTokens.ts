import type { SourceFile } from '../ast-pipeline/schema.ts';

/**
 * §4.6 — turns a file's token stream into renderable segments for a character range.
 *
 * Kept pure and free of React so the two genuinely tricky parts — windowing to the lines
 * around a range, and splitting tokens that straddle its boundaries — can be tested
 * directly rather than through a rendered panel.
 *
 * ── Why segments rather than HTML ────────────────────────────────────────────────────
 * The panel renders these as React elements, so text becomes text nodes and escaping
 * stops being something that has to be got right. The previous version shipped
 * pre-escaped markup through `dangerouslySetInnerHTML`; nothing here needs that.
 */

export interface Segment {
  text: string;
  /** Index into the source index's palette, or null for whitespace between tokens. */
  paletteIndex: number | null;
  /** True when this segment falls inside the node's own character range. */
  highlighted: boolean;
}

export interface RenderedSnippet {
  segments: Segment[];
  /** 1-based line number of the first line shown, for the gutter. */
  firstLine: number;
  /** True when the window omits lines above or below the node. */
  truncatedAbove: boolean;
  truncatedBelow: boolean;
}

/** Lines of context kept either side of the node's own lines. */
const CONTEXT_LINES = 4;

/** Hard ceiling on the window. A node spanning a whole file is a preview, not a viewer. */
const MAX_WINDOW_LINES = 60;

/**
 * Builds the visible window and its coloured segments.
 *
 * `start`/`end` are absolute half-open character offsets into `file.text`, exactly as
 * `AstNode.loc` carries them.
 */
export function renderSnippet(file: SourceFile, start: number, end: number): RenderedSnippet {
  const { text } = file;

  const clampedStart = Math.max(0, Math.min(start, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(end, text.length));

  const lineStarts = computeLineStarts(text);

  const nodeFirstLine = lineIndexAt(lineStarts, clampedStart);
  const nodeLastLine = lineIndexAt(lineStarts, Math.max(clampedStart, clampedEnd - 1));

  const windowFirst = Math.max(0, nodeFirstLine - CONTEXT_LINES);
  let windowLast = Math.min(lineStarts.length - 1, nodeLastLine + CONTEXT_LINES);

  // A large node would otherwise drag the entire file into the panel. Prefer keeping the
  // START of the node visible: that is where the declaration and its name live, which is
  // what makes it identifiable.
  if (windowLast - windowFirst + 1 > MAX_WINDOW_LINES) {
    windowLast = windowFirst + MAX_WINDOW_LINES - 1;
  }

  const windowStart = lineStarts[windowFirst] ?? 0;
  const windowEnd =
    windowLast + 1 < lineStarts.length ? (lineStarts[windowLast + 1] ?? text.length) : text.length;

  const segments = buildSegments(file, windowStart, windowEnd, clampedStart, clampedEnd);

  // Common leading indentation wastes most of a phone's width on a deeply nested node.
  const dedented = dedentSegments(segments);

  return {
    segments: dedented,
    firstLine: windowFirst + 1,
    truncatedAbove: windowFirst > 0,
    truncatedBelow: windowLast < lineStarts.length - 1,
  };
}

/**
 * Walks the token stream across the window, emitting a segment per coloured token and
 * per gap between tokens.
 *
 * Gaps matter: the build-time stream deliberately omits newlines and inter-token
 * whitespace, so they are recovered here from the source text between one token's end
 * and the next one's start. Without this the snippet would render as one long line.
 */
function buildSegments(
  file: SourceFile,
  windowStart: number,
  windowEnd: number,
  rangeStart: number,
  rangeEnd: number,
): Segment[] {
  const { text, tokens } = file;
  const segments: Segment[] = [];

  let cursor = windowStart;

  const push = (from: number, to: number, paletteIndex: number | null): void => {
    if (to <= from) return;

    // Split at the range boundaries so a token straddling the edge is partly
    // highlighted — the case that makes slicing pre-rendered HTML impossible.
    for (const [segStart, segEnd] of splitAtBoundaries(from, to, rangeStart, rangeEnd)) {
      if (segEnd <= segStart) continue;
      segments.push({
        text: text.slice(segStart, segEnd),
        paletteIndex,
        highlighted: segStart >= rangeStart && segEnd <= rangeEnd,
      });
    }
  };

  for (let i = 0; i < tokens.length; i += 3) {
    const offset = tokens[i] ?? 0;
    const length = tokens[i + 1] ?? 0;
    const paletteIndex = tokens[i + 2] ?? 0;
    const tokenEnd = offset + length;

    if (tokenEnd <= windowStart) continue;
    if (offset >= windowEnd) break;

    // Uncoloured gap (newlines, indentation) before this token.
    if (offset > cursor) push(cursor, Math.min(offset, windowEnd), null);

    push(Math.max(offset, windowStart), Math.min(tokenEnd, windowEnd), paletteIndex);
    cursor = Math.max(cursor, Math.min(tokenEnd, windowEnd));
  }

  // Trailing gap after the last token in the window.
  if (cursor < windowEnd) push(cursor, windowEnd, null);

  return segments;
}

/**
 * Splits [from, to) wherever it crosses a range boundary, so every resulting piece is
 * wholly inside or wholly outside the node's range.
 */
function splitAtBoundaries(
  from: number,
  to: number,
  rangeStart: number,
  rangeEnd: number,
): Array<[number, number]> {
  const cuts = [from, to];
  if (rangeStart > from && rangeStart < to) cuts.push(rangeStart);
  if (rangeEnd > from && rangeEnd < to) cuts.push(rangeEnd);

  cuts.sort((a, b) => a - b);

  const pieces: Array<[number, number]> = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (a !== undefined && b !== undefined && b > a) pieces.push([a, b]);
  }
  return pieces;
}

/** Character offsets at which each line begins. */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Line index containing an offset, via binary search over line starts. */
function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Removes the indentation every line shares.
 *
 * Operates on the segment list rather than the raw text because indentation is spread
 * across uncoloured gap segments, and rebuilding the text to re-tokenise it would undo
 * the point of the token stream.
 */
function dedentSegments(segments: readonly Segment[]): Segment[] {
  const lines = segmentsToLines(segments);

  let common = Infinity;
  for (const line of lines) {
    const text = line.map((s) => s.text).join('');
    if (text.trim().length === 0) continue;
    common = Math.min(common, text.length - text.trimStart().length);
  }
  if (!Number.isFinite(common) || common === 0) return [...segments];

  const out: Segment[] = [];
  lines.forEach((line, lineIndex) => {
    let remaining = common;
    for (const segment of line) {
      let text = segment.text;
      if (remaining > 0) {
        const strip = Math.min(remaining, text.length - text.trimStart().length);
        text = text.slice(strip);
        remaining -= strip;
        // Any non-whitespace means this line's indentation is exhausted.
        if (text.length > 0) remaining = 0;
      }
      if (text.length > 0) out.push({ ...segment, text });
    }
    if (lineIndex < lines.length - 1) {
      out.push({ text: '\n', paletteIndex: null, highlighted: false });
    }
  });

  return out;
}

/** Regroups segments into lines, splitting any segment that contains a newline. */
function segmentsToLines(segments: readonly Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];

  for (const segment of segments) {
    const parts = segment.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1]?.push({ ...segment, text: part });
    });
  }

  return lines;
}
