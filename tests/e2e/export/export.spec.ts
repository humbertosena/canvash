import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  createBoardNode,
  createShape,
  openVariant,
  VARIANTS,
  type Variant,
} from '../helpers/canvas.js';

type ResultSuccess<T> = { ok: true; value: T };
type ResultFailure<E> = { ok: false; error: E };
type Result<T, E> = ResultSuccess<T> | ResultFailure<E>;

interface ExportErrorLike {
  code: string;
  message: string;
}

interface CanvasSectionLike {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  [key: string]: unknown;
}

interface CanvashWindow {
  __CANVASH_CORE__: {
    createCanvasSection: (...args: unknown[]) => CanvasSectionLike;
    [key: string]: unknown;
  };
  __CANVASH_EXPORT__: {
    exportSvg: (...args: unknown[]) => Promise<Result<string, ExportErrorLike>>;
    exportPng: (...args: unknown[]) => Promise<Result<Blob, ExportErrorLike>>;
    [key: string]: unknown;
  };
}

async function waitForGlobals(page: Page) {
  await page.waitForFunction(() => {
    const win = window as unknown as Partial<CanvashWindow>;
    return win.__CANVASH_CORE__ !== undefined && win.__CANVASH_EXPORT__ !== undefined;
  });
}

test.describe('Exportação Visual E2E (IO-05, IO-06, IO-07)', () => {
  test('exportSvg gera representação SVG fiel e visualmente renderizável no navegador (IO-05, IO-06)', async ({
    page,
  }) => {
    await page.goto('/?layout=classic');
    await waitForGlobals(page);

    const svgResult = await page.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { exportSvg } = win.__CANVASH_EXPORT__;

      const section = createCanvasSection();

      // Formas variadas
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-e2e',
          type: 'rectangle',
          x: 20,
          y: 30,
          width: 120,
          height: 60,
          rotation: 0.1,
          style: { fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
        },
      });

      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'ellipse-e2e',
          type: 'ellipse',
          x: 180,
          y: 30,
          width: 80,
          height: 80,
          rotation: 0,
          style: { fill: '#10b981', stroke: null, strokeWidth: 0, opacity: 0.9 },
        },
      });

      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'text-e2e',
          type: 'text',
          x: 20,
          y: 120,
          width: 250,
          height: 30,
          rotation: 0,
          text: 'Canvash Export & Test (x < 10 and y > 5)',
          fontSize: 18,
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          style: { fill: '#0f172a', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });

      const res = await exportSvg(section, { padding: 15, background: '#ffffff' });
      if (!res.ok) return { ok: false, error: res.error };

      // Injeta SVG no DOM para conferir que é um XML válido e parseável pelo navegador
      const parser = new DOMParser();
      const doc = parser.parseFromString(res.value, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');

      return {
        ok: true,
        svgString: res.value,
        hasParserError: parserError !== null,
        rectCount: doc.querySelectorAll('rect').length,
        ellipseCount: doc.querySelectorAll('ellipse').length,
        textCount: doc.querySelectorAll('text').length,
      };
    });

    expect(svgResult.ok).toBe(true);
    if (!svgResult.ok) return;

    expect(svgResult.hasParserError).toBe(false);
    expect(svgResult.rectCount).toBeGreaterThanOrEqual(2); // Fundo + rect-e2e
    expect(svgResult.ellipseCount).toBe(1);
    expect(svgResult.textCount).toBeGreaterThanOrEqual(1);

    // Escape de strings garantido (IO-06)
    expect(svgResult.svgString).toContain('&amp;');
    expect(svgResult.svgString).toContain('&lt; 10');
    expect(svgResult.svgString).toContain('&gt; 5');
    expect(svgResult.svgString).not.toContain('< 10');
  });

  test('exportPng produz imagem PNG de alta resolução válida e decodificável (IO-05)', async ({
    page,
  }) => {
    await page.goto('/?layout=classic');
    await waitForGlobals(page);

    const pngVerification = await page.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { exportPng } = win.__CANVASH_EXPORT__;

      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 's-png',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 100,
          height: 80,
          rotation: 0,
          style: { fill: '#6366f1', stroke: '#4338ca', strokeWidth: 2, opacity: 1 },
        },
      });

      const res = await exportPng(section, { scale: 2, background: '#ffffff' });
      if (!res.ok) return { ok: false, error: res.error };

      const blob = res.value;
      const objectUrl = URL.createObjectURL(blob);

      // Carrega em um objeto Image para conferir se o navegador decodifica a PNG gerada
      const img = new Image();
      const loadPromise = new Promise<{ width: number; height: number; loaded: boolean }>(
        (resolve, reject) => {
          img.onload = () => {
            resolve({
              width: img.naturalWidth,
              height: img.naturalHeight,
              loaded: true,
            });
          };
          img.onerror = () => reject(new Error('Failed to decode generated PNG blob'));
        },
      );

      img.src = objectUrl;
      const dims = await loadPromise;
      URL.revokeObjectURL(objectUrl);

      return {
        ok: true,
        blobType: blob.type,
        blobSize: blob.size,
        imageDims: dims,
      };
    });

    expect(pngVerification.ok).toBe(true);
    if (!pngVerification.ok) return;

    expect(pngVerification.blobType).toBe('image/png');
    expect(pngVerification.blobSize).toBeGreaterThan(100);
    expect(pngVerification.imageDims?.loaded).toBe(true);
    expect(pngVerification.imageDims?.width).toBeGreaterThan(100);
    expect(pngVerification.imageDims?.height).toBeGreaterThan(80);
  });

  test('exportPng rejeita escala excessiva com erro LIMIT_EXCEEDED (IO-07)', async ({ page }) => {
    await page.goto('/?layout=classic');
    await waitForGlobals(page);

    const limitResult = await page.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { exportPng } = win.__CANVASH_EXPORT__;

      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'huge-rect',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 1000,
          height: 1000,
          rotation: 0,
        },
      });

      // Escala 100 levaria a 100.000 x 100.000 = 10.000.000.000 pixels >> 16.000.000
      return await exportPng(section, { scale: 100 });
    });

    expect(limitResult.ok).toBe(false);
    if (limitResult.ok) return;

    expect(limitResult.error.code).toBe('LIMIT_EXCEEDED');
    expect(limitResult.error.message).toContain('exceed maximum limit');
  });
});

/** Os botões da ilha de exportação: a pill do shell em cada exemplo. */
function exportIsland(page: Page, variant: Variant) {
  return variant.isVanilla
    ? {
        button: page.locator('#shell-export-button'),
        items: page.locator('#shell-export-menu [role="menuitem"]'),
      }
    : {
        button: page.locator('canvas-section [part~="export-button"]'),
        items: page.locator('canvas-section [part~="export-item"]'),
      };
}

// O texto dentro das formas na exportação (spec shape-label, US-SL.12), nos quatro exemplos: a
// forma é criada pela API, e o arquivo vem do download pela pill Exportar.
for (const variant of VARIANTS) {
  test.describe(`Exportação do texto da forma: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
      await createShape(page, {
        id: 'lbl',
        type: 'rectangle',
        x: 60,
        y: 60,
        width: 200,
        height: 100,
        rotation: Math.PI / 6,
        style: { fill: '#2563eb', stroke: null, strokeWidth: 0, opacity: 0.5 },
        label: { text: 'Olá & "mundo"', fontSize: 20, textAlign: 'left', verticalAlign: 'top' },
      });
    });

    test('US-SL.12: o SVG baixado traz o texto escapado, recortado e girado, com a opacidade no grupo', async ({
      page,
    }) => {
      const { button, items } = exportIsland(page, variant);
      await button.click();
      const [download] = await Promise.all([page.waitForEvent('download'), items.nth(0).click()]);

      const svg = readFileSync(await download.path(), 'utf8');

      expect(svg).toMatch(/<clipPath id="canvash-label-\d+">/);
      expect(svg).toContain('Olá &amp; &quot;mundo&quot;');
      expect(svg).toMatch(/<g opacity="0.5" transform="rotate\(/);
      expect(svg).toContain('font-size="20"');
      expect(svg).not.toContain('foreignObject');
      // Cada clip-path aponta para um clipPath existente.
      const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
      for (const [, ref] of svg.matchAll(/clip-path="url\(#([^)]+)\)"/g)) {
        expect(ids).toContain(ref);
      }
    });

    test('US-SL.12: o PNG baixado é gerado com o texto (arquivo PNG válido)', async ({ page }) => {
      const { button, items } = exportIsland(page, variant);
      await button.click();
      const [download] = await Promise.all([page.waitForEvent('download'), items.nth(1).click()]);

      const bytes = readFileSync(await download.path());

      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      // O texto aparece nos pixels: a forma é azul (r = 37) a 50% de opacidade, e o texto branco
      // por cima a clareia (r bem acima de 37); sem o texto, nenhum pixel passaria de 37.
      const lightPixels = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > 100 && data[i]! > 110) {
            count += 1;
          }
        }
        return count;
      }, bytes.toString('base64'));
      expect(lightPixels).toBeGreaterThan(20);
    });
  });
}

// O board na exportação do documento (spec boards, US-BD.13), nos quatro exemplos: o board é
// criado pela API com `createBoardNode`, e o arquivo vem do download pela pill Exportar.
for (const variant of VARIANTS) {
  test.describe(`Exportação do board: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
      await createShape(page, {
        id: 'card',
        type: 'rectangle',
        x: 150,
        y: 180,
        width: 60,
        height: 40,
        rotation: 0,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      });
      await createBoardNode(
        page,
        {
          id: 'plan',
          x: 100,
          y: 140,
          width: 320,
          height: 220,
          title: 'Fluxo & "análise"',
          style: { fill: '#00ff00', fillOpacity: 0.5, stroke: '#0000ff' },
        },
        ['card'],
      );
    });

    test('US-BD.13: o SVG baixado traz o fundo com fill-opacity, a borda, o título escapado e o filho à frente', async ({
      page,
    }) => {
      const { button, items } = exportIsland(page, variant);
      await button.click();
      const [download] = await Promise.all([page.waitForEvent('download'), items.nth(0).click()]);

      const svg = readFileSync(await download.path(), 'utf8');

      expect(svg).toContain(
        '<rect x="100" y="140" width="320" height="220" fill="#00ff00" fill-opacity="0.5" />',
      );
      expect(svg).toContain('fill="none" stroke="#0000ff" stroke-width="1"');
      expect(svg).toContain('>Fluxo &amp; &quot;análise&quot;</text>');
      expect(svg).toContain('fill="#3f3f46"');
      // A caixa inclui a faixa do título (24 unidades acima do board) e meia unidade da borda.
      expect(svg).toContain('viewBox="99.5 115.5 321 245"');
      expect(svg.indexOf('x="150" y="180"')).toBeGreaterThan(svg.indexOf('fill-opacity="0.5"'));
    });

    test('US-BD.13: o PNG baixado tem o fundo com o alfa, o título em #3f3f46 e o filho vermelho', async ({
      page,
    }) => {
      const { button, items } = exportIsland(page, variant);
      await button.click();
      const [download] = await Promise.all([page.waitForEvent('download'), items.nth(1).click()]);

      const bytes = readFileSync(await download.path());

      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const counts = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = { title: 0, background: 0, child: 0 };
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
          if (r === 0x3f && g === 0x3f && b === 0x46 && a === 255) found.title += 1;
          if (r === 0 && g === 255 && b === 0 && Math.abs(a - 128) <= 2) found.background += 1;
          if (r === 255 && g === 0 && b === 0 && a === 255) found.child += 1;
        }
        return found;
      }, bytes.toString('base64'));
      expect(counts.title).toBeGreaterThan(10);
      expect(counts.background).toBeGreaterThan(1000);
      expect(counts.child).toBeGreaterThan(500);
    });
  });
}
