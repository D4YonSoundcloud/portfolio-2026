import { sourceIndexSchema, type SourceIndex } from '../ast-pipeline/schema.ts';

/**
 * §4.6 — loads the build-time source index.
 *
 * Fetched lazily on the first inspector open, not at boot: most visitors never click a
 * node (§4.6 — "the scene must look intentional with zero interaction"), so this should
 * not be part of the initial payload.
 *
 * One fetch serves every node at every depth, because a node is only ever a character
 * range into a file that is already here.
 */

let cache: Promise<SourceIndex> | null = null;

export function loadSourceIndex(): Promise<SourceIndex> {
  cache ??= fetch(`${import.meta.env.BASE_URL}source-index.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`source-index.json: HTTP ${response.status}`);
      return response.json();
    })
    .then((json: unknown) => sourceIndexSchema.parse(json))
    .catch((error: unknown) => {
      // Let the next open retry rather than caching a rejection forever.
      cache = null;
      throw error;
    });

  return cache;
}

/** Test seam — resets the module-level cache between cases. */
export function resetSourceCache(): void {
  cache = null;
}
