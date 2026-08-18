import type { ReactNode } from 'react';

import { SectionShell } from './SectionShell.tsx';
import { contact, profile } from './content.ts';
import styles from './Contact.module.css';

/**
 * §5 item 5 — "direct, minimal friction (email + links), no contact form backend needed
 * for a static site."
 *
 * A form here would be worse in every direction: it needs a backend the architecture
 * doesn't have (§1 non-goals), and it gives the visitor less than a mailto they can
 * paste into their own client.
 */
export function Contact(): ReactNode {
  return (
    <SectionShell index={4}>
      <h2 className={styles.heading}>{contact.lead}</h2>

      <a className={styles.email} href={`mailto:${profile.email}`}>
        {profile.email}
      </a>

      <p className={styles.note}>{contact.note}</p>

      <ul className={styles.links}>
        {profile.links.map((link) => (
          <li key={link.label}>
            <a
              className={styles.link}
              href={link.href}
              rel="noreferrer noopener"
              target="_blank"
            >
              {link.label}
              <span className={styles.arrow} aria-hidden="true">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
