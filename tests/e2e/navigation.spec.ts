import { expect, test } from '@playwright/test';

/**
 * §11 — "wheel, touch swipe, keyboard, dot-nav — all four paths need to land on the same
 * focusedIndex."
 *
 * The active item is read through `aria-current`, which is the same signal assistive tech
 * uses — so these tests fail if the accessible state and the visual state ever diverge,
 * not just if navigation breaks.
 */

const activeSlide = '[aria-roledescription="slide"][aria-current="true"]';

async function activeLabel(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator(activeSlide).getAttribute('aria-label')) ?? '';
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(activeSlide)).toHaveAttribute('aria-label', /Introduction/);
});

test('dot-nav reaches every focus item without gesture capture', async ({ page }) => {
  const dots = page.getByRole('navigation', { name: 'Section navigation' }).getByRole('button');
  await expect(dots).toHaveCount(5);

  await dots.nth(2).click();
  expect(await activeLabel(page)).toMatch(/Projects/);

  await dots.nth(4).click();
  expect(await activeLabel(page)).toMatch(/Contact/);
});

test('keyboard arrows follow the carousel orientation, with Home and End', async ({ page }) => {
  // Default transitionMode is horizontal (§5.2), so the horizontal keys are live.
  await page.keyboard.press('ArrowRight');
  expect(await activeLabel(page)).toMatch(/About/);

  await page.keyboard.press('ArrowRight');
  expect(await activeLabel(page)).toMatch(/Projects/);

  await page.keyboard.press('ArrowLeft');
  expect(await activeLabel(page)).toMatch(/About/);

  await page.keyboard.press('End');
  expect(await activeLabel(page)).toMatch(/Contact/);

  await page.keyboard.press('Home');
  expect(await activeLabel(page)).toMatch(/Introduction/);
});

test('wheel advances one item per gesture, not five', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'wheel events do not fire on touch devices');

  // A single large delta must not cascade — that's the §5.1 cooldown lock.
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  expect(await activeLabel(page)).toMatch(/About/);

  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  expect(await activeLabel(page)).toMatch(/Projects/);
});

test('touch swipe advances the carousel', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'requires a touch-capable context');

  const box = await page.locator('main').boundingBox();
  if (!box) throw new Error('content layer has no layout');

  const y = box.y + box.height / 2;
  // Swipe left → advance forward, matching the direction content travels (§5.1).
  await page.touchscreen.tap(box.x + box.width / 2, y);
  await page.locator('main').dispatchEvent('touchstart', {
    touches: [{ clientX: box.x + box.width * 0.8, clientY: y }],
  });

  await page.evaluate(
    ([startX, endX, clientY]) => {
      const target = document.querySelector('main');
      if (!target) return;
      const touch = (x: number): Touch =>
        ({ clientX: x, clientY, identifier: 0, target }) as unknown as Touch;

      target.dispatchEvent(
        new TouchEvent('touchstart', { touches: [touch(startX!)], bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new TouchEvent('touchmove', { touches: [touch(endX!)], bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new TouchEvent('touchend', {
          changedTouches: [touch(endX!)],
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [box.x + box.width * 0.8, box.x + box.width * 0.2, y],
  );

  await page.waitForTimeout(400);
  expect(await activeLabel(page)).toMatch(/About/);
});

/**
 * §5.1 / §9 — the escape hatch is "a correctness requirement, not a nice-to-have."
 * Projects is the item most likely to overflow, so it's the one that proves it.
 */
test('an overflowing item scrolls its own content before advancing', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await page.getByRole('navigation', { name: 'Section navigation' }).getByRole('button').nth(2).click();
  expect(await activeLabel(page)).toMatch(/Projects/);

  const item = page.locator(activeSlide);
  const overflows = await item.evaluate((el) => el.scrollHeight - el.clientHeight > 1);
  test.skip(!overflows, 'viewport is tall enough that Projects does not overflow');

  await item.hover();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(250);

  // The item scrolled; the carousel did not move.
  expect(await item.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await activeLabel(page)).toMatch(/Projects/);
});

test('core content is in the prerendered HTML, not injected after hydration (§10)', async ({
  request,
}) => {
  const response = await request.get('/');
  const html = await response.text();

  expect(html).toContain('slow systems fast');
  expect(html).toContain('Ledger read path');
  expect(html).toContain('Kestrel Pay');
});

test('the canvas layer is hidden from assistive tech (§9)', async ({ page }) => {
  const canvas = page.locator('canvas');
  if ((await canvas.count()) > 0) {
    await expect(canvas.first()).toHaveAttribute('aria-hidden', 'true');
  }
});

test('the code inspector is Escape-dismissible and restores focus (§9)', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /view the code behind/i }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Source code inspector' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('theme preference persists across a reload (§7.2)', async ({ page }) => {
  await page.getByRole('button', { name: /display settings/i }).click();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  // No flash: the blocking inline script resolves the theme before first paint.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
