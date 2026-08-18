/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL SITE COPY LIVES HERE. This is the file to edit — nothing below is real.
 *
 * The persona and case studies are placeholders written to the shape §5 and §7.1 ask
 * for (problem, constraint, decision, outcome — not tech-stack badges), so you can see
 * how the layout behaves with realistic copy. Replace the values, not the structure.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * §1 non-goal / §4 constraint: projects are described here in prose the author writes
 * directly. No project's source is parsed, embedded, or linked into the AST pipeline.
 */

export interface Project {
  name: string;
  /** One line on the domain — what the thing is, before what was hard about it. */
  context: string;
  problem: string;
  constraint: string;
  decision: string;
  outcome: string;
  stack: readonly string[];
}

export interface Role {
  period: string;
  title: string;
  org: string;
  /** One line — only what the project write-ups don't already convey (§5, item 4). */
  note: string;
}

export const profile = {
  name: 'Matthew Day',
  /** §5 item 1 — "a short, specific statement of what you do", not a job title. */
  statement: 'I make peoples lifes easier, by building software they need.',
  heroSupport:
    '6 years on data-heavy products, from front-end to back-end, and everything in between, if I havent heard of it, I would love to learn about it.',
  location: 'Orlando, FL, USA',
  email: 'mattd4y@gmail.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/example' },
    { label: 'Writing', href: 'https://example.com/writing' },
    { label: 'LinkedIn', href: 'https://linkedin.com/in/example' },
  ],
} as const;

/** §5 item 2 — brief, human, not a résumé restated in prose. */
export const about = {
  paragraphs: [
    'I like the part of the job where you read something carefully enough that the fix turns out to be small. Most of the work I am proud of removed code rather than adding it.',
    'Lately that has meant query planners, cache invalidation, and build pipelines — systems where the correct answer is measurable and arguing about taste gets you nowhere.',
    'Outside work I restore mechanical keyboards and lose to my daughter at chess with increasing regularity.',
  ],
  /** Small factual asides — the kind of detail that reads as specific rather than styled. */
  asides: [
    { key: 'Currently', value: 'Senior Engineer, Consultant' },
    { key: 'Based in', value: profile.location },
    { key: 'Working in', value: 'TypeScript, React, Node, + many more' },
    { key: 'Open to', value: 'Mid/Senior Level IC roles, Consultancy' },
  ],
} as const;

/** §5 item 3 — real specifics. Problem, constraints, decisions, outcome. */
export const projects: readonly Project[] = [
  {
    name: 'Ledger read path',
    context: 'Transaction history for a payments product, ~2B rows.',
    problem:
      'The account history endpoint had drifted to a p99 of 9.4s. It was the first screen after login, so it was effectively the product’s load time.',
    constraint:
      'No downtime window, no schema migration that locked the table, and the reporting team depended on the existing query shape.',
    decision:
      'Rather than rewrite the endpoint, I traced it to a keyset-pagination bug where an OR predicate defeated the composite index. Fixed the predicate, added a covering index, and put a 30-second read-through cache in front of the first page only — the page 96% of sessions never leave.',
    outcome: 'p99 to 340ms. Two files changed, no migration, no rewrite.',
    stack: ['Postgres', 'Go', 'Redis'],
  },
  {
    name: 'Build pipeline triage',
    context: 'CI for a 40-engineer monorepo.',
    problem:
      'A 41-minute median CI run meant people batched work into large PRs to avoid waiting, which made review worse and made failures harder to attribute.',
    constraint:
      'The test suite could not be weakened — this codebase moved money — and the team had already rejected a proposal to split the monorepo.',
    decision:
      'Instrumented the runner before touching anything. 60% of wall-clock time was Docker layer rebuilds triggered by a lockfile write in a postinstall script. Pinned it, split the suite by historical runtime rather than by directory, and made integration tests run only against changed packages.',
    outcome:
      'Median run to 7 minutes. PR size fell by about half over the next quarter, which was the actual goal.',
    stack: ['Buildkite', 'Docker', 'Bazel'],
  },
  {
    name: 'Search relevance rollback',
    context: 'Internal document search, ~500k documents.',
    problem:
      'A new embedding model shipped with better offline benchmarks and measurably worse user behaviour — clicks moved down the results page.',
    constraint:
      'The model had already been announced internally, and the team was attached to the benchmark numbers.',
    decision:
      'Built a small side-by-side evaluation harness using logged queries and actual click positions rather than the offline set. It showed the new model won on paraphrase and lost badly on exact-name lookup, which was 70% of real traffic. Proposed routing by query shape instead of picking a winner.',
    outcome:
      'Kept both. Exact-name queries route to the lexical index, everything else to embeddings. Click-through recovered and passed the old baseline.',
    stack: ['Python', 'OpenSearch', 'pgvector'],
  },
];

/** §5 item 4 — included only where it adds what the projects don't convey. */
export const experience: readonly Role[] = [
  {
    period: '2026 — Now',
    title: 'Freelancer/Consultant',
    org: 'Personal',
    note: 'Own the build and deploy path for ~40 engineers. Most of my week is other people’s unblocking.',
  },
  {
    period: '2023 — 2026',
    title: 'Senior Software Engineer',
    org: 'Yulista Tactical Services',
    note: 'Payments ledger and reconciliation. Where I learned to distrust averages.',
  },
  {
    period: '2020 — 2021',
    title: 'Low Code Developer',
    org: 'Skillstorm',
    note: 'Early-stage, small team, wore every hat — including the ones I was bad at.',
  },
  {
    period: '2020 — 2021',
    title: 'Software Developer',
    org: 'Red Meters',
    note: 'Geospatial tiling. First encounter with a query planner that outsmarted me.',
  },
];

/** §5 item 5 — direct, minimal friction. No form backend on a static site. */
export const contact = {
  lead: 'The fastest way to reach me is email. I read everything and reply to most things within a couple of days.',
  note: 'Best for: staff/principal IC roles, performance or build-system consulting, or telling me I am wrong about something on this page.',
} as const;

/** §4.6 — the "view source" affordance's copy, shared across sections. */
export const inspectorCta = {
  label: 'View the code behind this section',
  hint: 'Opens the AST node this section is generated from',
} as const;
