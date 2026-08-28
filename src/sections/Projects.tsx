import type { ReactNode } from 'react';

import { SectionShell } from './SectionShell.tsx';
import { projects } from './content.ts';
import styles from './Projects.module.css';

/**
 * §5 item 3 — "case studies with real specifics (problem, constraints, decisions,
 * outcome), not just tech-stack badges."
 *
 * The four labelled rows are the case-study arc, and the labels themselves carry the
 * information — which is why they're named rather than numbered. This is also the item
 * most likely to overflow the viewport, so it's the main exercise of §5.1's escape
 * hatch: wheel/touch over this content scrolls it before advancing the carousel.
 */
export function Projects(): ReactNode {
  return (
    <SectionShell index={3} wide>
      <ol className={styles.list}>
        {projects.map((project) => (
          <li key={project.name} className={styles.project}>
            <header className={styles.header}>
              <h2 className={styles.name}>{project.name}</h2>
              <p className={styles.context}>{project.context}</p>
            </header>

            <dl className={styles.arc}>
              <div className={styles.row}>
                <dt className={styles.term}>Problem</dt>
                <dd className={styles.detail}>{project.problem}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Constraint</dt>
                <dd className={styles.detail}>{project.constraint}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Decision</dt>
                <dd className={styles.detail}>{project.decision}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Outcome</dt>
                <dd className={`${styles.detail} ${styles.outcome}`}>{project.outcome}</dd>
              </div>
            </dl>

            {/* <ul className={styles.stack}>
              {project.stack.map((item) => (
                <li key={item} className={styles.stackItem}>
                  {item}
                </li>
              ))}
            </ul> */}
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}
