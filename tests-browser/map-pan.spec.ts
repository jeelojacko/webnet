import { expect, test } from '@playwright/test';

test.describe('Map pan browser harness', () => {
  test('keeps middle-mouse pan active in a real browser and commits on release', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/map-pan-harness.html');
    await expect(page.getByTestId('map-pan-harness-ready')).toHaveText('ready');

    const map = page.locator('[data-map-interaction-phase]');
    const svg = page.locator('svg');
    await expect(map).toHaveAttribute('data-map-view-pan-x', '0.000000');
    await expect(map).toHaveAttribute('data-map-view-pan-y', '0.000000');

    const box = await svg.boundingBox();
    if (!box) throw new Error('Map svg not visible');
    const startX = box.x + box.width * 0.45;
    const startY = box.y + box.height * 0.45;

    const dispatchMapMouse = async (
      type: 'mousedown' | 'mousemove' | 'mouseup',
      clientX: number,
      clientY: number,
    ) => {
      await page.evaluate(
        ({ eventType, x, y }) => {
          const svgNode = document.querySelector('svg');
          if (!(svgNode instanceof SVGSVGElement)) {
            throw new Error('map svg not found');
          }
          const event = new MouseEvent(eventType, {
            button: 1,
            buttons: eventType === 'mouseup' ? 0 : 4,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(event, 'which', {
            configurable: true,
            value: 2,
          });
          (eventType === 'mousedown' ? svgNode : window).dispatchEvent(event);
        },
        { eventType: type, x: clientX, y: clientY },
      );
    };

    await dispatchMapMouse('mousedown', startX, startY);
    await dispatchMapMouse('mousemove', startX + 30, startY + 12);
    await dispatchMapMouse('mousemove', startX + 55, startY + 22);
    await dispatchMapMouse('mousemove', startX + 80, startY + 30);

    await expect
      .poll(async () => Number((await map.getAttribute('data-map-preview-pan-x')) ?? '0'))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number((await map.getAttribute('data-map-preview-pan-y')) ?? '0'))
      .toBeGreaterThan(0);
    await expect(map).toHaveAttribute('data-map-view-pan-x', '0.000000');
    await expect(map).toHaveAttribute('data-map-view-pan-y', '0.000000');

    const previewPanAfterFirstMove = Number(
      (await map.getAttribute('data-map-preview-pan-x')) ?? '0',
    );

    await page.waitForTimeout(350);
    await dispatchMapMouse('mousemove', startX + 115, startY + 42);
    await dispatchMapMouse('mousemove', startX + 150, startY + 60);

    await expect
      .poll(async () => Number((await map.getAttribute('data-map-preview-pan-x')) ?? '0'))
      .toBeGreaterThan(previewPanAfterFirstMove);

    await dispatchMapMouse('mouseup', startX + 150, startY + 60);

    await expect
      .poll(async () => Number((await map.getAttribute('data-map-view-pan-x')) ?? '0'))
      .not.toBe(0);
    await expect
      .poll(async () => Number((await map.getAttribute('data-map-preview-pan-x')) ?? '0'))
      .toBe(0);
    await expect(page.getByTestId('map-renderer-badge')).toContainText('Renderer:');

    expect(pageErrors).toEqual([]);
  });
});
