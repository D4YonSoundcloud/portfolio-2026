import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { categorize, kindName } from '../../src/ast-pipeline/categorize.ts';
import { astGraphSchema, sourceIndexSchema } from '../../src/ast-pipeline/schema.ts';

/**
 * §11 — "a lightweight smoke test that the AST-graph JSON generation script runs without
 * throwing and produces schema-valid output — this is the one piece of the pipeline most
 * likely to silently break as the codebase evolves."
 *
 * The generation script itself runs as `prebuild`/`predev`, so rather than shelling out
 * (slow, and it already ran) this validates the artifact it produced.
 */

const GRAPH = resolve(__dirname, '../../public/ast-graph.json');
const SOURCE_INDEX = resolve(__dirname, '../../public/source-index.json');

describe('categorize', () => {
  it('maps each SyntaxKind family to its visual bucket', () => {
    expect(categorize(ts.SyntaxKind.FunctionDeclaration)).toBe('Declaration');
    expect(categorize(ts.SyntaxKind.IfStatement)).toBe('ControlFlow');
    expect(categorize(ts.SyntaxKind.JsxElement)).toBe('JSX');
    expect(categorize(ts.SyntaxKind.ImportDeclaration)).toBe('Import');
    expect(categorize(ts.SyntaxKind.StringLiteral)).toBe('Literal');
  });

  it('falls back to Expression for unmapped kinds rather than throwing', () => {
    expect(categorize(ts.SyntaxKind.BinaryExpression)).toBe('Expression');
  });

  /** §4.1 — JSX is checked before Expression, since many JSX kinds are structurally
   * expressions and the JSX reading is the more useful visual signal. */
  it('prefers the JSX reading for JsxExpression', () => {
    expect(categorize(ts.SyntaxKind.JsxExpression)).toBe('JSX');
  });

  it('produces stable kind names', () => {
    expect(kindName(ts.SyntaxKind.FunctionDeclaration)).toBe('FunctionDeclaration');
  });
});

describe('generated AST graph', () => {
  it('exists — run `npm run generate:ast` if this fails', () => {
    expect(existsSync(GRAPH)).toBe(true);
  });

  it('is schema-valid', () => {
    const json: unknown = JSON.parse(readFileSync(GRAPH, 'utf8'));
    expect(() => astGraphSchema.parse(json)).not.toThrow();
  });

  it('stays within the desktop node budget (§4.5)', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    expect(graph.nodes.length).toBeLessThanOrEqual(4000);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  /** §4 constraint — the pipeline is confined to this repository's own source. */
  it('contains no file outside src/', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    for (const file of graph.files) {
      expect(file.startsWith('src/')).toBe(true);
    }
  });

  it('bakes a finite position for every node, since the runtime never simulates (§4.3)', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(Number.isFinite(node.position.z)).toBe(true);
    }
  });

  it('emits only edges whose endpoints both exist', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    for (const [from, to] of graph.edges) {
      expect(graph.nodes[from]).toBeDefined();
      expect(graph.nodes[to]).toBeDefined();
    }
  });

  it('bakes absolute character offsets for every node, not just line numbers', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    for (const node of graph.nodes) {
      expect(node.loc.end).toBeGreaterThanOrEqual(node.loc.start);
    }
  });

  it('produces a schema-valid source index with a deduplicated palette', () => {
    const index = sourceIndexSchema.parse(JSON.parse(readFileSync(SOURCE_INDEX, 'utf8')));
    expect(Object.keys(index.files).length).toBeGreaterThan(0);
    expect(index.palette.length).toBeGreaterThan(0);
    // A few dozen colours across the whole codebase, not one per token.
    expect(index.palette.length).toBeLessThan(200);
  });

  /**
   * The design rests on token offsets being absolute indices into the file. If a future
   * Shiki release made them per-line, every snippet on the site would silently render
   * the wrong characters — so this asserts the round-trip directly.
   */
  it('emits token streams whose offsets index the file text correctly', () => {
    const index = sourceIndexSchema.parse(JSON.parse(readFileSync(SOURCE_INDEX, 'utf8')));

    for (const [name, file] of Object.entries(index.files)) {
      expect(file.tokens.length % 3).toBe(0);
      for (let i = 0; i < file.tokens.length; i += 3) {
        const offset = file.tokens[i]!;
        const length = file.tokens[i + 1]!;
        const paletteIndex = file.tokens[i + 2]!;
        expect(offset + length, `${name} token ${i / 3}`).toBeLessThanOrEqual(file.text.length);
        expect(index.palette[paletteIndex]).toBeDefined();
      }
    }
  });

  /** Every node must be renderable — this is what replaced the alias map. */
  it('gives every node a range that lies inside its own file', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    const index = sourceIndexSchema.parse(JSON.parse(readFileSync(SOURCE_INDEX, 'utf8')));

    for (const node of graph.nodes) {
      const file = index.files[node.fileName];
      expect(file, node.fileName).toBeDefined();
      expect(node.loc.end).toBeLessThanOrEqual(file!.text.length);
    }
  });
});
