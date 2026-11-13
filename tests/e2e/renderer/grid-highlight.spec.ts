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
  /** Posição do primeiro pixel do ponto, em pixels do backing store. */
  readonly start: number;
  readonly width: number;
  readonly pixel: Pixel;
}

interface CanvasLike {
  readonly width: number;
  readonly parentElement: {
    dispatchEvent: (event: unknown) => boolean;
  } | null;
  getBoundingClientRect: () => { left: number; top: number };
  dispatchEvent: (event: unknown) => boolean;
  getContext: (type: string) => {
    getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
  } | null;
}

interface BrowserGlobal {
  readonly document: {
    readonly querySelector: (selectors: string) => {
      readonly shadowRoot?: { readonly querySelector: (s: string) => CanvasLike | null } | null;
    } | null;
    readonly createElement: (tag: string) => { style: { cssText: string }; id: string };
    readonly body: { appendChild: (node: unknown) => void };
  };
  readonly PointerEvent: new (type: string, init: Record<string, unknown>) => unknown;
  readonly __CANVASH_PLAYGROUND__?: { setViewport: (v: unknown) => void };
  readonly __CANVASH_WC__?: { canvas: { section?: { setViewport: (v: unknown) => void } } };
  readonly __CANVASH_REACT__?: { section: { setViewport: (v: unknown) => void } };
  readonly __CANVASH_VUE__?: { section: { setViewport: (v: unknown) => void } };
  __clears?: number;
}

interface Variant {
  readonly name: string;
  readonly url: string;
  /** `wc`: o canvas fica no shadow root de um `<canvas-surface>` (WC, React e Vue). */
  readonly kind: 'vanilla' | 'wc';
  /** Passo do grid em CSS px com zoom 1: 50 no Vanilla (gridState) e 20 no `<canvas-surface>`. */
  readonly step: number;
  /** Distância (múltiplo do passo) entre 40 e 100 px: o ponto fica entre o centro e a base. */
  readonly near: number;
  /** Distância (múltiplo do passo) acima de 120 px: o ponto fica na cor base. */
  readonly far: number;
  /** Endereço com o realce desligado; sem ele, o teste põe `grid-highlight="off"` no elemento. */
  readonly offUrl?: string;
}

const VARIANTS: readonly Variant[] = [
  {
    name: 'Vanilla',
    url: EXAMPLE_URLS.vanilla,
    kind: 'vanilla',
    step: 50,
    near: 50,
    far: 150,
    offUrl: `${EXAMPLE_URLS.vanilla}?highlight=off`,
  },
  { name: 'React', url: EXAMPLE_URLS.react, kind: 'wc', step: 20, near: 60, far: 160 },
  { name: 'Vue', url: EXAMPLE_URLS.vue, kind: 'wc', step: 20, near: 60, far: 160 },
  { name: 'Web Components', url: EXAMPLE_URLS.wc, kind: 'wc', step: 20, near: 60, far: 160 },
];

const BASE: Pixel = { r: 0xc9, g: 0xcb, b: 0xd1, a: 255 };
const CENTER: Pixel = { r: 0x8b, g: 0x8f, b: 0x99, a: 255 };
/** Âncora do cursor em CSS px relativos ao canvas: múltiplo de 50 e de 20, longe das ilhas. */
const ANCHOR = { x: 400, y: 300 };
/**
 * Ponto de mundo que fica sob a âncora: longe do conteúdo de demonstração e múltiplo de qualquer
 * passo adaptativo do grid (51200 = 2^11 · 25), então a âncora é sempre uma interseção.
 */
const WORLD_AT_ANCHOR = 51200;

/** Viewport com o ponto de mundo (WORLD_AT_ANCHOR, WORLD_AT_ANCHOR) sob a âncora. */
const viewportAt = (zoom: number) => ({
  x: ANCHOR.x - WORLD_AT_ANCHOR * zoom,
  y: ANCHOR.y - WORLD_AT_ANCHOR * zoom,
  zoom,
});

async function open(page: Page, variant: Variant, url: string = variant.url): Promise<void> {
  // Conta as limpezas do canvas: uma por pintura, então o repouso tem de manter o número fixo.
  await page.addInitScript(() => {
    const g = globalThis as unknown as BrowserGlobal;
    g.__clears = 0;
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      g.__clears = (g.__clears ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  await page.goto(url);
  if (variant.kind === 'vanilla') {
    await page.waitForSelector('#canvas-container canvas');
    // A grade do Vanilla começa desativada; o padrão de estilo é o de pontos.
    await clickInPlayground(page, '#btn-toggle-grid');
    await expect(page.locator('#btn-toggle-grid')).toHaveText('Grade: Ativa');
  } else {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as BrowserGlobal;
      return (
        g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') != null
      );
    });
  }
  await setViewport(page, viewportAt(1));
}

const canvasOf = (kind: Variant['kind']): string =>
  kind === 'vanilla' ? '#canvas-container canvas' : 'canvas-surface';

async function frames(page: Page, count = 2): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}

async function setViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((v) => {
    const g = globalThis as unknown as BrowserGlobal;
    (
      g.__CANVASH_PLAYGROUND__ ??
      g.__CANVASH_WC__?.canvas.section ??
      g.__CANVASH_REACT__?.section ??
      g.__CANVASH_VUE__?.section
    )?.setViewport(v);
  }, viewport);
  await frames(page, 1);
}

/** Move o mouse para um ponto em CSS px do canvas e espera a pintura. */
async function moveMouse(page: Page, variant: Variant, x: number, y: number): Promise<void> {
  const origin = await page.evaluate((kind) => {
    const g = globalThis as unknown as BrowserGlobal;
    const canvas =
      kind === 'vanilla'
        ? (g.document.querySelector('#canvas-container canvas') as unknown as CanvasLike | null)
        : (g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') ?? null);
    if (!canvas) throw new Error('canvas indisponível');
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }, variant.kind);
  await page.mouse.move(origin.left + x, origin.top + y);
  await frames(page);
}

/** Tira o mouse do canvas: um elemento de teste cobre o canto e o ponteiro entra nele. */
async function moveMouseAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as BrowserGlobal;
    const probe = g.document.createElement('div');
    probe.id = 'highlight-probe';
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:12px;height:12px;z-index:2147483647;background:transparent';
    g.document.body.appendChild(probe);
  });
  await page.mouse.move(6, 6);
  await frames(page);
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
    { px: Math.round(x), py: Math.round(y), kind: variant.kind },
  );
}

/** Pixel no ponto (x, y) em CSS px do canvas, no backing store de `dpr`. */
const cssPixel = (page: Page, variant: Variant, dpr: number, x: number, y: number) =>
  pixelAt(page, variant, x * dpr, y * dpr);

/** Varre uma linha do backing store e devolve os trechos com alfa e a cor de cada um. */
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
      const runs: { start: number; width: number; pixel: Pixel }[] = [];
      let start = -1;
      for (let x = 0; x <= canvas.width; x += 1) {
        const filled = x < canvas.width && (data[x * 4 + 3] ?? 0) > 0;
        if (filled && start < 0) start = x;
        if (!filled && start >= 0) {
          const i = start * 4;
          runs.push({
            start,
            width: x - start,
            pixel: {
              r: data[i] ?? 0,
              g: data[i + 1] ?? 0,
              b: data[i + 2] ?? 0,
              a: data[i + 3] ?? 0,
            },
          });
          start = -1;
        }
      }
      return runs;
    },
    { y: row, kind: variant.kind },
  );
}

const luminance = (p: Pixel): number => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;

async function clearCount(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as unknown as BrowserGlobal).__clears ?? 0);
}

/** Dispara um evento de ponteiro de toque no canvas, como o navegador faria. */
async function touch(page: Page, variant: Variant, type: string, x: number, y: number) {
  await page.evaluate(
    ({ type, x, y, kind }) => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas =
        kind === 'vanilla'
          ? (g.document.querySelector('#canvas-container canvas') as unknown as CanvasLike | null)
          : (g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') ??
            null);
      if (!canvas) throw new Error('canvas indisponível');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new g.PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          composed: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      );
    },
    { type, x, y, kind: variant.kind },
  );
  await frames(page);
}

for (const variant of VARIANTS) {
  test.describe(`realce do grid: ${variant.name}`, () => {
    // O WebKit abre em DPR 2: os testes sem DPR próprio amostram o backing store em 1:1.
    test.use({ deviceScaleFactor: 1 });

    for (const dpr of [1, 2]) {
      test.describe(`DPR ${dpr}`, () => {
        test.use({ deviceScaleFactor: dpr });

        test('US-H.1: o ponto sob o cursor fica #8b8f99, o intermediário entre as cores e o distante na base', async ({
          page,
        }) => {
          await open(page, variant);
          expect(await cssPixel(page, variant, dpr, ANCHOR.x, ANCHOR.y)).toEqual(BASE);

          await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);

          expect(await cssPixel(page, variant, dpr, ANCHOR.x, ANCHOR.y)).toEqual(CENTER);
          const near = await cssPixel(page, variant, dpr, ANCHOR.x + variant.near, ANCHOR.y);
          expect(near.r).toBeGreaterThan(CENTER.r);
          expect(near.r).toBeLessThan(BASE.r);
          expect(near.a).toBe(255);
          expect(await cssPixel(page, variant, dpr, ANCHOR.x + variant.far, ANCHOR.y)).toEqual(
            BASE,
          );
          // Entre os pontos a camada continua transparente.
          const between = await cssPixel(
            page,
            variant,
            dpr,
            ANCHOR.x + variant.step / 2,
            ANCHOR.y + 3,
          );
          expect(between.a).toBe(0);
        });

        test('US-H.3: raio do ponto e do realce ficam constantes no zoom 0,05, 1 e 16', async ({
          page,
        }) => {
          await open(page, variant);

          for (const zoom of [0.05, 1, 16]) {
            // Uma interseção do grid cai sob o cursor, em qualquer zoom.
            await setViewport(page, viewportAt(zoom));
            await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);

            const runs = await scanRow(page, variant, ANCHOR.y * dpr);
            const center = runs.find(
              (run) => Math.abs(run.start + run.width / 2 - ANCHOR.x * dpr) <= dpr,
            );
            expect(center?.pixel).toEqual(CENTER);

            // Os trechos das bordas podem estar cortados pelo canvas.
            for (const run of runs.slice(1, -1)) {
              expect(run.width).toBe(2 * dpr);
              const distance = Math.abs(run.start + run.width / 2 - ANCHOR.x * dpr) / dpr;
              if (distance >= 121) expect(run.pixel).toEqual(BASE);
            }
            expect(runs.some((run) => run.pixel.r < BASE.r)).toBe(true);
          }
        });
      });
    }

    test('US-H.2: a luminância dos pontos não diminui conforme se afastam do cursor', async ({
      page,
    }) => {
      await open(page, variant);
      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);

      let previous = -1;
      for (let x = ANCHOR.x; x <= ANCHOR.x + 200; x += variant.step) {
        const pixel = await cssPixel(page, variant, 1, x, ANCHOR.y);
        expect(luminance(pixel)).toBeGreaterThanOrEqual(previous);
        previous = luminance(pixel);
      }
    });

    test('US-H.4: ao sair do canvas o frame seguinte volta à cor base', async ({ page }) => {
      await open(page, variant);
      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(CENTER);

      await moveMouseAway(page);

      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);
    });

    test('US-H.6: o toque não produz realce e apaga o do mouse', async ({ page }) => {
      await open(page, variant);

      await touch(page, variant, 'pointermove', ANCHOR.x, ANCHOR.y);
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);

      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(CENTER);

      await touch(page, variant, 'pointerdown', ANCHOR.x + 5, ANCHOR.y + 5);
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);
    });

    test('US-H.5: o realce acompanha o cursor durante o pan com o botão do meio', async ({
      page,
    }) => {
      await open(page, variant);
      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);
      const origin = await page.evaluate((kind) => {
        const g = globalThis as unknown as BrowserGlobal;
        const canvas =
          kind === 'vanilla'
            ? (g.document.querySelector('#canvas-container canvas') as unknown as CanvasLike | null)
            : (g.document.querySelector('canvas-surface')?.shadowRoot?.querySelector('canvas') ??
              null);
        const rect = canvas!.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      }, variant.kind);

      // O pan de 100 px leva o mundo para um múltiplo do passo: a malha coincide e o ponto sob o
      // novo cursor fica no mesmo tipo de interseção.
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(origin.left + ANCHOR.x + 100, origin.top + ANCHOR.y + 100, {
        steps: 4,
      });
      await frames(page);

      expect(await cssPixel(page, variant, 1, ANCHOR.x + 100, ANCHOR.y + 100)).toEqual(CENTER);
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);
      await page.mouse.up({ button: 'middle' });
    });

    test('US-H.7: com o mouse parado sobre o canvas não há repinturas', async ({ page }) => {
      await open(page, variant);
      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);
      await frames(page);
      const before = await clearCount(page);

      await page.waitForTimeout(1000);

      expect(await clearCount(page)).toBe(before);
    });

    test('US-H.8: com o realce desligado o mouse não muda nenhum pixel', async ({ page }) => {
      await open(page, variant, variant.offUrl);
      if (!variant.offUrl) {
        await page.evaluate(() => {
          const g = globalThis as unknown as BrowserGlobal;
          (
            g.document.querySelector('canvas-surface') as unknown as {
              setAttribute: (name: string, value: string) => void;
            }
          ).setAttribute('grid-highlight', 'off');
        });
        await frames(page, 3);
      }
      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);

      await moveMouse(page, variant, ANCHOR.x, ANCHOR.y);

      expect(await cssPixel(page, variant, 1, ANCHOR.x, ANCHOR.y)).toEqual(BASE);
      expect(await cssPixel(page, variant, 1, ANCHOR.x + variant.near, ANCHOR.y)).toEqual(BASE);
    });
  });
}

test.describe('realce do grid: Vanilla com o grid desligado e no estilo de linhas', () => {
  const vanilla = VARIANTS[0]!;
  test.use({ deviceScaleFactor: 1 });

  test('US-H.8: sem grade o mouse não pinta nada', async ({ page }) => {
    await page.goto(vanilla.url);
    await page.waitForSelector(canvasOf('vanilla'));
    await expect(page.locator('#btn-toggle-grid')).toHaveText('Grade: Desativada');

    await moveMouse(page, vanilla, ANCHOR.x, ANCHOR.y);

    expect((await cssPixel(page, vanilla, 1, ANCHOR.x, ANCHOR.y)).a).toBe(0);
  });

  test('US-H.8: no estilo de linhas o mouse não muda nenhum pixel', async ({ page }) => {
    await open(page, vanilla, `${EXAMPLE_URLS.vanilla}?grid=lines`);
    const samples = [
      [ANCHOR.x, ANCHOR.y],
      [ANCHOR.x + 25, ANCHOR.y],
      [ANCHOR.x, ANCHOR.y + 25],
      [ANCHOR.x + 50, ANCHOR.y + 50],
      [ANCHOR.x + 140, ANCHOR.y],
    ] as const;
    const sample = () => Promise.all(samples.map(([x, y]) => cssPixel(page, vanilla, 1, x, y)));
    const before = await sample();

    await moveMouse(page, vanilla, ANCHOR.x, ANCHOR.y);

    expect(await sample()).toEqual(before);
    expect(before.some((pixel) => pixel.a > 0)).toBe(true);
  });
});
