/**
 * UI takes priority over node picking.
 *
 * The Canvas uses `eventSource={document.body}` (see SceneCanvas), which is what lets
 * the scene receive pointer events even though the fixed content layer sits above it at
 * a higher z-index. The cost is that R3F raycasts on EVERY pointer event anywhere in the
 * document — including events that landed on a button, a link, or an open panel. Without
 * a guard, clicking "next section" or a settings toggle also selects whatever AST node
 * happened to be behind it.
 *
 * Reversing the layering instead (`pointer-events: none` on the content layer) is not an
 * option: the §5.1 escape hatch walks up from `event.target` to find the scrollable
 * item, and it can only do that if the item is still a real event target.
 *
 * So the rule is narrow and explicit: events that land on interactive chrome are chrome
 * events, and the scene ignores them. Everything else — the empty space around the text,
 * the scrim, the item background — still reaches the nodes.
 */

/**
 * `[data-ui]` marks a whole subtree as chrome; the rest catch individual controls
 * wherever they appear, including inside prose.
 */
const UI_SELECTOR = [
  '[data-ui]',
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'kbd',
  '[role="button"]',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="dialog"]',
  '[contenteditable="true"]',
].join(',');

/**
 * True when the event landed on interactive chrome and the scene should ignore it.
 *
 * Takes the native event rather than the R3F synthetic one, because only the native
 * event knows which DOM element was actually under the pointer.
 */
export function isUiTarget(event: { target: EventTarget | null } | null | undefined): boolean {
  const target = event?.target;
  if (!(target instanceof Element)) return false;
  return target.closest(UI_SELECTOR) !== null;
}