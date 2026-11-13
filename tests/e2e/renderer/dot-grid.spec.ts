import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground } from '../helpers/shell.js';

interface Pixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface Run {
  readonly start: number;
  readonly width: number;
}

interface CanvasLike {
  getContext: (type: string) => {
    getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
  } | null;
  readonly width: number;
}

interface BrowserGlobal {
  readonly devicePixelRatio?: number;
  readonly document: {
    readonly querySelector: (selectors: string) => {
      readonly shadowRoot?: { readonly querySelector: (s: string) => CanvasLike | null } | null;
    } | null;
  };
  readonly __CANVASH_PLAYGROUND__?: { setViewport: (v: unknown) => void };
  readonly __CANVASH_WC__?: { canvas: { section?: { setViewport: (v: unknown) => void } } };
}

interface Variant {
  readonly name: string;
  readonly url: string;
  readonly kind: 'vanilla' | 'wc';
  /** Passo do grid em CSS px com zoom 1: 50 no Vanilla (gridState) e 20 no `<canvas-surface>`. */
  readonly step: number;
}

const VARIANTS: readonly Variant[] = [
  { name: 'Vanilla', url: EXAMPLE_URLS.vanilla, kind: 'vanilla', step: 50 },
  { name: 'Web Components', url: EXAMPLE_URLS.wc, kind: 'wc', step: 20 },
];

async function open(page: Page, variant: Variant): Promise<void> {
  await page.goto(variant.url);
  if (variant.kind === 'vanilla') {
    await page.waitForSelector('#canvas-container canvas');
    // A grade do Vanilla começa desativada; o padrão de estilo é o de pontos.
    await clickInPlayground(page, '#btn-toggle-grid');
    await expect(page.locator('#btn-toggle-grid')).toHaveText('Grade: Ativa');
  } else {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const el = g.document.querySelector('canvas-surface');
      return el?.shadowRoot?.querySelector('canvas') != null;
    });
  }
}

async function setViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((v) => {
    const g = globalThis as unknown as BrowserGlobal;
    (g.__CANVASH_PLAYGROUND__ ?? g.__CANVASH_WC__?.canvas.section)?.setViewport(v);
  }, viewport);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function pixelAt(page: Page, variant: Variant, x: number, y: number): Promise<Pixel> {
  return page.evaluate(
    ({ px, py, kind }) => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas =
        kind === 'vanilla'
          ? (g.document.querySelector('#canvas-container canvas') as unknown as CanvasLike | null)
          : (g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') ??
            null);
      const data = canvas?.getContext('2d')?.getImageData(px, py, 1, 1).data;
      if (!data) throw new Error('canvas indisponível');
      return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: data[3] ?? 0 };
    },
    { px: x, py: y, kind: variant.kind },
  );
}

/** Varre uma linha de pixels do canvas e devolve os trechos com alfa, em pixels do backing store. */
async function scanRow(page: Page, variant: Variant, row: number): Promise<Run[]> {
  return page.evaluate(
    ({ y, kind }) => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas =
        kind === 'vanilla'
          ? (g.document.querySelector('#canvas-container canvas') as unknown as CanvasLike | null)
          : (g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') ??
            null);
      if (!canvas) throw new Error('canvas indisponível');
      const data = canvas.getContext('2d')?.getImageData(0, y, canvas.width, 1).data;
      if (!data) throw new Error('contexto indisponível');
      const runs: { start: number; width: number }[] = [];
      let start = -1;
      for (let x = 0; x <= canvas.width; x += 1) {
        const filled = x < canvas.width && (data[x * 4 + 3] ?? 0) > 0;
        if (filled && start < 0) start = x;
        if (!filled && start >= 0) {
          runs.push({ start, width: x - start });
          start = -1;
        }
      }
      return runs;
    },
    { y: row, kind: variant.kind },
  );
}

for (const dpr of [1, 2]) {
  test.describe(`grid de pontos (DPR ${dpr})`, () => {
    test.use({ deviceScaleFactor: dpr });

    for (const variant of VARIANTS) {
      test.describe(variant.name, () => {
        test('US-G.1: pontos #c9cbd1 nas interseções e espaço transparente entre eles', async ({
          page,
        }) => {
          await open(page, variant);
          await setViewport(page, { x: 0, y: 100, zoom: 1 });
          const step = variant.step;

          const dot = await pixelAt(page, variant, step * dpr * 2, 100 * dpr);
          expect(dot).toEqual({ r: 0xc9, g: 0xcb, b: 0xd1, a: 255 });

          // Sobre a linha que existiria no estilo 'lines', entre dois pontos: vazio.
          const betweenDots = await pixelAt(page, variant, step * dpr * 2, (100 + step / 2) * dpr);
          expect(betweenDots.a).toBe(0);

          // No meio da célula: vazio.
          const cellCenter = await pixelAt(
            page,
            variant,
            (step * 2 + step / 2) * dpr,
            (100 + step / 2) * dpr,
          );
          expect(cellCenter.a).toBe(0);
        });

        test('US-G.2: os pontos ficam ancorados no mundo durante o pan', async ({ page }) => {
          await open(page, variant);

          for (const offset of [
            { x: 13, y: 107 },
            { x: 41, y: 163 },
            { x: -37, y: 220 },
          ]) {
            await setViewport(page, { ...offset, zoom: 1 });
            // Os pontos ficam em offset + k * passo: o primeiro visível e o seguinte.
            const k = Math.ceil((4 - offset.x) / variant.step);
            for (const screenX of [
              offset.x + k * variant.step,
              offset.x + (k + 1) * variant.step,
            ]) {
              const pixel = await pixelAt(
                page,
                variant,
                Math.round(screenX * dpr),
                Math.round(offset.y * dpr),
              );
              expect(pixel.a).toBe(255);
            }
          }
        });

        test('US-G.3: ponto de 2 CSS px e espaçamento entre 16 e 100 px em zoom 0,05, 1 e 16', async ({
          page,
        }) => {
          await open(page, variant);

          for (const zoom of [0.05, 1, 16]) {
            await setViewport(page, { x: 40, y: 100, zoom });
            const runs = await scanRow(page, variant, 100 * dpr);
            // Ignora trechos cortados nas bordas do canvas.
            const inner = runs.slice(1, -1);
            expect(inner.length).toBeGreaterThan(2);

            for (const run of inner) expect(run.width).toBe(2 * dpr);

            const spacing = ((inner[1]?.start ?? 0) - (inner[0]?.start ?? 0)) / dpr;
            expect(spacing).toBeGreaterThanOrEqual(15.5);
            expect(spacing).toBeLessThanOrEqual(100.5);
          }
        });
      });
    }
  });
}

test.describe('estilo do grid em <canvas-surface>', () => {
  test('grid-style="lines" troca os pontos por linhas e volta com "dots"', async ({ page }) => {
    const variant = VARIANTS[1]!;
    await open(page, variant);
    await setViewport(page, { x: 0, y: 100, zoom: 1 });

    // Entre dois pontos, sobre a linha vertical x = 40 do passo de 20: vazio com pontos.
    const onLineDots = await pixelAt(page, variant, 40, 110);
    expect(onLineDots.a).toBe(0);

    await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      (g.document.querySelector('canvas-surface') as unknown as { gridStyle: string }).gridStyle =
        'lines';
    });
    await setViewport(page, { x: 0, y: 100, zoom: 1 });

    const onLine = await pixelAt(page, variant, 40, 110);
    expect(onLine.a).toBeGreaterThan(0);

    await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      (g.document.querySelector('canvas-surface') as unknown as { gridStyle: string }).gridStyle =
        'dots';
    });
    await setViewport(page, { x: 0, y: 100, zoom: 1 });

    const backToDots = await pixelAt(page, variant, 40, 110);
    expect(backToDots.a).toBe(0);
  });
});
