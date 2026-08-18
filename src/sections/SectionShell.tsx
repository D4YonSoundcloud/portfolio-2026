import { useCallback, type ReactNode } from 'react';

import { SECTIONS } from './sections.ts';
import { useSceneStore } from '../store/sceneStore.ts';
import { inspectorCta } from './content.ts';
import styles from './Section.module.css';

/**
 * The shell every focus item shares: the §7.1 structural device (section labels styled
 * as real code comments — justified because the visitor is looking at literal source in
 * the background) and the §4.6 "view source" affordance.
 */

interface SectionShellProps {
  index: number;
  children: ReactNode;
  /** Wider items (Projects) opt out of the default reading measure. */
  wide?: boolean;
}

export function SectionShell({ index, children, wide = false }: SectionShellProps): ReactNode {
  const section = SECTIONS[index];

  return (
    <div className={styles.shell} data-wide={wide || undefined}>
      <p className="label" aria-hidden="true">
        {section?.label}
      </p>
      {children}
      <ViewSourceButton index={index} />
    </div>
  );
}

/**
 * §4.6 — "a 'view source' affordance on the currently-focused content item, which
 * highlights the corresponding cluster and opens the panel in one motion."
 *
 * This is also the keyboard-reachable route into the inspector: clicking a node in the
 * 3D scene requires a pointer and precise aim, so without this the panel would be
 * pointer-only (§9).
 */
function ViewSourceButton({ index }: { index: number }): ReactNode {
  const openInspector = useSceneStore((s) => s.openInspector);
  const section = SECTIONS[index];

  const onClick = useCallback(() => {
    if (!section) return;
    // The section's cluster path is a real directory; its synthetic file root is the
    // node whose source best represents "the code behind this section" (§4.3).
    void fetch(`${import.meta.env.BASE_URL}ast-graph.json`)
      .then((response) => response.json())
      .then((json: { nodes?: Array<{ id: string; fileName: string }> }) => {
        const match = json.nodes?.find(
          (node) => node.fileName.startsWith(section.clusterPath) && node.id.endsWith('#root'),
        );
        if (match) openInspector(match.id);
      })
      .catch(() => {
        /* §4.7 — additive polish; a failure here must never break the content. */
      });
  }, [section, openInspector]);

  return (
    <button type="button" className={styles.viewSource} onClick={onClick}>
      <span className={styles.viewSourceLabel}>{inspectorCta.label}</span>
      <span className={styles.viewSourceHint}>{inspectorCta.hint}</span>
    </button>
  );
}
