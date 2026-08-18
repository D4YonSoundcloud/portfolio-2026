import type { ReactNode } from 'react';

import { SectionShell } from './SectionShell.tsx';
import { experience } from './content.ts';
import styles from './Experience.module.css';

/**
 * §5 item 4 — "only if it adds information the projects section doesn't already convey."
 *
 * So this is a timeline, not a second set of case studies: each role gets one line that
 * says something the project write-ups don't. If a note here restates a project, delete
 * the role rather than padding it.
 */
export function Experience(): ReactNode {
  return (
    <SectionShell index={3}>
      <ol className={styles.timeline}>
        {experience.map((role) => (
          <li key={`${role.org}-${role.period}`} className={styles.role}>
            <p className={styles.period}>{role.period}</p>
            <div className={styles.body}>
              <h2 className={styles.title}>
                {role.title}
                <span className={styles.org}>{role.org}</span>
              </h2>
              <p className={styles.note}>{role.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}
