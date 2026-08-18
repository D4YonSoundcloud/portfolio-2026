import type { ReactNode } from 'react';

import { SectionShell } from './SectionShell.tsx';
import { profile } from './content.ts';
import styles from './Hero.module.css';

/**
 * §5 item 1 — "the AST scene is most prominent here; a short, specific statement of what
 * you do (not a generic 'Senior Software Engineer' tag)."
 *
 * The hero is deliberately the sparsest item: least copy, most visible scene. Per §7.1
 * the signature element is the AST itself, so nothing here competes with it.
 */
export function Hero(): ReactNode {
  return (
    <SectionShell index={0}>
      <h1 className={styles.statement}>{profile.statement}</h1>
      <p className={styles.support}>{profile.heroSupport}</p>

      <p className={styles.meta}>
        <span>{profile.name}</span>
        <span aria-hidden="true">·</span>
        <span>{profile.location}</span>
      </p>

      {/* The scene has no text explanation anywhere else; this is the one line that tells
          the visitor what they're looking at. Without it the background is just decoration. */}
      <p className={styles.caption}>
        The shapes behind this page are the syntax tree of the site itself, laid out by
        the structure of its own source.
      </p>
    </SectionShell>
  );
}
