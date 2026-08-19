import { describe, expect, it } from 'vitest';

import { renderSnippet } from '../../src/inspector/renderTokens.ts';
import type { SourceFile } from '../../src/ast-pipeline/schema.ts';

/**
 * §4.6 — the renderer replaced per-node HTML snippets with "highlight a character range
 * of a file". The two things that make that non-trivial are splitting a token that
 * straddles the range boundary, and reconstructing the whitespace the token stream
 * deliberately omits. Both are covered here.
 */

/** `const answer = 42;\nreturn answer;` with plausible tokenisation. */
const text = 'const answer = 42;\nreturn answer;\n';
const file: SourceFile = {
  text,
  tokens: [
    0, 5, 0, // const
    6, 6, 1, // answer
    13, 1, 2, // =
    15, 2, 3, // 42
    17, 1, 2, // ;
    19, 6, 0, // return
    26, 6, 1, // answer
    32, 1, 2, // ;
  ],
};

/** Concatenated segment text must always reproduce the source exactly. */
function joined(segments: Array<{ text: string }>): string {
  return segments.map((s) => s.text).join('');
}

describe('renderSnippet', () => {
  it('reproduces the source exactly, including whitespace the stream omits', () => {
    const result = renderSnippet(file, 0, 5);
    // Dedent is a no-op here (no common indentation), so this round-trips.
    expect(joined(result.segments)).toBe(text);
  });

  it('marks exactly the requested character range', () => {
    // "answer" on line 1, offsets 6..12
    const result = renderSnippet(file, 6, 12);
    const hit = result.segments.filter((s) => s.highlighted);
    expect(joined(hit)).toBe('answer');
  });

  it('splits a token that straddles the range boundary', () => {
    // 0..8 cuts through the "answer" token (6..12), leaving "an" inside.
    const result = renderSnippet(file, 0, 8);
    expect(joined(result.segments.filter((s) => s.highlighted))).toBe('const an');
    // The remainder of that token survives, uncoloured differently but present.
    expect(joined(result.segments)).toBe(text);
  });

  it('carries the palette index through onto coloured segments', () => {
    const result = renderSnippet(file, 0, 5);
    const constSegment = result.segments.find((s) => s.text === 'const');
    expect(constSegment?.paletteIndex).toBe(0);
  });

  it('leaves inter-token whitespace uncoloured', () => {
    const result = renderSnippet(file, 0, 5);
    const newline = result.segments.find((s) => s.text.includes('\n'));
    expect(newline?.paletteIndex).toBeNull();
  });

  it('reports a 1-based first line for the gutter', () => {
    expect(renderSnippet(file, 0, 5).firstLine).toBe(1);
  });

  it('clamps a range that runs past the end of the file', () => {
    const result = renderSnippet(file, 0, 10_000);
    expect(joined(result.segments.filter((s) => s.highlighted))).toBe(text);
  });

  it('handles a zero-length range without emitting a highlight', () => {
    const result = renderSnippet(file, 6, 6);
    expect(result.segments.some((s) => s.highlighted)).toBe(false);
    expect(joined(result.segments)).toBe(text);
  });
});

describe('windowing', () => {
  const long: SourceFile = {
    text: Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n'),
    tokens: [],
  };

  it('windows around the node instead of returning the whole file', () => {
    const start = long.text.indexOf('line 200');
    const result = renderSnippet(long, start, start + 8);

    expect(joined(result.segments)).toContain('line 200');
    expect(joined(result.segments)).not.toContain('line 5\n');
    expect(result.truncatedAbove).toBe(true);
    expect(result.truncatedBelow).toBe(true);
    expect(result.firstLine).toBeGreaterThan(190);
  });

  it('caps the window for a node spanning the entire file', () => {
    const result = renderSnippet(long, 0, long.text.length);
    const lines = joined(result.segments).split('\n').length;
    expect(lines).toBeLessThanOrEqual(61);
    // Keeps the START of the node, where the declaration and its name are.
    expect(joined(result.segments)).toContain('line 0');
  });

  it('does not report truncation when the whole file fits', () => {
    const result = renderSnippet(file, 0, 5);
    expect(result.truncatedAbove).toBe(false);
    expect(result.truncatedBelow).toBe(false);
  });
});

describe('dedent', () => {
  const indented: SourceFile = {
    text: '        const a = 1;\n        const b = 2;\n',
    tokens: [8, 5, 0, 29, 5, 0],
  };

  it('strips the indentation every line shares', () => {
    const result = renderSnippet(indented, 8, 13);
    const lines = joined(result.segments).split('\n');
    expect(lines[0]).toBe('const a = 1;');
    expect(lines[1]).toBe('const b = 2;');
  });

  it('keeps the highlight on the right characters after dedenting', () => {
    const result = renderSnippet(indented, 8, 13);
    expect(joined(result.segments.filter((s) => s.highlighted))).toBe('const');
  });
});
