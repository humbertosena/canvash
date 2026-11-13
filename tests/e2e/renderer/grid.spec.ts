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
      readonly invalidate: () => void;
    };
    readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
    readonly screenToWorld: (point: { x: number; y: number }) => { x: number; y: number };
    readonly worldToScreen: (point: { x: number; y: number }) => { x: number; y: number };
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

test.describe('camada de grid no Canvas 2D real', () => {
  test.beforeEach(async ({ page }) => {
    // O padrão é o grid de pontos; estas jornadas amostram pixels de linhas.
    await page.goto('/?layout=classic&grid=lines');
    await expect(page.locator('#canvas-container')).toBeVisible();
    await expect(page.locator('#canvas-container canvas')).toBeVisible();
    // A grade começa desativada por padrão; ativamos via toolbar para a suíte
    const toggleBtn = page.locator('#btn-toggle-grid');
    await expect(toggleBtn).toHaveText('Grade: Desativada');
    await toggleBtn.click();
    await waitForNextFrame(page);
    await expect(toggleBtn).toHaveText('Grade: Ativa');
  });

  test('renderiza o grid na camada de fundo, visível sob áreas vazias e coberto pelas shapes', async ({
    page,
  }) => {
    // Linha vertical do grid em x=50, y=20 (fora das shapes, que começam em y>=50)
    const linePixel = await getPixelAt(page, 50, 20);
    expect(linePixel).not.toBeNull();
    // Cor do grid é #cbd5e1 (RGB ~203, 213, 225) com alpha ativo
    expect(linePixel!.a).toBeGreaterThan(0);
    expect(linePixel!.r).toBeGreaterThan(150);
    expect(linePixel!.b).toBeGreaterThan(180);

    // Ponto intermediário (25, 20) entre linhas de grid (passo 50): fundo transparente
    const emptyPixel = await getPixelAt(page, 25, 20);
    expect(emptyPixel).not.toBeNull();
    expect(emptyPixel!.a).toBe(0);

    // Ponto (60, 60) é coberto pelo retângulo azul (bg-rect: fill #2563eb)
    const shapePixel = await getPixelAt(page, 60, 60);
    expect(shapePixel).not.toBeNull();
    expect(shapePixel!.b).toBeGreaterThan(200);
    expect(shapePixel!.r).toBeLessThan(80);
  });

  test('permite alternar visibilidade da grade dinamicamente via botão na barra de ferramentas', async ({
    page,
  }) => {
    const toggleBtn = page.locator('#btn-toggle-grid');
    await expect(toggleBtn).toHaveText('Grade: Ativa');

    // Desativa a grade clicando no botão
    await toggleBtn.click();
    await waitForNextFrame(page);
    await expect(toggleBtn).toHaveText('Grade: Desativada');

    // Ponto (50, 20) agora deve ser transparente (grade desligada)
    const disabledPixel = await getPixelAt(page, 50, 20);
    expect(disabledPixel).not.toBeNull();
    expect(disabledPixel!.a).toBe(0);

    // Reativa a grade
    await toggleBtn.click();
    await waitForNextFrame(page);
    await expect(toggleBtn).toHaveText('Grade: Ativa');

    // Ponto (50, 20) volta a ter a linha da grade desenhada
    const reenabledPixel = await getPixelAt(page, 50, 20);
    expect(reenabledPixel).not.toBeNull();
    expect(reenabledPixel!.a).toBeGreaterThan(0);
  });

  test('mantém estabilidade matemática durante pan (linhas ancoradas no mundo)', async ({
    page,
  }) => {
    // Move o viewport com pan horizontal de +30px
    await page.evaluate(() => {
      const target = globalThis as unknown as PlaygroundGlobal;
      target.__CANVASH_PLAYGROUND__?.setViewport({ x: 30, y: 0, zoom: 1 });
    });
    await waitForNextFrame(page);

    // A linha do mundo x=50 agora está na posição de tela x = 50 + 30 = 80
    const shiftedLinePixel = await getPixelAt(page, 80, 20);
    expect(shiftedLinePixel).not.toBeNull();
    expect(shiftedLinePixel!.a).toBeGreaterThan(0);

    // A posição anterior de tela x=50 agora é vazia (está entre as linhas x=30 e x=80)
    const emptyPixel = await getPixelAt(page, 50, 20);
    expect(emptyPixel).not.toBeNull();
    expect(emptyPixel!.a).toBe(0);
  });

  test('ajusta densidade adaptativamente em zoom baixo (0.05x) sem colapsar a tela', async ({
    page,
  }) => {
    // Altera o zoom para o mínimo suportado (0.05x)
    await page.locator('#btn-zoom-min').click();
    await waitForNextFrame(page);

    // Em zoom 0.05x, o passo adaptativo é 400 no mundo, correspondendo a 400 * 0.05 = 20px na tela
    // As linhas na tela ficam em x=0, 20, 40, 60, 80... e y=0, 20, 40, 60, 80...
    // Na região de tela x >= 60, y >= 60 estamos totalmente fora de todas as shapes da fixture (que terminam em tela x < 25, y < 15)
    // Linha do grid em x=60, y=70 (sobre a linha vertical x=60)
    const gridLinePixel = await getPixelAt(page, 60, 70);
    expect(gridLinePixel).not.toBeNull();
    expect(gridLinePixel!.a).toBeGreaterThan(0);

    // Ponto central da célula do grid em (70, 70): a 10px de distância de qualquer linha vertical (60, 80) e horizontal (60, 80)
    const gapPixel = await getPixelAt(page, 70, 70);
    expect(gapPixel).not.toBeNull();
    expect(gapPixel!.a).toBe(0);
  });
});
