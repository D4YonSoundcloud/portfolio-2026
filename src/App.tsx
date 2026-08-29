import type { ReactNode } from 'react';

import { ThemeProvider } from './design/ThemeProvider.tsx';
import { SceneCanvas } from './scene/SceneCanvas.tsx';
import { FocusTrack } from './navigation/FocusTrack.tsx';
import { DotNav } from './navigation/DotNav.tsx';
import { SettingsCluster } from './navigation/SettingsCluster.tsx';
import { NavButtons } from './navigation/NavButtons.tsx';
import { ExploreToggle } from './navigation/ExploreToggle.tsx';
import { CodeInspectorPanel } from './inspector/CodeInspectorPanel.tsx';
import { useSceneStore } from './store/sceneStore.ts';

import { Hero } from './sections/Hero.tsx';
import { About } from './sections/About.tsx';
import { Projects } from './sections/Projects.tsx';
import { Experience } from './sections/Experience.tsx';
import { Contact } from './sections/Contact.tsx';

import './styles/global.css';

/**
 * §3 — Architecture.
 *
 * Two independent render trees:
 *   - <SceneCanvas>  the R3F scene graph, z-index 0, aria-hidden, decorative
 *   - <FocusTrack>   the fixed-viewport HTML content layer, z-index 1
 *
 * They share state exclusively through the Zustand store — never through prop drilling
 * or Context across the Canvas boundary.
 *
 * The order matters: the content layer mounts and paints without waiting on the scene
 * chunk (§4.7), and the section children below are all in the DOM at all times, which is
 * what keeps them crawlable (§5.3, §10).
 */
export function App(): ReactNode {
  const exploring = useSceneStore((s) => s.interactionMode === 'explore');

  return (
    <ThemeProvider>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <SceneCanvas />

      {/*
        Explore mode hides the content layer so the visitor can actually see what they
        are flying through — the fixed track covers most of the viewport, and navigating
        behind a wall of text is pointless.

        `hidden` rather than unmounting, for two reasons. The sections must stay in the
        DOM to remain crawlable (§5.3, §10), and unmounting would discard scroll
        positions and in-progress state for the sake of a mode most visitors will leave
        within seconds. `hidden` also removes the subtree from the accessibility tree and
        from hit-testing, so it cannot swallow pointer events aimed at the scene.
      */}
      <main id="content" hidden={exploring}>
        <FocusTrack>
          {[
            <Hero key="hero" />,
            <About key="about" />,
            <Experience key="experience" />,
            <Projects key="projects" />,
            <Contact key="contact" />,
          ]}
        </FocusTrack>
      </main>

      {/* The carousel dots address sections that are not on screen while exploring. */}
      {exploring ? null : <DotNav />}
      <SettingsCluster />

      {/* Touch equivalents for the two wheel gestures (§8.2). */}
      <NavButtons />
      <ExploreToggle />

      <CodeInspectorPanel />
    </ThemeProvider>
  );
}