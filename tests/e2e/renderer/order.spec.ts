import { expect, test } from '@playwright/test';

interface PlaygroundMetrics {
  readonly width: number;
  readonly height: number;
  readonly renderedItemsCount: number;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
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

test.describe('ordenação e renderização no Canvas 2D real (RENDER-01)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    const container = page.locator('#canvas-container');
    await expect(container).toBeVisible();
    const canvas = container.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('carrega o playground e monta o canvas com métricas corretas', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      return target.__CANVASH_PLAYGROUND__?.handle.getMetrics();
    });

    expect(metrics).toBeDefined();
    expect(metrics?.width).toBe(800);
    expect(metrics?.height).toBe(600);
    // 4 itens visíveis: bg-rect, diag-line, overlap-rect, overlap-ellipse
    // Nó invisível e nó da camada oculta não são projetados nem desenhados
    expect(metrics?.renderedItemsCount).toBe(4);
  });

  test('comprova ordenação de camadas e shapes sobrepostas (RENDER-01)', async ({ page }) => {
    // 1. Ponto (70, 70): pertence exclusivamente ao bg-rect (azul: #2563eb -> r:37, g:99, b:235)
    const bgPixel = await getPixelAt(page, 70, 70);
    expect(bgPixel).not.toBeNull();
    expect(bgPixel?.b).toBeGreaterThan(200);
    expect(bgPixel?.r).toBeLessThan(100);

    // 2. Ponto (210, 150): overlap-rect (verde) sobrepõe bg-rect (azul) da camada de fundo
    // A camada intermediária deve ser desenhada à frente da camada de fundo
    const overlapRectPixel = await getPixelAt(page, 210, 150);
    expect(overlapRectPixel).not.toBeNull();
    expect(overlapRectPixel?.g).toBeGreaterThan(120);
    expect(overlapRectPixel?.b).toBeLessThan(100);

    // 3. Ponto (350, 120): overlap-ellipse (laranja: #ea580c) sobrepõe overlap-rect (verde)
    // A elipse está após o retângulo no documento da mesma camada, devendo ficar por cima
    const overlapEllipsePixel = await getPixelAt(page, 350, 120);
    expect(overlapEllipsePixel).not.toBeNull();
    expect(overlapEllipsePixel?.r).toBeGreaterThan(180);
    expect(overlapEllipsePixel?.b).toBeLessThan(80);
  });

  test('comprova que nós ocultos e camadas ocultas não são pintados (RENDER-01)', async ({
    page,
  }) => {
    // A elipse amarela (item-in-hidden-layer: #facc15 -> r:250, g:204, b:21) está em camada oculta
    // Se fosse desenhada, no ponto (70, 70) veríamos amarelo (r > 200, g > 180, b < 50)
    // Como a camada está oculta, o ponto mantém o azul do retângulo de fundo
    const hiddenLayerPixel = await getPixelAt(page, 70, 70);
    expect(hiddenLayerPixel).not.toBeNull();
    // Confirma que não é amarelo
    expect(hiddenLayerPixel?.b).toBeGreaterThan(200);
    expect(hiddenLayerPixel?.r).toBeLessThan(100);

    // O nó roxo (hidden-in-visible-layer: #9333ea -> r:147, g:51, b:234) possui visible: false
    // No ponto (85, 85), se fosse desenhado haveria roxo; como está oculto, vemos o azul do bg-rect
    const hiddenNodePixel = await getPixelAt(page, 85, 85);
    expect(hiddenNodePixel).not.toBeNull();
    expect(hiddenNodePixel?.b).toBeGreaterThan(200);
    expect(hiddenNodePixel?.r).toBeLessThan(100);
  });

  test('screenshot do canvas real é gerado com sucesso', async ({ page }) => {
    const canvas = page.locator('#canvas-container canvas');
    const screenshotBuffer = await canvas.screenshot();
    // Cabeçalho de arquivo PNG válido (89 50 4E 47 0D 0A 1A 0A)
    expect(screenshotBuffer[0]).toBe(0x89);
    expect(screenshotBuffer[1]).toBe(0x50);
    expect(screenshotBuffer[2]).toBe(0x4e);
    expect(screenshotBuffer[3]).toBe(0x47);
    expect(screenshotBuffer.length).toBeGreaterThan(1000);
  });
});
