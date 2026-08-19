# Portfolio — AST scene

A single-page portfolio whose background is a live 3D rendering of **its own syntax
tree**. The site parses its own source at build time, lays the tree out with a force
simulation, and flies the camera through it as you move between sections.

Built to [`portfolio-technical-design.md`](./portfolio-technical-design.md). Section
references throughout the code (`§4.3`, `§8.2`) point back at that document — if you
change behaviour, update the reference or delete it rather than leaving it lying.

---

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

`predev` generates the AST graph first, so the scene has something to render. It takes
about 10 seconds on first run.

```bash
npm run build        # generate → typecheck → bundle → prerender
npm run preview      # serve dist/ exactly as it will deploy
```

**Open the project in VS Code** and install the recommended extensions when prompted
(`.vscode/extensions.json`) — ESLint and Prettier are the ones that matter.

---

## The one thing that will bite you: `base`

GitHub Pages serves a project repo at `https://<user>.github.io/<repo>/`. Vite's `base`
must match, or **every asset silently 404s and you get a blank page** — no build error,
no console clue until you look at the network tab.

| Your setup | `BASE_PATH` |
|---|---|
| Project repo, default URL | `/<repo>/` |
| Custom domain (CNAME in `public/`) | `/` |
| `<user>.github.io` user/org-page repo | `/` |

The deploy workflow derives this automatically from `actions/configure-pages`, so renaming
the repo keeps working. You only need to intervene for a custom domain — set
`BASE_PATH: /` in `.github/workflows/deploy.yml`.

To reproduce a subpath deploy locally:

```bash
BASE_PATH=/my-repo/ npm run build && npm run preview
```

One reference is **not** rewritten for you: `og:image` and `og:url` in `index.html`.
Vite's base rewriting applies to `src`/`href`, not to `<meta content>`, and Open Graph
crawlers don't resolve relative paths anyway. Both must be absolute URLs.

---

## Editing the content

**All copy lives in [`src/sections/content.ts`](./src/sections/content.ts).** Nothing in
there is real — the persona and case studies are placeholders written to the shape §5
asks for so you can see how the layout behaves under realistic text. Replace the values,
keep the structure.

The case studies are deliberately `problem → constraint → decision → outcome` rather than
tech-stack badges. If a project doesn't have a real constraint worth naming, it's probably
not the project to lead with.

`src/sections/sections.ts` maps each section to a **source directory**, which is what the
camera flies to. That mapping is structural, not decorative — see below.

---

## How the AST pipeline works

Four stages, `extract → transform → layout → render`. The first three run in Node at
build time; the browser only ever does the fourth.

```
src/**/*.{ts,tsx}
   │  ts.createSourceFile + forEachChild          §4.1  extract
   ▼
raw nodes  →  categorized, pruned to budget       §4.2  transform
   │  d3-force-3d, 300 ticks, fixed seed          §4.3  layout
   ▼
public/ast-graph.json     (positions + character ranges baked in)
public/source-index.json  (per-file text + numeric token stream)
   │  fetch + Zod validate
   ▼
InstancedMesh per category + one LineSegments     §4.4  render
```

Two things worth knowing:

**Positions are baked, never simulated at runtime.** The force layout runs once, at build
time, with a fixed PRNG seed — so the same source always produces the same scene, and a
visual change is always a real change rather than simulation noise.

**Section → camera target is a real structural fact.** Each section names a directory;
its camera target is the centroid of every AST node generated from that directory. Add a
file to `src/scene/` and the Projects camera target moves on its own. Nobody hand-placed
a waypoint.

Regenerate manually with `npm run generate:ast`. The output is gitignored, so a stale
graph can never ship.

**The inspector shows a character range, not a stored snippet.**

Version 1 of the pipeline stored pre-highlighted HTML per node. That was redundant twice
over — a parent's snippet already contains every one of its children's, so the same lines
were highlighted once per level of depth, and every token carried its own
`<span style="--shiki-light:…;--shiki-dark:…">` wrapper. It also forced a depth cutoff,
below which nodes had no source of their own and aliased to an ancestor's.

Now each file's text is stored **once**, alongside a flat numeric token stream —
`[offset, length, paletteIndex, …]` against a 31-entry palette. Every node carries
absolute character offsets (`loc.start` / `loc.end`), so a node is just a range into its
own file. Every node at every depth gets its own exact source; the depth cutoff and the
alias map are both gone.

| | raw | gzipped |
|---|---|---|
| v1 — HTML snippet per node | 4.02 MB | 149 KB |
| v2 — token stream per file | **0.50 MB** | 186 KB |

Note the honest trade: **transfer got slightly worse.** Gzip is very good at crushing
repeated HTML, and numeric streams compress less well. The win is `JSON.parse` cost and
memory on low-end devices — 8× less to parse on first inspector open — not bandwidth. If
that ever inverts as a priority, the lever is dropping source text for files no visible
node references.

Two properties worth preserving if you touch this:

- **Shiki token offsets are absolute** indices into the file, not per-line. The whole
  design rests on it, so `sourceIndex.ts` round-trips the stream against the source and
  fails the build if that ever changes, and a unit test asserts it against the artifact.
- **Nothing goes through `dangerouslySetInnerHTML` any more.** The panel renders segments
  as React elements, so escaping is the renderer's job rather than the build step's.

### The source-scope constraint

The pipeline is hardcoded to this repository's own `src/`. It accepts no external path,
no repo URL, no reference to the proprietary codebases behind the projects you describe.
Those are described in prose you write, never through parsed source.

`npm run check:ast-scope` enforces this in CI: it fails the build if the scope constants
are widened, or if the generator ever starts reading `process.argv`, an environment path,
a URL, or shelling out. It's the first step in both workflows, because if it fails
nothing else matters.

---

## Architecture

Two independent render trees that never touch:

```
<SceneCanvas>   R3F scene graph      z-index 0   aria-hidden, decorative
<FocusTrack>    HTML content layer   z-index 1   all real information
        └──────── Zustand store ────────┘
```

They share state **only** through `src/store/sceneStore.ts`. React Context doesn't
reliably span the `<Canvas>` boundary, and coupling the trees directly makes either one
hard to test alone.

The store is deliberately small — it's a coordination layer, not app state. Content stays
as static local data and never enters it.

### The synced transition

`focusedIndex` changes once. Two springs read it:

- `FocusTrack` → `@react-spring/web` → DOM `translate3d`
- `CameraRig` → `@react-spring/three` → camera position

They share one config (`FOCUS_SPRING`, exported from `FocusTrack.tsx`). **If you retune
one, retune the other** — they desync silently, and it reads as two animations that
happen to run at once rather than one motion.

---

## Navigation

There's no document scroll. `<body>` is fixed and `overflow: hidden`; focus items move.

Four input paths all converge on `setFocusedIndex`, and all four must land on the same
index — that's what the e2e suite asserts:

| Input | Where |
|---|---|
| Wheel | `useFocusNav` — delta accumulation, threshold, cooldown lock |
| Touch | `useFocusNav` — distance/velocity threshold + axis locking |
| Keyboard | `useFocusNav` — arrows follow orientation, plus `Home`/`End` |
| Dot-nav | `DotNav` — direct, never routes through gesture capture |

**The escape hatch is a correctness requirement, not polish.** If a focus item's content
is taller than the viewport, wheel/touch over it scrolls *that* first; only at its own
top/bottom edge does the next input advance the carousel. Without this, Projects becomes
unreadable. `findScrollableAncestor` implements it; don't "simplify" it away.

**Axis locking** (`§8.2`) is the mobile counterpart: a touch tracks both axes from frame
one, so once movement crosses a threshold in one axis, the gesture commits to that axis
for its whole duration rather than re-deciding every frame.

---

## Theming

Dark and light are **two designs**, not one palette inverted:

- **Dark** — near-black ground, emissive nodes, bloom pass. "Code at night."
- **Light** — blueprint/schematic paper, ink linework, no bloom (it reads as a rendering
  bug on a bright ground). Nodes shrink, edges carry more weight.

One source of truth: `src/design/tokens.css`. The DOM reads the custom properties
directly; `src/scene/palette.ts` reads *the same properties* via `getComputedStyle` for
the R3F materials. **Never write a colour in TypeScript** — that's how two palettes drift
apart.

Theme resolves in a blocking inline script in `index.html` before first paint, because
the HTML is prerendered and waiting for hydration would flash the wrong theme. That
script mirrors `THEME_INIT_SCRIPT` in `ThemeProvider.tsx` — **change both together.**

---

## Performance and fallbacks

The scene is decorative. Every degradation path leaves the site fully usable.

- Canvas is code-split behind `React.lazy`; Three.js and R3F never block first paint
- A poster frame shows immediately and crossfades out when the live scene mounts
- `prefers-reduced-motion` → static poster only, `transitionMode: 'off'`
- No WebGL → poster only
- `quality` seeds from a boot heuristic (viewport, `hardwareConcurrency`, pointer type)
  and `PerformanceMonitor` tunes *upward* — mobile starts low rather than downgrading
  after a janky first few seconds
- `low` tier skips postprocessing entirely; node cap drops from 2600 to 900

Current chunk sizes (gzipped): entry 81 KB, R3F 138 KB, Three.js 190 KB.

`source-index.json` is 500 KB uncompressed and parsed once, on first inspector open. If
it ever shows up in profiling, the next levers are omitting source text for files no
visible node references, or splitting the index per source directory.

---

## Testing

```bash
npm run typecheck
npm run lint
npm test              # Vitest — 23 tests
npm run test:e2e      # Playwright (needs: npx playwright install chromium)
```

Unit tests (61) cover store invariants, the `SyntaxKind` mapping, and validation of the
generated artifacts — including that no file outside `src/` ever appears in the graph,
that every node's character range lies inside its own file, and that Shiki's token
offsets still index the source correctly. `renderTokens.test.ts` covers the snippet
renderer directly: boundary splitting, windowing, and dedent.

E2E covers the four navigation paths, the overflow escape hatch, prerendered content,
`aria-hidden` on the canvas, inspector focus handling, and theme persistence. It runs on
desktop **and** a mobile project, because axis locking passes a desktop-only suite while
feeling wrong on a real device.

> Emulation is not a real phone. §13 step 8 asks for cross-browser QA on actual devices
> before shipping, and that still stands.

---

## Deviations from the design document

Four, all forced or explicitly permitted:

1. **`@react-spring/*` v10, not v9.** v9 doesn't support React 19 — `npm install` fails
   outright on the peer range. v10 does. The rest of §2's stack is as specified.
2. **`vite-plugin-ssg` doesn't exist on npm.** (`vite-ssg` does, and is a different
   thing.) §10 permits "a minimal custom prerender step", so `scripts/prerender.ts` does
   it in ~40 lines with no extra dependency. There's one route, so there's little to a
   general solution here.
3. **Only Departure Mono is bundled.** Commit Mono and Inter aren't freely
   redistributable from a build script, so the `@font-face` stacks degrade to system
   faces. See below.
4. **Layout and snippet generation are separate modules** (`layout.ts`, `snippets.ts`)
   rather than living inside `generate-ast-graph.ts` as §12 implies. They're genuinely
   separate concerns and `layout.ts` is unit-testable in isolation.

### Fonts

Departure Mono (label face) is bundled — `public/fonts/`, OFL, license included, 22 KB.

The other two are optional. To add them, drop the `.woff2` files in `public/fonts/` and
add the `@font-face` blocks to `tokens.css`; the stacks already name them first:

- **Commit Mono** (code snippets) — <https://commitmono.com>
- **Inter** (body) — <https://rsms.me/inter/>

Without them you get system mono and system sans, which is fine. §7.1's point stands
either way: the personality budget goes to the label face and the scene, not the code.

---

## Still open

From §14, plus what surfaced while building:

- **Tuning is guesswork until you feel it.** Wheel threshold (90), cooldown (150 ms),
  spring config (tension 170 / friction 26), swipe distance (56 px) are reasonable
  defaults, not tuned values. All are named constants at the top of their modules.
- **The light theme's linework is the least-proven part.** It's implemented as a genuine
  second treatment, but §14 is right that it wants prototyping against real content
  rather than trusting the token swap.
- **The poster frame is a schematic SVG, not a real render.** ~1 KB, scales, and follows
  the theme — but it isn't your actual scene. Swap in a real screenshot for fidelity,
  and generate a mobile-sized variant if you do (§8.3).
- **Default `transitionMode: 'horizontal'`** — worth confirming against the real carousel
  now that one exists, given the scene already has plenty of Z movement.
- **Dot-nav orientation** flips to oppose the carousel axis. Pinned by a test so changing
  it is deliberate.
- **Mobile quality tiers** may want device-specific values rather than one conservative
  default. Only answerable on real hardware.
- **No per-PR previews.** Live without it first; add a `gh-pages/pr-<number>/` workflow
  only if reviewing scene changes on a live URL turns out to be genuinely missed.

---

## Project layout

```
src/
  ast-pipeline/    build-time: extract, categorize, layout, snippets, schema
  scene/           R3F tree — instanced nodes, batched edges, camera, tooltip
  navigation/      focus carousel: gesture capture, track, dot-nav, settings
  inspector/       code inspector panel + snippet loader
  sections/        content.ts (edit this), section registry, five sections
  design/          tokens.css (single source of truth), ThemeProvider
  store/           Zustand coordination layer
scripts/           prerender, AST scope check
tests/unit         Vitest
tests/e2e          Playwright
```
