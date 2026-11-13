import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly session: {
          readonly viewport: {
            readonly x: number;
            readonly y: number;
            readonly zoom: number;
          };
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
    };
  };
}

test.describe('Interação: Wheel e Trackpad (Tarefa 29)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
    });
  });

  test('wheel sobre a superfície realiza pan no enquadramento', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Posiciona mouse no centro do canvas
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Rola 30px no x e 50px no y
    await page.mouse.wheel(30, 50);

    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=-30, y=-50, zoom=1.00');

    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: -30, y: -50, zoom: 1 });
  });

  test('Ctrl/Meta + wheel realiza zoom ancorado sob a posição do ponteiro', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const cursorX = box.x + 400;
    const cursorY = box.y + 300;
    await page.mouse.move(cursorX, cursorY);

    // Zoom in segurando ControlOrMeta
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('ControlOrMeta');

    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toBeDefined();
    if (!viewport) return;

    expect(viewport.zoom).toBeGreaterThan(1);
    // Ponto ancorado no centro: o pan é ajustado para manter o ponto sob o cursor
    expect(viewport.x).not.toBe(0);
    expect(viewport.y).not.toBe(0);
  });

  test('eventos fora do editor não alteram o enquadramento do canvas', async ({ page }) => {
    // Posiciona mouse fora do container (no topo da toolbar)
    await page.mouse.move(50, 20);

    // Rola a roda
    await page.mouse.wheel(40, 80);

    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=0, y=0, zoom=1.00');
  });
});
