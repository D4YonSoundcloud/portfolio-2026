import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { categorize, kindName } from '../../src/ast-pipeline/categorize.ts';
import { astGraphSchema, snippetsFileSchema } from '../../src/ast-pipeline/schema.ts';

/**
 * §11 — "a lightweight smoke test that the AST-graph JSON generation script runs without
 * throwing and produces schema-valid output — this is the one piece of the pipeline most
 * likely to silently break as the codebase evolves."
 *
 * The generation script itself runs as `prebuild`/`predev`, so rather than shelling out
 * (slow, and it already ran) this validates the artifact it produced.
 */

const GRAPH = resolve(__dirname, '../../public/ast-graph.json');
const SNIPPETS = resolve(__dirname, '../../public/snippets.json');

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

  it('produces schema-valid snippets carrying both themes as CSS variables (§7.2)', () => {
    const parsed = snippetsFileSchema.parse(JSON.parse(readFileSync(SNIPPETS, 'utf8')));
    const first = Object.values(parsed.snippets)[0];
    expect(first).toBeDefined();
    expect(first?.html).toContain('<pre');
    // One markup string serving both themes, so a theme switch is a repaint.
    expect(first?.html).toContain('--shiki-dark');
    expect(first?.html).toContain('--shiki-light');
  });

  /**
   * §4.6 — every node in the scene is clickable, so every node must resolve to a
   * snippet: its own, or an ancestor's via the alias map.
   */
  it('resolves every rendered node to a snippet within a few hops', () => {
    const graph = astGraphSchema.parse(JSON.parse(readFileSync(GRAPH, 'utf8')));
    const file = snippetsFileSchema.parse(JSON.parse(readFileSync(SNIPPETS, 'utf8')));

    const unresolved = graph.nodes.filter((node) => {
      let cursor: string | undefined = node.id;
      for (let hops = 0; cursor && hops < 8; hops += 1) {
        if (file.snippets[cursor]) return false;
        cursor = file.aliases[cursor];
      }
      return true;
    });

    expect(unresolved).toHaveLength(0);
  });

  it('never aliases a node that has its own snippet', () => {
    const file = snippetsFileSchema.parse(JSON.parse(readFileSync(SNIPPETS, 'utf8')));
    for (const id of Object.keys(file.aliases)) {
      expect(file.snippets[id]).toBeUndefined();
    }
  });
});
