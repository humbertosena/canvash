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
      readonly replaceDocument: (doc: unknown) => { ok: boolean };
      readonly setSelection: (ids: readonly string[]) => void;
      readonly setPreview: (preview: unknown) => void;
      readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
      readonly getSnapshot: () => {
        session: {
          selectedIds: readonly string[];
          viewport: { x: number; y: number; zoom: number };
        };
      };
    };
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
      readonly invalidate: () => void;
    };
    readonly setGridEnabled: (enabled: boolean) => void;
    readonly isGridEnabled: () => boolean;
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

test.describe('camada de overlays: contorno de seleção e marquee no Canvas 2D', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return typeof g.__CANVASH_PLAYGROUND__?.handle.getMetrics === 'function';
    });

    // Desativa a grade e substitui documento por um nó de teste limpo e isolado
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.setGridEnabled(false);
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
      g.__CANVASH_PLAYGROUND__?.section.setPreview(null);
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });

      g.__CANVASH_PLAYGROUND__?.section.replaceDocument({
        schemaVersion: 1,
        id: 'doc-test-overlays',
        nodes: {
          'test-shape': {
            id: 'test-shape',
            type: 'rectangle',
            x: 100,
            y: 100,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            style: {
              fill: '#ff0000',
              stroke: null,
              strokeWidth: 0,
              opacity: 1,
            },
          },
        },
        layers: [
          {
            id: 'layer-1',
            name: 'Layer 1',
            visible: true,
            locked: false,
            childIds: ['test-shape'],
          },
        ],
      });
    });
    await waitForNextFrame(page);
  });

  test('renderiza contorno e handles de seleção ao selecionar nó no canvas', async ({ page }) => {
    // test-shape: x=100, y=100, width=100, height=100, fill vermelho puro (#ff0000)
    // 1. Sem seleção: o canto (100, 100) tem a cor vermelha da shape
    const beforeSelection = await getPixelAt(page, 100, 100);
    expect(beforeSelection?.r).toBe(255);
    expect(beforeSelection?.g).toBe(0);
    expect(beforeSelection?.b).toBe(0);

    // 2. Selecionamos a shape: o handle 'nw' é centrado exatamente em (100, 100)
    // O handle tem tamanho 8x8 px, preenchimento branco (#ffffff) e borda azul (#2563eb)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['test-shape']);
    });
    await waitForNextFrame(page);

    // Centro do handle (100, 100): preenchimento branco
    const centerHandle = await getPixelAt(page, 100, 100);
    expect(centerHandle).not.toBeNull();
    expect(centerHandle?.r).toBe(255);
    expect(centerHandle?.g).toBe(255);
    expect(centerHandle?.b).toBe(255);
    expect(centerHandle?.a).toBe(255);

    // 3. Desfaz a seleção: o canto (100, 100) volta a ser estritamente vermelho
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
    await waitForNextFrame(page);

    const backToShape = await getPixelAt(page, 100, 100);
    expect(backToShape).not.toBeNull();
    expect(backToShape?.r).toBe(255);
    expect(backToShape?.g).toBe(0);
    expect(backToShape?.b).toBe(0);
  });

  test('handles mantêm dimensão de 8 CSS px independente do zoom', async ({ page }) => {
    // 1. Teste com zoom 2x:
    // Canto em mundo (100, 100) -> tela (200, 200)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 2 });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['test-shape']);
    });
    await waitForNextFrame(page);

    // Centro do handle em tela (200, 200): branco
    const centerZoom2 = await getPixelAt(page, 200, 200);
    expect(centerZoom2?.r).toBe(255);
    expect(centerZoom2?.g).toBe(255);
    expect(centerZoom2?.b).toBe(255);

    // Interior do handle a 2 CSS px do centro (202, 200): branco (handle tem 8x8 px, vai até ±4px)
    const insideZoom2 = await getPixelAt(page, 202, 200);
    expect(insideZoom2?.r).toBe(255);
    expect(insideZoom2?.g).toBe(255);
    expect(insideZoom2?.b).toBe(255);

    // Fora do handle a 10 CSS px do centro (190, 190): transparente
    const outsideZoom2 = await getPixelAt(page, 190, 190);
    expect(outsideZoom2?.a).toBe(0);

    // 2. Teste com zoom 0.5x:
    // Canto em mundo (100, 100) -> tela (50, 50)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 0.5 });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['test-shape']);
    });
    await waitForNextFrame(page);

    // Centro do handle em tela (50, 50): branco
    const centerZoomHalf = await getPixelAt(page, 50, 50);
    expect(centerZoomHalf?.r).toBe(255);
    expect(centerZoomHalf?.g).toBe(255);
    expect(centerZoomHalf?.b).toBe(255);

    // Interior do handle a 2 CSS px do centro (52, 50): branco
    const insideZoomHalf = await getPixelAt(page, 52, 50);
    expect(insideZoomHalf?.r).toBe(255);
    expect(insideZoomHalf?.g).toBe(255);
    expect(insideZoomHalf?.b).toBe(255);

    // Fora do handle a 10 CSS px do centro (40, 40): transparente
    const outsideZoomHalf = await getPixelAt(page, 40, 40);
    expect(outsideZoomHalf?.a).toBe(0);
  });

  test('renderiza marquee provisório translúcido e limpa sem rastros', async ({ page }) => {
    // Aplica marquee em mundo x=300, y=300, width=80, height=60 (fora de shapes)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setPreview({
        marquee: { x: 300, y: 300, width: 80, height: 60 },
      });
    });
    await waitForNextFrame(page);

    // Interior do marquee (340, 330): preenchimento translúcido com componente azul
    const insideMarquee = await getPixelAt(page, 340, 330);
    expect(insideMarquee).not.toBeNull();
    expect(insideMarquee?.a).toBeGreaterThan(0);
    expect(insideMarquee?.b).toBeGreaterThan(150);

    // Fora do marquee (250, 250): transparente
    const outsideMarquee = await getPixelAt(page, 250, 250);
    expect(outsideMarquee?.a).toBe(0);

    // Limpa preview
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setPreview(null);
    });
    await waitForNextFrame(page);

    // Interior do marquee volta a ser transparente
    const clearedMarquee = await getPixelAt(page, 340, 330);
    expect(clearedMarquee?.a).toBe(0);
  });

  test('coalesce múltiplas alterações de seleção e preview no mesmo frame', async ({ page }) => {
    const initialPaintCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    // Dispara 5 alterações rápidas de seleção e preview síncronas
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['test-shape']);
      g.__CANVASH_PLAYGROUND__?.section.setPreview({
        marquee: { x: 10, y: 10, width: 50, height: 50 },
      });
      g.__CANVASH_PLAYGROUND__?.section.setPreview({
        marquee: { x: 15, y: 15, width: 60, height: 60 },
      });
      g.__CANVASH_PLAYGROUND__?.section.setPreview({
        marquee: { x: 20, y: 20, width: 70, height: 70 },
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });

    await waitForNextFrame(page);

    const afterPaintCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    // Coalescência de frames deve resultar em no máximo 1 pintura a mais
    expect(afterPaintCount - initialPaintCount).toBeLessThanOrEqual(1);
  });
});
