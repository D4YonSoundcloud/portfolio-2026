import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  SCENE_DEFAULTS,
  readPath,
  useSceneConfig,
  type SharedPath,
  type ThemedPath,
} from '../scene/sceneConfig.ts';
import { useSceneStore, type Quality } from '../store/sceneStore.ts';
import { SHARED_FIELDS, THEMED_FIELDS, TOKEN_FIELDS, type FieldMeta, type TokenField } from './fields.ts';
import { EnvPreview } from './EnvPreview.tsx';
import { rehydrateEditor, useEditorStore } from './editorStore.ts';
import { exportAll, hasChanges } from './exportOverrides.ts';
import styles from './SceneEditor.module.css';

/**
 * The scene editor panel.
 *
 * EDITOR ONLY — mounted from `mountEditor.tsx`, which `main.tsx` only reaches when
 * `__SCENE_EDITOR__` is true.
 *
 * ── Generated, not hand-built ────────────────────────────────────────────────────────
 * Every control here comes from the metadata in `fields.ts`. There is no per-knob JSX,
 * which is what makes adding a tunable a two-line change (a field on `SceneConfig`, a
 * description in `fields.ts`) rather than a UI task. It is also why the panel cannot
 * silently omit a knob: the metadata records are typed as exhaustive.
 *
 * ── Interactions with the rest of the app ────────────────────────────────────────────
 * Three things about this codebase would otherwise make the panel misbehave, and each is
 * handled explicitly below:
 *
 *   1. `data-ui` — the Canvas uses `eventSource={document.body}`, so without this marker
 *      every slider drag would raycast into the scene and dragging over the panel would
 *      select whatever node sits behind it (see `scene/pointerGuard.ts`).
 *   2. Reduced motion — `SceneCanvas` drops the live canvas entirely under
 *      `prefers-reduced-motion`. With that OS setting on there would be no scene to tune,
 *      so the panel offers an override.
 *   3. `PerformanceMonitor` — it mutates `quality` on its own schedule, which makes
 *      deliberately inspecting a tier impossible. The panel can pin it.
 */

export function SceneEditor(): ReactNode {
  const config = useSceneConfig();
  const theme = useSceneStore((s) => s.resolvedTheme);

  const overrides = useEditorStore((s) => s.overrides);
  const tokens = useEditorStore((s) => s.tokens);
  const open = useEditorStore((s) => s.open);
  const setOpen = useEditorStore((s) => s.setOpen);
  const resetAll = useEditorStore((s) => s.resetAll);

  // Replay the persisted session, and re-apply on theme change so the inline token
  // block on <html> always belongs to the theme actually being displayed.
  useEffect(() => {
    rehydrateEditor(theme);
  }, [theme]);

  // Ctrl/Cmd + Shift + E. Chosen to not collide with anything the site itself binds.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setOpen(!useEditorStore.getState().open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  const dirty = hasChanges(overrides, tokens);

  if (!open) {
    return (
      <button type="button" className={styles.reopen} data-ui onClick={() => setOpen(true)}>
        scene{dirty ? ' •' : ''}
      </button>
    );
  }

  return (
    // `data-ui` marks the whole subtree as chrome — see note (1) above.
    <aside className={styles.panel} data-ui aria-label="Scene editor">
      <header className={styles.header}>
        <h2 className={styles.title}>
          Scene editor
          <span className={styles.themeTag}>{theme}</span>
        </h2>
        <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} title="Hide (Ctrl+Shift+E)">
          ×
        </button>
      </header>

      <SceneOverrideControls />

      <div className={styles.scroll}>
        {/* First, because the Environment controls below are close to unusable without
            it — you cannot tune a pattern you can only see reflected off rough glass. */}
        

        <TokenSection theme={theme} />

        <FieldSection
          title="Themed"
          note={`Applies to the ${theme} design only.`}
          fields={THEMED_FIELDS}
          resolve={(path) => readPath(config.themed[theme], path)}
          fallback={(path) => readPath(SCENE_DEFAULTS.themed[theme], path)}
          isOverridden={(path) => path in overrides.themed[theme]}
          onChange={(path, value) =>
            useEditorStore.getState().setThemedValue(theme, path as ThemedPath, value)
          }
          onReset={(path) => useEditorStore.getState().resetField(theme, path as ThemedPath, 'themed')}
        />

        <EnvPreview />

        <FieldSection
          title="Shared"
          note="Applies to both themes."
          fields={SHARED_FIELDS}
          resolve={(path) => readPath(config.shared, path)}
          fallback={(path) => readPath(SCENE_DEFAULTS.shared, path)}
          isOverridden={(path) => path in overrides.shared}
          onChange={(path, value) => useEditorStore.getState().setSharedValue(path as SharedPath, value)}
          onReset={(path) => useEditorStore.getState().resetField(theme, path as SharedPath, 'shared')}
        />
      </div>

      <footer className={styles.footer}>
        <ExportButton disabled={!dirty} />
        <button type="button" className={styles.button} onClick={resetAll} disabled={!dirty}>
          Reset all
        </button>
      </footer>
    </aside>
  );
}

/* ── Scene overrides ────────────────────────────────────────────────────────────────
 * Not tunable VALUES — switches that make the scene inspectable at all. See notes (2)
 * and (3) at the top of the file.
 */

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

function SceneOverrideControls(): ReactNode {
  const reducedMotion = useSceneStore((s) => s.reducedMotion);
  const setReducedMotion = useSceneStore((s) => s.setReducedMotion);
  const quality = useSceneStore((s) => s.quality);
  const setQuality = useSceneStore((s) => s.setQuality);
  const qualityPinned = useSceneStore((s) => s.qualityPinned);
  const setQualityPinned = useSceneStore((s) => s.setQualityPinned);

  return (
    <div className={styles.overrides}>
      {reducedMotion ? (
        <button type="button" className={styles.warning} onClick={() => setReducedMotion(false)}>
          Reduced motion is on — the live canvas is disabled. Click to override.
        </button>
      ) : null}

      <div className={styles.row}>
        <span className={styles.rowLabel}>Quality</span>
        <div className={styles.segments}>
          {QUALITIES.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.segment}
              aria-pressed={quality === value}
              onClick={() => {
                setQualityPinned(true);
                setQuality(value);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <label className={styles.pin}>
          <input
            type="checkbox"
            checked={qualityPinned}
            onChange={(event) => setQualityPinned(event.target.checked)}
          />
          pin
        </label>
      </div>
    </div>
  );
}

/* ── Generated control sections ─────────────────────────────────────────────────────*/

interface FieldSectionProps {
  title: string;
  note: string;
  fields: Record<string, FieldMeta>;
  resolve: (path: string) => number | undefined;
  fallback: (path: string) => number | undefined;
  isOverridden: (path: string) => boolean;
  onChange: (path: string, value: number) => void;
  onReset: (path: string) => void;
}

function FieldSection({
  title,
  note,
  fields,
  resolve,
  fallback,
  isOverridden,
  onChange,
  onReset,
}: FieldSectionProps): ReactNode {
  // Group order follows first appearance in the metadata, so the panel's layout is
  // controlled by how `fields.ts` is written rather than by alphabetical accident.
  const groups = useMemo(() => {
    const map = new Map<string, [string, FieldMeta][]>();
    for (const entry of Object.entries(fields)) {
      const list = map.get(entry[1].group) ?? [];
      list.push(entry);
      map.set(entry[1].group, list);
    }
    return [...map.entries()];
  }, [fields]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
        <span className={styles.sectionNote}>{note}</span>
      </h3>

      {groups.map(([group, entries]) => (
        <Group key={`${title}:${group}`} name={group} id={`${title}:${group}`}>
          {entries.map(([path, meta]) => (
            <NumberControl
              key={path}
              meta={meta}
              value={resolve(path) ?? fallback(path) ?? 0}
              overridden={isOverridden(path)}
              onChange={(value) => onChange(path, value)}
              onReset={() => onReset(path)}
            />
          ))}
        </Group>
      ))}
    </section>
  );
}

function TokenSection({ theme }: { theme: 'dark' | 'light' }): ReactNode {
  const tokens = useEditorStore((s) => s.tokens);
  const setToken = useEditorStore((s) => s.setToken);
  const resetToken = useEditorStore((s) => s.resetToken);

  // Current values come from the cascade, not from the override map: a token the editor
  // has not touched still needs its real value from `tokens.css`. Re-read on theme
  // change, and whenever an override lands.
  const [computed, setComputed] = useState<Record<string, string>>({});
  useEffect(() => {
    const styleMap = window.getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const field of TOKEN_FIELDS) next[field.cssVar] = styleMap.getPropertyValue(field.cssVar).trim();
    setComputed(next);
  }, [theme, tokens]);

  const groups = useMemo(() => {
    const map = new Map<string, TokenField[]>();
    for (const field of TOKEN_FIELDS) {
      const list = map.get(field.group) ?? [];
      list.push(field);
      map.set(field.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        Design tokens
        <span className={styles.sectionNote}>Exports to tokens.css. Per theme.</span>
      </h3>

      {groups.map(([group, fields]) => (
        <Group key={`token:${group}`} name={group} id={`token:${group}`}>
          {fields.map((field) => {
            const value = tokens[theme][field.cssVar] ?? computed[field.cssVar] ?? '';
            const overridden = field.cssVar in tokens[theme];

            return field.kind === 'color' ? (
              <ColorControl
                key={field.cssVar}
                field={field}
                value={value}
                overridden={overridden}
                onChange={(next) => setToken(theme, field.cssVar, next)}
                onReset={() => resetToken(theme, field.cssVar)}
              />
            ) : (
              <NumberControl
                key={field.cssVar}
                meta={{
                  label: field.label,
                  group: field.group,
                  min: field.min ?? 0,
                  max: field.max ?? 1,
                  step: field.step ?? 0.01,
                  hint: field.hint,
                }}
                value={Number.parseFloat(value) || 0}
                overridden={overridden}
                onChange={(next) => setToken(theme, field.cssVar, String(next))}
                onReset={() => resetToken(theme, field.cssVar)}
              />
            );
          })}
        </Group>
      ))}
    </section>
  );
}

/* ── Primitives ─────────────────────────────────────────────────────────────────────*/

function Group({ name, id, children }: { name: string; id: string; children: ReactNode }): ReactNode {
  const collapsed = useEditorStore((s) => s.collapsed[id] ?? false);
  const toggleGroup = useEditorStore((s) => s.toggleGroup);

  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupHeader} onClick={() => toggleGroup(id)} aria-expanded={!collapsed}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        {name}
      </button>
      {collapsed ? null : <div className={styles.groupBody}>{children}</div>}
    </div>
  );
}

interface NumberControlProps {
  meta: FieldMeta;
  value: number;
  overridden: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}

/**
 * A slider paired with a number input.
 *
 * Both, not one: the slider is for exploring — you find the right value by dragging past
 * it and coming back — and the number input is for the last two decimal places, and for
 * typing a value outside the slider's range when the range guessed wrong.
 */
function NumberControl({ meta, value, overridden, onChange, onReset }: NumberControlProps): ReactNode {
  return (
    <div className={styles.control} data-overridden={overridden || undefined}>
      <label className={styles.label} title={meta.hint}>
        {meta.label}
        {overridden ? (
          <button type="button" className={styles.revert} onClick={onReset} title="Revert to default">
            ↺
          </button>
        ) : null}
      </label>

      <input
        type="range"
        className={styles.range}
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={meta.label}
      />

      <input
        type="number"
        className={styles.number}
        step={meta.step}
        value={Number(value.toFixed(4))}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        aria-label={`${meta.label} value`}
      />
    </div>
  );
}

interface ColorControlProps {
  field: TokenField;
  value: string;
  overridden: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}

function ColorControl({ field, value, overridden, onChange, onReset }: ColorControlProps): ReactNode {
  // <input type="color"> only accepts #rrggbb. Tokens are authored as hex, but a
  // computed value that came through `color-mix` or a named colour would not be, so
  // fall back rather than letting React warn on every render.
  const swatch = /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888';

  return (
    <div className={styles.control} data-overridden={overridden || undefined}>
      <label className={styles.label} title={field.hint}>
        {field.label}
        {overridden ? (
          <button type="button" className={styles.revert} onClick={onReset} title="Revert to default">
            ↺
          </button>
        ) : null}
      </label>

      <input
        type="color"
        className={styles.color}
        value={swatch}
        onChange={(event) => onChange(event.target.value)}
        aria-label={field.label}
      />

      <input
        type="text"
        className={styles.hex}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${field.label} value`}
        spellCheck={false}
      />
    </div>
  );
}

/**
 * Copies both export blocks to the clipboard.
 *
 * Also logs them, because the clipboard API is unavailable on an insecure origin — which
 * `npm run dev` over a LAN address is, and that is exactly when you are tuning on a
 * phone and least able to read a toast.
 */
function ExportButton({ disabled }: { disabled: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={styles.primary}
      disabled={disabled}
      onClick={() => {
        const { overrides, tokens } = useEditorStore.getState();
        const text = exportAll(overrides, tokens, useSceneStore.getState().resolvedTheme);

        console.info('[scene editor] export\n\n%s', text);
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied' : 'Export'}
    </button>
  );
}