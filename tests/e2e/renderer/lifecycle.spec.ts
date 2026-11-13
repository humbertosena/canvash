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
      readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
      readonly getSnapshot: () => {
        session: { viewport: { x: number; y: number; zoom: number } };
      };
    };
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
      readonly resize: () => void;
      readonly invalidate: () => void;
      readonly destroy: () => void;
    };
  };
}

interface BrowserCanvasElement {
  readonly width: number;
  readonly height: number;
  readonly style: {
    width: string;
    height: string;
  };
}

interface BrowserElement {
  readonly style: {
    width: string;
    height: string;
  };
}

interface BrowserGlobal {
  readonly document: {
    readonly querySelector: (selectors: string) => BrowserCanvasElement | null;
    readonly getElementById: (id: string) => BrowserElement | null;
  };
  readonly devicePixelRatio?: number;
  readonly requestAnimationFrame: (callback: () => void) => number;
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

test.describe('ciclo de vida do renderer Canvas 2D (RENDER-05)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return typeof g.__CANVASH_PLAYGROUND__?.handle.getMetrics === 'function';
    });
  });

  test('ResizeObserver adapta backing store e métricas quando container é redimensionado', async ({
    page,
  }) => {
    // 1. Dimensões iniciais do container
    const initialMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });
    expect(initialMetrics).toBeDefined();

    // 2. Altera dimensões do container dinamicamente
    await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const container = g.document.getElementById('canvas-container');
      if (container) {
        container.style.width = '640px';
        container.style.height = '480px';
      }
    });

    // Aguarda o ResizeObserver e o frame de pintura
    await page.waitForTimeout(60);
    await waitForNextFrame(page);

    const updatedMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });

    expect(updatedMetrics?.width).toBe(640);
    expect(updatedMetrics?.height).toBe(480);

    const canvasPhysicalSize = await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas = g.document.querySelector('#canvas-container canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });

    const dpr = updatedMetrics?.dpr ?? 1;
    expect(canvasPhysicalSize?.width).toBe(Math.round(640 * dpr));
    expect(canvasPhysicalSize?.height).toBe(Math.round(480 * dpr));
  });

  test('suspende pintura quando container atinge tamanho zero e retoma ao recuperar tamanho', async ({
    page,
  }) => {
    // Reduz container para 0x0
    await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const container = g.document.getElementById('canvas-container');
      if (container) {
        container.style.width = '0px';
        container.style.height = '0px';
      }
    });

    await page.waitForTimeout(60);
    await waitForNextFrame(page);

    const paintCountAtZero = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    // Dispara mutações enquanto suspenso
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 100, y: 100, zoom: 1.5 });
    });
    await waitForNextFrame(page);

    const paintCountAfterMutation = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    // Nenhuma pintura deve ocorrer em tamanho zero
    expect(paintCountAfterMutation).toBe(paintCountAtZero);

    // Restaura tamanho positivo
    await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const container = g.document.getElementById('canvas-container');
      if (container) {
        container.style.width = '700px';
        container.style.height = '500px';
      }
    });

    await page.waitForTimeout(60);
    await waitForNextFrame(page);

    const finalMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });

    // Pintura retomada com métricas corretas
    expect(finalMetrics?.width).toBe(700);
    expect(finalMetrics?.height).toBe(500);
    expect(finalMetrics!.paintCount).toBeGreaterThan(paintCountAtZero);
  });

  test('destroy remove o canvas do DOM e cancela renderizações subsequentes (RENDER-05)', async ({
    page,
  }) => {
    // 1. Verifica presença do canvas
    const hasCanvasBefore = await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      return g.document.querySelector('#canvas-container canvas') !== null;
    });
    expect(hasCanvasBefore).toBe(true);

    const paintCountBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    // 2. Destrói o renderer
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.handle.destroy();
    });

    // 3. Verifica remoção do canvas do DOM
    const hasCanvasAfter = await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      return g.document.querySelector('#canvas-container canvas') !== null;
    });
    expect(hasCanvasAfter).toBe(false);

    // 4. Mutações e chamadas subsequentes não causam erros nem novas pinturas
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 999, y: 999, zoom: 3 });
      g.__CANVASH_PLAYGROUND__?.handle.invalidate();
      g.__CANVASH_PLAYGROUND__?.handle.resize();
      g.__CANVASH_PLAYGROUND__?.handle.destroy(); // Idempotente
    });

    await waitForNextFrame(page);

    const paintCountAfter = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle.getMetrics().paintCount ?? 0;
    });

    expect(paintCountAfter).toBe(paintCountBefore);
  });
});
