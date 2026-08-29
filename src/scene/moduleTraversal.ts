import type { Vector3 } from 'three';

import type { AstNode, ModuleEdge } from '../ast-pipeline/schema.ts';

/**
 * Wheel traversal of the IMPORT graph — the module-level counterpart to
 * `treeTraversal.ts`.
 *
 * Kept as pure functions for the same reason: the ordering rules are the fiddly part and
 * should be reasonable about without a renderer.
 *
 * ── The mapping, and why it is this way round ────────────────────────────────────────
 * Stepping DOWN follows an import, into a dependency. Stepping UP goes to a dependent —
 * a file that imports the current one.
 *
 * That deliberately mirrors child/parent in the tree, so both axes feel like the same
 * gesture applied to different graphs: down is always "further in", up is always "back
 * out towards what contains this". Reversing it would make the two wheels disagree about
 * what a scroll direction means, which is the sort of inconsistency that never becomes
 * conscious but makes an interface feel arbitrary.
 *
 * ── Why this is not just treeTraversal with different edges ──────────────────────────
 * The AST is a tree; the import graph is a directed graph with cycles. Two consequences
 * shape the code below:
 *
 *   - A node can have MANY parents (many files may import it), so "up" is a choice
 *     between candidates rather than a single edge. It is ordered by camera proximity,
 *     the same way branches are.
 *   - Cycles are normal, not corrupt. `visited` therefore guards against revisiting
 *     within a session, and every walk is bounded by the set of files rather than by
 *     tree depth.
 */

export interface ModuleSession {
  /** Files stepped onto, in order. Never reordered or pruned. */
  visited: string[];
  cursor: number;
}

export interface ModuleContext {
  /** Every file-to-file import, as generated at build time. */
  moduleEdges: readonly ModuleEdge[];
  /** File path -> that file's synthetic root node (§4.2). Only visible roots appear. */
  rootsByFile: Map<string, AstNode>;
  cameraPosition: Vector3;
}

/** Adjacency built once per session step; the edge list is tens of entries, not thousands. */
function neighbours(
  file: string,
  context: ModuleContext,
  direction: 1 | -1,
): string[] {
  const out: string[] = [];
  for (const edge of context.moduleEdges) {
    // direction 1 -> dependencies (this file imports them)
    // direction -1 -> dependents (they import this file)
    const matches = direction > 0 ? edge.from === file : edge.to === file;
    if (!matches) continue;
    const other = direction > 0 ? edge.to : edge.from;
    // Never step onto a file with no visible root — the quality cap or depth filter can
    // remove one, and traversal must never target something that is not on screen.
    if (context.rootsByFile.has(other) && !out.includes(other)) out.push(other);
  }
  return out;
}

/**
 * Orders candidate files by distance to the camera, nearest first.
 *
 * Simpler than `orderChildrenByCamera`'s front/behind rule, and deliberately so: that
 * rule exists because an AST branch is a whole subtree whose extent matters. A file root
 * is a single point, so there is nothing to summarise — distance is the whole story.
 */
function orderByCamera(files: readonly string[], context: ModuleContext): string[] {
  return [...files].sort((a, b) => {
    const pa = context.rootsByFile.get(a)?.position;
    const pb = context.rootsByFile.get(b)?.position;
    if (!pa || !pb) return 0;
    const { x, y, z } = context.cameraPosition;
    return (
      Math.hypot(pa.x - x, pa.y - y, pa.z - z) - Math.hypot(pb.x - x, pb.y - y, pb.z - z)
    );
  });
}

export function createModuleSession(file: string): ModuleSession {
  return { visited: [file], cursor: 0 };
}

/**
 * Steps one file along the import graph, returning the file now under the cursor.
 *
 * Replays the recording when the cursor is behind its end, exactly as the tree walk
 * does — so reversing direction retraces the route actually taken rather than
 * recomputing one that may since have changed with the camera.
 */
export function stepModule(
  session: ModuleSession,
  context: ModuleContext,
  direction: 1 | -1,
): string | null {
  // Inside the recording: move the cursor rather than picking a new edge.
  if (direction > 0 && session.cursor < session.visited.length - 1) {
    session.cursor += 1;
    return session.visited[session.cursor] ?? null;
  }
  if (direction < 0 && session.cursor > 0) {
    session.cursor -= 1;
    return session.visited[session.cursor] ?? null;
  }

  const current = session.visited[session.cursor];
  if (current === undefined) return null;

  const walked = new Set(session.visited);

  /**
   * Somewhere new, from the current file if possible and from an earlier one if not.
   *
   * The fallback matters more than it looks. Leaf modules are extremely common — a
   * types file, a constants file — and without backtracking, one step into any of them
   * ends the walk with no indication of why the button stopped responding. The tree
   * walk already handles the equivalent case by popping to the nearest ancestor with
   * children left; this is the graph version of the same rule, scanning back through
   * the recording for a file that still has an unwalked neighbour.
   *
   * Import graphs are also full of cycles and hub modules, which is why every candidate
   * is filtered against `walked` — otherwise a walk would ping-pong between two files
   * that import each other.
   */
  let next: string | null = null;
  for (let i = session.cursor; i >= 0 && next === null; i -= 1) {
    const from = session.visited[i];
    if (from === undefined) continue;
    const candidates = orderByCamera(neighbours(from, context, direction), context);
    next = candidates.find((file) => !walked.has(file)) ?? null;
  }
  if (next === null) return null;

  if (direction > 0) {
    session.visited.push(next);
    session.cursor = session.visited.length - 1;
  } else {
    // Climbing to a dependent extends the recording at the FRONT, so scrolling back down
    // returns the way you came before resuming the descent.
    session.visited.unshift(next);
    session.cursor = 0;
  }

  return next;
}