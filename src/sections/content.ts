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
  statement: 'Helping make peoples lives easier, by building software they need.',
  heroSupport:
    '6 years on data-heavy products, from front-end to back-end, and everything in between, if I havent heard of it, I would love to learn about it.',
  location: 'Orlando, FL, USA',
  email: 'mattd4y@gmail.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/D4YonSoundcloud/portfolio-2026' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/matthew-day-developer/' },
  ],
} as const;

/** §5 item 2 — brief, human, not a résumé restated in prose. */
export const about = {
  paragraphs: [
    'I like the part of the job where you read something carefully enough that the fix turns out to be small. A lot of the work I am proud of removed code rather than adding it.',
    'Lately I have been working on Developer Tooling, LLM Integration + Pipeline Development, and (trying) to keep up with the newest advances in AI.',
    'Outside work I am very active, with more hobbies than I can count. Currently I have been learning the rope dart/meteor hammer.',
  ],
  /** Small factual asides — the kind of detail that reads as specific rather than styled. */
  asides: [
    { key: 'Currently', value: 'Senior Engineer, Consultant' },
    { key: 'Based in', value: profile.location },
    { key: 'Working in', value: 'TypeScript, React, Node + many more' },
    { key: 'Open to', value: 'Mid/Senior Level IC roles + Consultancing' },
  ],
} as const;

/** §5 item 3 — real specifics. Problem, constraints, decisions, outcome. */
export const projects: readonly Project[] = [
  {
    name: 'Ember',
    context: 'Red Meters on-device GUI for viewing live sensor data from the Red Meter itself.',
    problem:
      'The Red Meter streams real-time sensor data from an onboard Raspberry Pi 3B. As its front-end engineer, I had to make that raw telemetry readable and trustworthy.',
    constraint:
      'The GUI had to run reliably on the Pi 3B' + 's limited memory. Real-time visuals couldn' + 't lag, drop frames, or crash, staying clear enough to read at a glance.',
    decision:
      'Built the front-end in Vue 2.6, with D3.js visualizations tuned to the memory ceiling. Added automated QA and build/test systems, plus a procedurally generated, animated 3D model of the device in Three.js for the company' + 's marketing site.',
    outcome:
      'A stable, field-ready GUI — my first engineering role.',
    stack: ['Vue', 'D3', 'Python'],
  },
  {
    name: 'T.R.I.D.E.N.T',
    context: 'Large Excel Sheet custom made UI with by-cell context aware LLM usage. 50,000+ Cells.',
    problem:
      'Used in the U.S. Military RRL process: workshops where experts manually work through this Excel file, typing values by hand — 10-30 minutes per cell.',
    constraint:
      'Speed mattered, but accuracy was the real constraint — the program would be useless if users had to rework every single answer the LLM gave.',
    decision:
      'Dedicated software, web front-end, hosted back-end, both on Azure GOV-HIGH, plus a Vector Database populated with all approved answers from the company' + 's past contracts — grounding every suggestion in real precedent.',
    outcome: '2 week workshops, condensed to 1-2 days.',
    stack: ['React', 'Python', 'SQlite'],
  },
  {
    name: 'Coaster Clash 2k99',
    context: 'Rollercoaster Tower Defense — solo-built and self-published on Steam in July of 2025.',
    problem:
      'No engine or genre existed for a "rollercoaster tower defense" game. Tracks doubling as transport and attack lanes had never been built before, in any engine.',
    constraint:
      'No engine or genre existed for a "rollercoaster tower defense" game. Tracks doubling as transport and attack lanes had never been built before, in any engine.',
    decision:
      'Built a custom engine in Three.js with a Vue 3 front-end, handling rendering, game state, and pathing. CatmullRom splines drove real-time editable tracks and banking, GPU SIMD powered terrain generation, and custom collision.',
    outcome:
      'Shipped on Steam, July 2025 — genre-first.',
    stack: ['Typescript', 'ThreeJs', 'Vue', 'Tauri'],
  },
];

/** §5 item 4 — included only where it adds what the projects don't convey. */
export const experience: readonly Role[] = [
  {
    period: '2026 — Now',
    title: 'Freelancer/Consultant',
    org: 'Personal',
    note: 'Helping people create or understand the software they did not think was even possible.',
  },
  {
    period: '2023 — 2026',
    title: 'Senior Software Engineer',
    org: 'Yulista Tactical Services',
    note: 'Mentored, architected, developed, and deployed. Custom LLM Integration.',
  },
  {
    period: '2020 — 2021',
    title: 'Low Code Developer',
    org: 'Skillstorm',
    note: 'Certified Senior Appian Developer. Worked with PwC, Vision Point Systems, and Appian themselves.',
  },
  {
    period: '2020 — 2021',
    title: 'Software Developer',
    org: 'Red Meters',
    note: 'Data visualization and working in performance constrained enviroments.',
  },
];

/** §5 item 5 — direct, minimal friction. No form backend on a static site. */
export const contact = {
  lead: 'The fastest way to reach me is email. I read everything and reply to most things within a couple of days.',
  note: 'Best for: mid/senior IC roles, performance or build-system consulting, or telling me about some interesting tech.',
} as const;

/** §4.6 — the "view source" affordance's copy, shared across sections. */
export const inspectorCta = {
  label: 'View the code behind this section',
  hint: 'Opens the AST node this section is generated from',
} as const;
