import type { AstNode } from '../ast-pipeline/schema.ts';
import type { InspectorTarget } from '../store/sceneStore.ts';

/**
 * Narrows an AstNode to just what the Code Inspector needs (§4.6).
 *
 * Every caller of `openInspector` already holds the full node; the panel needs six
 * fields. Converting here keeps that mapping in one place rather than repeated at each
 * call site, so adding a field to the panel is a single edit.
 */
export function toInspectorTarget(node: AstNode): InspectorTarget {
  return {
    id: node.id,
    fileName: node.fileName,
    kind: node.kind,
    label: node.label,
    start: node.loc.startLine,
    end: node.loc.endLine,
  };
}
