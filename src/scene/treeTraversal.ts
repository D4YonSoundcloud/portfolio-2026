import type { Vector3 } from 'three';
import type { AstNode } from '../ast-pipeline/schema.ts';

/**
 * Wheel traversal of the syntax tree while a node is open in the inspector.
 *
 * Kept as pure functions with no React or three-scene dependency beyond plain vectors,
 * so the ordering rules — which are the fiddly part — can be reasoned about and tested
 * without a renderer.
 *
 * ── The model ────────────────────────────────────────────────────────────────────────
 * A session is a depth-first walk from the node the visitor first clicked, plus a
 * recording of the order it actually happened in.
 *
 *   `visited`  every node stepped onto, in order. Never reordered, never pruned.
 *   `cursor`   where in that recording we currently are.
 *   `stack`    the live DFS frames, each holding the children it has not yet handed out.
 *
 * Scrolling back up walks `cursor` backwards through `visited`, which is what makes
 * ascending retrace the exact branch order the visitor descended through rather than
 * recomputing a route that may since have changed with the camera. Scrolling down past
 * the recording's end advances the DFS and appends.
 */

export interface TraversalSession {
  /**
   * The topmost node the walk currently spans.
   *
   * This starts as the node that was clicked but RISES as the visitor scrolls up past
   * it — the clicked node is an entry point, not a ceiling.
   */
  root: string;
  visited: string[];
  cursor: number;
  stack: TraversalFrame[];
}

interface TraversalFrame {
  id: string;
  /** Children not yet handed out, already in camera order. */
  remaining: string[];
}

export interface TraversalContext {
  nodesById: Map<string, AstNode>;
  cameraPosition: Vector3;
  /** Unit vector the camera is looking along, for the in-front/behind test. */
  cameraForward: Vector3;
  /**
   * Unit vector from the camera through the visitor's pointer.
   *
   * Distinct from `cameraForward` on purpose: descending picks branches by distance to
   * the CAMERA, because the visitor is being carried along and has not aimed at
   * anything. Jumping to an unexplored branch picks by distance to the POINTER, because
   * there the visitor is choosing where to go next and the cursor is that choice.
   *
   * Falls back to `cameraForward` when there is no pointer — touch devices, or before
   * the pointer has ever moved.
   */
  pointerDirection?: Vector3;
}

/**
 * Orders a node's children by which branch reaches closest to the camera.
 *
 * The rule, in order of precedence:
 *   1. Branches with at least one leaf IN FRONT of the camera come first, nearest first.
 *   2. Branches whose leaves are all BEHIND come after, furthest first.
 *
 * Rule 2 looks backwards until you picture it: if everything is behind you, the furthest
 * leaf is the one whose branch sweeps widest across the view as the camera turns to it,
 * so it is the most legible place to go next. The nearest-behind branch is the one
 * directly over your shoulder, which reads as a jump cut.
 *
 * Ordering is computed once, when a frame is created, using the camera pose at that
 * moment. Recomputing every step would let the order shuffle under the visitor mid-walk.
 */
export function orderChildrenByCamera(
  nodeId: string,
  context: TraversalContext,
): string[] {
  const node = context.nodesById.get(nodeId);
  if (!node) return [];

  const scored = node.childIds
    .filter((id) => context.nodesById.has(id))
    .map((id) => ({ id, ...scoreBranch(id, context) }))
    .filter((entry) => entry.leafCount > 0);

  const inFront = scored.filter((entry) => entry.hasFrontLeaf);
  const behind = scored.filter((entry) => !entry.hasFrontLeaf);

  inFront.sort((a, b) => a.nearestFront - b.nearestFront);
  behind.sort((a, b) => b.furthestBehind - a.furthestBehind);

  return [...inFront, ...behind].map((entry) => entry.id);
}

interface BranchScore {
  leafCount: number;
  hasFrontLeaf: boolean;
  /** Distance to the closest leaf in front of the camera. Infinity when none are. */
  nearestFront: number;
  /** Distance to the furthest leaf behind the camera. */
  furthestBehind: number;
}

/**
 * Walks a subtree collecting distances to its leaves. A "leaf" here means leaf among
 * VISIBLE nodes — the depth filter can make an interior node terminal, and traversal
 * must never step onto something that is not on screen.
 */
function scoreBranch(rootId: string, context: TraversalContext): BranchScore {
  const { nodesById, cameraPosition, cameraForward } = context;

  let leafCount = 0;
  let hasFrontLeaf = false;
  let nearestFront = Infinity;
  let furthestBehind = 0;

  const stack = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);

    const node = nodesById.get(id);
    if (!node) continue;

    const children = node.childIds.filter((childId) => nodesById.has(childId));
    if (children.length === 0) {
      leafCount += 1;

      const dx = node.position.x - cameraPosition.x;
      const dy = node.position.y - cameraPosition.y;
      const dz = node.position.z - cameraPosition.z;
      const distance = Math.hypot(dx, dy, dz);
      // Positive means the leaf is ahead of the camera plane.
      const along = dx * cameraForward.x + dy * cameraForward.y + dz * cameraForward.z;

      if (along > 0) {
        hasFrontLeaf = true;
        nearestFront = Math.min(nearestFront, distance);
      } else {
        furthestBehind = Math.max(furthestBehind, distance);
      }
      continue;
    }

    stack.push(...children);
  }

  return { leafCount, hasFrontLeaf, nearestFront, furthestBehind };
}

export function createSession(rootId: string, context: TraversalContext): TraversalSession {
  return {
    root: rootId,
    visited: [rootId],
    cursor: 0,
    stack: [{ id: rootId, remaining: orderChildrenByCamera(rootId, context) }],
  };
}

/**
 * Steps one node deeper, returning the node now under the cursor.
 *
 * If the cursor is behind the end of the recording (the visitor scrolled back up and is
 * now coming down again) this replays the recorded order instead of recomputing it.
 * Otherwise it advances the DFS: hand out the current frame's next child, or — when a
 * branch is exhausted — pop back to the nearest ancestor that still has children left
 * and continue there. That pop-and-continue is what makes the walk move on to the next
 * branch automatically once it bottoms out, and terminate only when every branch under
 * the session root has been seen.
 */
export function stepDown(
  session: TraversalSession,
  context: TraversalContext,
): string | null {
  if (session.cursor < session.visited.length - 1) {
    session.cursor += 1;
    return session.visited[session.cursor] ?? null;
  }

  while (session.stack.length > 0) {
    const frame = session.stack[session.stack.length - 1];
    if (!frame) break;

    const nextId = frame.remaining.shift();
    if (nextId === undefined) {
      session.stack.pop();
      continue;
    }

    session.stack.push({ id: nextId, remaining: orderChildrenByCamera(nextId, context) });
    session.visited.push(nextId);
    session.cursor = session.visited.length - 1;
    return nextId;
  }

  // Every branch below the session root has been walked.
  return null;
}

/**
 * Steps back one node.
 *
 * Within the recording this simply rewinds the cursor, which is what makes ascent
 * retrace the exact branch order the visitor descended through.
 *
 * At the FRONT of the recording it climbs to the parent instead, so scrolling up keeps
 * working past the node originally clicked — walking out towards the file root rather
 * than hitting a wall. Three things happen when it does:
 *
 *   1. The parent is prepended to the recording, so scrolling back down retraces the
 *      way you came before resuming the descent.
 *   2. A DFS frame for the parent is pushed under the existing stack. Because frames
 *      are popped from the top, this one is reached only once everything below the old
 *      root is exhausted — at which point the walk continues into the SIBLING branches
 *      the climb just made reachable.
 *   3. `root` rises to the parent, so those sibling subtrees now count as part of this
 *      session and clicking into one continues the walk instead of resetting it.
 *
 * Returns null only at the top of the visible tree — a file root, or a node whose
 * parent the depth filter has hidden.
 */
export function stepUp(
  session: TraversalSession,
  context: TraversalContext,
): string | null {
  if (session.cursor > 0) {
    session.cursor -= 1;
    return session.visited[session.cursor] ?? null;
  }

  const front = session.visited[0];
  if (front === undefined) return null;

  const walked = new Set(session.visited);
  const parentId = context.nodesById.get(front)?.parentId ?? null;

  // Not in nodesById means the depth filter has hidden it — never step onto something
  // that is not on screen. An already-walked parent means we have climbed this way
  // before, so there is nothing above left to reveal.
  if (parentId === null || !context.nodesById.has(parentId) || walked.has(parentId)) {
    // Out of ancestors, but possibly not out of tree: jump to whichever branch the
    // visitor has NOT walked yet lies closest to their pointer. Scrolling up stops
    // meaning "towards the root" and starts meaning "onwards into new territory".
    const unexplored = nearestUnexploredBranch(session, context);
    if (unexplored === null) return null;

    session.visited.unshift(unexplored);
    session.cursor = 0;
    return unexplored;
  }

  const alreadyWalked = walked;
  session.stack.unshift({
    id: parentId,
    remaining: orderChildrenByCamera(parentId, context).filter((id) => !alreadyWalked.has(id)),
  });

  session.visited.unshift(parentId);
  session.cursor = 0;
  session.root = parentId;

  return parentId;
}

/**
 * The unwalked branch lying closest to the visitor's pointer.
 *
 * Candidates are every visible child of an already-visited node that has not itself been
 * visited — which is exactly the frontier of the walk so far. A branch is scored by the
 * closest approach of ANY node in its subtree to the pointer ray, not just its leaves:
 * a branch whose upper reaches sit under the cursor should win even if it happens to
 * trail off somewhere distant.
 */
function nearestUnexploredBranch(
  session: TraversalSession,
  context: TraversalContext,
): string | null {
  const { nodesById } = context;
  const walked = new Set(session.visited);

  const frontier: string[] = [];
  for (const id of session.visited) {
    const node = nodesById.get(id);
    if (!node) continue;
    for (const childId of node.childIds) {
      if (!walked.has(childId) && nodesById.has(childId)) frontier.push(childId);
    }
  }

  if (frontier.length === 0) return null;

  const origin = context.cameraPosition;
  const direction = context.pointerDirection ?? context.cameraForward;

  let best: string | null = null;
  let bestDistance = Infinity;

  for (const id of frontier) {
    const distance = branchDistanceToRay(id, nodesById, origin, direction);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }

  return best;
}

/** Closest approach of any node in a subtree to a ray. */
function branchDistanceToRay(
  rootId: string,
  nodesById: Map<string, AstNode>,
  origin: Vector3,
  direction: Vector3,
): number {
  let closest = Infinity;

  const stack = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);

    const node = nodesById.get(id);
    if (!node) continue;

    const vx = node.position.x - origin.x;
    const vy = node.position.y - origin.y;
    const vz = node.position.z - origin.z;

    // Project onto the ray, clamped at the origin so nodes behind the camera measure
    // from the camera itself rather than folding onto the ray's backwards extension.
    const along = Math.max(0, vx * direction.x + vy * direction.y + vz * direction.z);
    closest = Math.min(
      closest,
      Math.hypot(vx - direction.x * along, vy - direction.y * along, vz - direction.z * along),
    );

    for (const childId of node.childIds) {
      if (nodesById.has(childId)) stack.push(childId);
    }
  }

  return closest;
}

/**
 * Whether a node belongs to the walk already in progress.
 *
 * Clicking a node inside the current session's subtree continues that session; clicking
 * anywhere else starts a fresh one, which is the "reset when we click another node not
 * in the direct tree" rule.
 */
export function isWithinSession(
  session: TraversalSession,
  nodeId: string,
  nodesById: Map<string, AstNode>,
): boolean {
  if (session.visited.includes(nodeId)) return true;

  // Walk up from the candidate; if we reach the session root it is a descendant.
  let cursor: string | null = nodeId;
  const guard = new Set<string>();
  while (cursor !== null && !guard.has(cursor)) {
    if (cursor === session.root) return true;
    guard.add(cursor);
    cursor = nodesById.get(cursor)?.parentId ?? null;
  }
  return false;
}