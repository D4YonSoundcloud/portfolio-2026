import type { ReactNode } from 'react';

import { SectionShell } from './SectionShell.tsx';
import { about } from './content.ts';
import styles from './About.module.css';

/** §5 item 2 — "brief, human, not a résumé restated in prose." */
export function About(): ReactNode {
  return (
    <SectionShell index={1}>
      <div className={styles.prose}>
        {about.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 32)}>{paragraph}</p>
        ))}
      </div>

      {/* A definition list, because that is what this is: keys and values. The schematic
          direction in §7.1 wants structure that encodes something true, not decoration. */}
      <dl className={styles.asides}>
        {about.asides.map((aside) => (
          <div key={aside.key} className={styles.aside}>
            <dt className={styles.key}>{aside.key}</dt>
            <dd className={styles.value}>{aside.value}</dd>
          </div>
        ))}
      </dl>
    </SectionShell>
  );
}
