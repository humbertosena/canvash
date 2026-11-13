import { expect, test } from '@playwright/test';

interface PlaygroundMetrics {
  readonly width: number;
  readonly height: number;
  readonly renderedItemsCount: number;
  readonly dpr: number;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
    };
    readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
    readonly screenToWorld: (point: { x: number; y: number }) => { x: number; y: number };
    readonly worldToScreen: (point: { x: number; y: number }) => { x: number; y: number };
    readonly hitTestScreen: (
      point: { x: number; y: number },
      options?: { tolerance?: number; includeLocked?: boolean },
    ) => readonly string[];
  };
}

interface BrowserCanvasContext {
  getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
}

interface BrowserCanvasElement {
  getContext: (type: string) => BrowserCanvasContext | null;
}

interface BrowserGlobal {
  readonly document: {
    readonly querySelector: (selectors: string) => BrowserCanvasElement | null;
  };
  readonly devicePixelRatio?: number;
  readonly requestAnimationFrame: (callback: () => void) => number;
}

async function getPixelAt(page: import('@playwright/test').Page, cssX: number, cssY: number) {
  return page.evaluate(
    ({ x, y }) => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas = g.document.querySelector('#canvas-container canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const dpr = g.devicePixelRatio || 1;
      const px = Math.round(x * dpr);
      const py = Math.round(y * dpr);
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      return {
        r: pixel[0] ?? 0,
        g: pixel[1] ?? 0,
        b: pixel[2] ?? 0,
        a: pixel[3] ?? 0,
      };
    },
    { x: cssX, y: cssY },
  );
}

async function waitForNextFrame(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const g = globalThis as unknown as BrowserGlobal;
        g.requestAnimationFrame(() => resolve());
      }),
  );
}

for (const dpr of [1, 2]) {
  test.describe(`viewport e hit-test com DPR ${dpr} (RENDER-02)`, () => {
    test.use({ deviceScaleFactor: dpr });

    test.beforeEach(async ({ page }) => {
      await page.goto('/?layout=classic');
      await expect(page.locator('#canvas-container')).toBeVisible();
      await expect(page.locator('#canvas-container canvas')).toBeVisible();
    });

    test(`mesmo ponto de mundo é desenhado e hit-testado na posição correta em zoom 1, 0.05 e 16 em DPR ${dpr}`, async ({
      page,
    }) => {
      // Ponto de mundo Pw = (80, 200), dentro de bg-rect (x: 50, y: 50, w: 300, h: 200, fill azul #2563eb)
      // Longe da linha diagonal (y ~ 67) e fora dos retângulos intermediários
      const worldPoint = { x: 80, y: 200 };

      // 1. Zoom 1.0 e Pan (0, 0)
      let screenPos = await page.evaluate((pw) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.worldToScreen(pw);
      }, worldPoint);

      expect(screenPos).toBeDefined();
      expect(screenPos?.x).toBe(80);
      expect(screenPos?.y).toBe(200);

      // Hit-test em tela em (80, 200) identifica exclusivamente 'bg-rect'
      let hits = await page.evaluate((ps) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen(ps);
      }, screenPos!);
      expect(hits).toEqual(['bg-rect']);

      // Pixel correspondente é azul
      let pixel = await getPixelAt(page, screenPos!.x, screenPos!.y);
      expect(pixel).not.toBeNull();
      expect(pixel?.b).toBeGreaterThan(200);
      expect(pixel?.r).toBeLessThan(100);

      // 2. Pan (50, 0) com Zoom 1.0
      await page.evaluate(() => {
        const target = globalThis as unknown as PlaygroundGlobal;
        target.__CANVASH_PLAYGROUND__?.setViewport({ x: 50, y: 0, zoom: 1 });
      });
      await waitForNextFrame(page);

      screenPos = await page.evaluate((pw) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.worldToScreen(pw);
      }, worldPoint);

      expect(screenPos?.x).toBe(130);
      expect(screenPos?.y).toBe(200);

      hits = await page.evaluate((ps) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen(ps);
      }, screenPos!);
      expect(hits).toEqual(['bg-rect']);

      pixel = await getPixelAt(page, screenPos!.x, screenPos!.y);
      expect(pixel).not.toBeNull();
      expect(pixel?.b).toBeGreaterThan(200);
      expect(pixel?.r).toBeLessThan(100);

      // A antiga posição de tela (80, 200) agora mapeia para mundo (30, 200), fora de bg-rect
      const oldScreenHits = await page.evaluate(() => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen({ x: 80, y: 200 });
      });
      expect(oldScreenHits).toEqual([]);

      const oldPixel = await getPixelAt(page, 80, 200);
      expect(oldPixel?.a).toBe(0);

      // 3. Zoom mínimo 0.05 com Pan (200, 200)
      await page.evaluate(() => {
        const target = globalThis as unknown as PlaygroundGlobal;
        target.__CANVASH_PLAYGROUND__?.setViewport({ x: 200, y: 200, zoom: 0.05 });
      });
      await waitForNextFrame(page);

      screenPos = await page.evaluate((pw) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.worldToScreen(pw);
      }, worldPoint);

      // 80 * 0.05 + 200 = 204
      // 200 * 0.05 + 200 = 210
      expect(screenPos?.x).toBe(204);
      expect(screenPos?.y).toBe(210);

      // Em zoom 0.05 com tolerance 0 (geometria exata do ponto no mundo), identifica exclusivamente 'bg-rect'
      const exactHits = await page.evaluate((ps) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen(ps, { tolerance: 0 });
      }, screenPos!);
      expect(exactHits).toEqual(['bg-rect']);

      // Com tolerance padrão em tela, 'bg-rect' está entre as shapes sob o cursor
      hits = await page.evaluate((ps) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen(ps);
      }, screenPos!);
      expect(hits).toContain('bg-rect');

      // Ponto (204, 210) é azul no canvas real
      pixel = await getPixelAt(page, 204, 210);
      expect(pixel).not.toBeNull();
      expect(pixel?.b).toBeGreaterThan(200);
      expect(pixel?.r).toBeLessThan(100);

      // 4. Zoom máximo 16 com Pan ajustado para centralizar Pw = (80, 200)
      // 80 * 16 = 1280. Com vx = -880: tela x = 400
      // 200 * 16 = 3200. Com vy = -2900: tela y = 300
      await page.evaluate(() => {
        const target = globalThis as unknown as PlaygroundGlobal;
        target.__CANVASH_PLAYGROUND__?.setViewport({ x: -880, y: -2900, zoom: 16 });
      });
      await waitForNextFrame(page);

      screenPos = await page.evaluate((pw) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.worldToScreen(pw);
      }, worldPoint);

      expect(screenPos?.x).toBe(400);
      expect(screenPos?.y).toBe(300);

      hits = await page.evaluate((ps) => {
        const target = globalThis as unknown as PlaygroundGlobal;
        return target.__CANVASH_PLAYGROUND__?.hitTestScreen(ps);
      }, screenPos!);
      expect(hits).toEqual(['bg-rect']);

      pixel = await getPixelAt(page, 400, 300);
      expect(pixel).not.toBeNull();
      expect(pixel?.b).toBeGreaterThan(200);
      expect(pixel?.r).toBeLessThan(100);
    });
  });
}

test.describe('controles de pan e zoom do playground vanilla', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await expect(page.locator('#canvas-container')).toBeVisible();
  });

  test('clicar em botões de zoom e pan atualiza a API do canvas e a exibição de status', async ({
    page,
  }) => {
    const viewportInfo = page.locator('#viewport-info');
    await expect(viewportInfo).toContainText('zoom=1.00');

    // Pan para direita: x=50
    await page.locator('#btn-pan-right').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('x=50');

    // Reset de pan: x=0
    await page.locator('#btn-pan-reset').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('x=0');

    // Zoom in: zoom=1.25
    await page.locator('#btn-zoom-in').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('zoom=1.25');

    // Zoom reset: zoom=1.00
    await page.locator('#btn-zoom-reset').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('zoom=1.00');

    // Zoom max: zoom=16.00
    await page.locator('#btn-zoom-max').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('zoom=16.00');

    // Zoom min: zoom=0.05
    await page.locator('#btn-zoom-min').click();
    await waitForNextFrame(page);
    await expect(viewportInfo).toContainText('zoom=0.05');
  });

  test('mover o mouse sobre o canvas atualiza coordenadas e hit-test no display', async ({
    page,
  }) => {
    const hittestInfo = page.locator('#hittest-info');
    await expect(hittestInfo).toContainText('Cursor: nenhum');

    // Garante zoom 1 e pan 0
    await page.locator('#btn-zoom-reset').click();
    await page.locator('#btn-pan-reset').click();

    const canvas = page.locator('#canvas-container canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Move o mouse para coordenadas (80, 200 no canvas)
    await page.mouse.move(box!.x + 80, box!.y + 200);
    await expect(hittestInfo).toContainText('Hit: bg-rect');
    await expect(hittestInfo).toContainText('Tela: (80, 200)');
    await expect(hittestInfo).toContainText('Mundo: (80, 200)');
  });
});
