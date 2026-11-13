import { expect, test } from '@playwright/test';

interface PlaygroundMetrics {
  readonly width: number;
  readonly height: number;
  readonly renderedItemsCount: number;
  readonly paintCount: number;
  readonly dpr: number;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly dispatch: (command: unknown) => { ok: boolean };
      readonly undo: () => { ok: boolean };
      readonly redo: () => { ok: boolean };
      readonly replaceDocument: (doc: unknown) => { ok: boolean };
      readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
      readonly getSnapshot: () => {
        session: { viewport: { x: number; y: number; zoom: number } };
      };
    };
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
      readonly invalidate: () => void;
    };
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

test.describe('culling espacial no Canvas 2D real (RENDER-03)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await expect(page.locator('#canvas-container')).toBeVisible();
    await expect(page.locator('#canvas-container canvas')).toBeVisible();
  });

  test('pinta apenas shapes que tocam o viewport e reduz renderedItemsCount em pan externo', async ({
    page,
  }) => {
    // 1. Viewport padrão (0, 0, zoom=1): todas as 4 shapes visíveis da fixture estão dentro do canvas (800x600)
    let metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics).toBeDefined();
    expect(metrics?.renderedItemsCount).toBe(4);

    // 2. Pan para longe (-2000, -2000): viewport agora olha para área vazia
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.section.setViewport({ x: -2000, y: -2000, zoom: 1 });
    });
    await waitForNextFrame(page);

    metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(0);

    // Verifica que a tela está limpa (sem rastros ou pixels residuais)
    const emptyPixel = await getPixelAt(page, 200, 200);
    expect(emptyPixel).not.toBeNull();
    expect(emptyPixel!.a).toBe(0);

    // 3. Pan de retorno para (0, 0): shapes voltam ao viewport
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
    });
    await waitForNextFrame(page);

    metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(4);
  });

  test('bounds do culling incluem stroke e rotação sem recortar bordas visíveis', async ({
    page,
  }) => {
    // Insere shape cujo centro geométrico está FORA do viewport (x < 0),
    // mas cujo stroke de 30px invade o viewport em x >= 0
    const dispatchResult1 = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-back',
        shape: {
          id: 'edge-stroke-shape',
          type: 'rectangle',
          x: -40,
          y: 400,
          width: 30, // x de -40 a -10
          height: 50,
          rotation: 0,
          style: {
            fill: null,
            stroke: '#9333ea', // Roxo
            strokeWidth: 30, // halfStroke = 15 => borda direita do stroke alcança x = -10 + 15 = +5
            opacity: 1,
          },
        },
      });
    });
    expect(dispatchResult1?.ok).toBe(true);
    await waitForNextFrame(page);

    // A shape deve ser detectada como visível pelo queryBounds e pintada
    const metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(5); // 4 da fixture + 1 nova

    // O pixel em x=2, y=425 (dentro do canvas, correspondente ao stroke que transborda a borda) é pintado em roxo
    const strokePixel = await getPixelAt(page, 2, 425);
    expect(strokePixel).not.toBeNull();
    expect(strokePixel!.a).toBeGreaterThan(0);
    expect(strokePixel!.r).toBeGreaterThan(120); // Tom roxo #9333ea
    expect(strokePixel!.b).toBeGreaterThan(200);
  });

  test('culling reage imediatamente a commit, undo, redo e replaceDocument', async ({ page }) => {
    // 1. Commit de nova shape dentro do viewport na camada visível
    const dispatchResult2 = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-back',
        shape: {
          id: 'test-culling-reactive',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          style: { fill: '#e11d48', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });
    });
    expect(dispatchResult2?.ok).toBe(true);
    await waitForNextFrame(page);

    let metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(5);

    // 2. Undo: remove a shape, contagem volta a 4
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.section.undo();
    });
    await waitForNextFrame(page);

    metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(4);

    // 3. Redo: restaura a shape, contagem volta a 5
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.section.redo();
    });
    await waitForNextFrame(page);

    metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(5);

    // 4. replaceDocument com documento vazio: contagem zera
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.section.replaceDocument({
        schemaVersion: 1,
        id: 'doc-empty',
        nodes: {},
        layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
      });
    });
    await waitForNextFrame(page);

    metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(metrics?.renderedItemsCount).toBe(0);
  });
});
