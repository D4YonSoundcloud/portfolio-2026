import type { ReactNode } from 'react';

import { ThemeProvider } from './design/ThemeProvider.tsx';
import { SceneCanvas } from './scene/SceneCanvas.tsx';
import { FocusTrack } from './navigation/FocusTrack.tsx';
import { DotNav } from './navigation/DotNav.tsx';
import { SettingsCluster } from './navigation/SettingsCluster.tsx';
import { CodeInspectorPanel } from './inspector/CodeInspectorPanel.tsx';

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
  return (
    <ThemeProvider>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <SceneCanvas />

      <main id="content">
        <FocusTrack>
          {[
            <Hero key="hero" />,
            <About key="about" />,
            <Projects key="projects" />,
            <Experience key="experience" />,
            <Contact key="contact" />,
          ]}
        </FocusTrack>
      </main>

      <DotNav />
      <SettingsCluster />
      <CodeInspectorPanel />
    </ThemeProvider>
  );
}
