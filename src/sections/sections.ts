/**
 * §5 — the focus carousel's items, in order.
 *
 * `clusterPath` is the crux of §4.3: each item points at a real directory in this
 * repository's source. The camera target for an item is the centroid of the AST nodes
 * generated from that directory — so "Projects" flies to the cluster of code that
 * actually renders the Projects section. The mapping is a structural fact about the
 * codebase, not a hand-placed camera waypoint.
 */

export interface SectionDef {
  id: string;
  /** Rendered as a code comment per §7.1's structural device. */
  label: string;
  /** Announced via aria-live on focus change (§5.3). */
  announceLabel: string;
  /** Source directory whose AST nodes form this item's camera target. */
  clusterPath: string;
}

export const SECTIONS = [
  {
    id: 'hero',
    label: '// intro',
    announceLabel: 'Introduction',
    clusterPath: 'src/App.tsx',
  },
  {
    id: 'about',
    label: '// about',
    announceLabel: 'About',
    clusterPath: 'src/design',
  },
  {
    id: 'experience',
    label: '// experience',
    announceLabel: 'Experience',
    clusterPath: 'src/ast-pipeline',
  },
  {
    id: 'projects',
    label: '// projects',
    announceLabel: 'Projects',
    clusterPath: 'src/scene',
  },
  {
    id: 'contact',
    label: '// contact',
    announceLabel: 'Contact',
    clusterPath: 'src/navigation',
  },
] as const satisfies readonly SectionDef[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export const SECTION_COUNT = SECTIONS.length;
