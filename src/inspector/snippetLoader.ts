import { snippetsFileSchema, type Snippet } from '../ast-pipeline/schema.ts';

/**
 * §4.6 — reads the pre-highlighted snippets generated at build time.
 *
 * Fetched lazily on the first inspector open, not at boot: most visitors never click a
 * node (§4.6 — "the scene must look intentional with zero interaction"), so this should
 * not be part of the initial payload.
 */

export interface SnippetIndex {
  snippets: Map<string, Snippet>;
  /** Node id -> id of the nearest ancestor that has a snippet (§4.6). */
  aliases: Map<string, string>;
}

let cache: Promise<SnippetIndex> | null = null;

export function loadSnippets(): Promise<SnippetIndex> {
  cache ??= fetch(`${import.meta.env.BASE_URL}snippets.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`snippets.json: HTTP ${response.status}`);
      return response.json();
    })
    .then((json: unknown) => {
      const parsed = snippetsFileSchema.parse(json);
      return {
        snippets: new Map(Object.entries(parsed.snippets)),
        aliases: new Map(Object.entries(parsed.aliases)),
      };
    })
    .catch((error: unknown) => {
      // Let the next open retry rather than caching a rejection forever.
      cache = null;
      throw error;
    });

  return cache;
}

/**
 * Resolves a node id to the snippet that should be shown for it: its own if it has one,
 * otherwise the nearest ancestor's (§4.6). Follows at most a few hops — the alias map is
 * pre-flattened at build time, so this loop is a safety net against a malformed artifact
 * rather than a real traversal.
 */
export function resolveSnippet(index: SnippetIndex, nodeId: string): Snippet | null {
  let cursor: string | undefined = nodeId;
  for (let hops = 0; cursor && hops < 8; hops += 1) {
    const direct = index.snippets.get(cursor);
    if (direct) return direct;
    cursor = index.aliases.get(cursor);
  }
  return null;
}

/** Test seam — resets the module-level cache between cases. */
export function resetSnippetCache(): void {
  cache = null;
}
