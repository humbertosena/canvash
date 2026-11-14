import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  openVariant,
  snapshot,
  VARIANTS,
  type Variant,
} from '../helpers/canvas.js';
import { openPropertiesPanel } from '../helpers/shell.js';

// Texto dentro das formas (spec shape-label): quebra, recorte e rotação conferidos por pixel nos
// quatro exemplos. A forma é branca e sem contorno, e o texto automático é escuro (#1f2937), então
// "pixel de texto" é o pixel escuro e opaco; a seleção e as alças são azuis e não contam.

interface LabelData {
  readonly text: string;
  readonly fontSize: number;
  readonly color?: string | null;
}
interface ShapeData {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly label?: LabelData;
}

const EDITOR = 'textarea[data-testid="canvash-text-editor"]';
const BOX = { x: 100, y: 100, width: 200, height: 100 } as const;
const LONG_TEXT = Array.from({ length: 60 }, () => 'palavra').join(' ');

interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Limites exclusivos de um pixel contado: `min*` pede valor maior e `max*`, menor. */
interface PixelThresholds {
  readonly minA: number;
  readonly minR?: number;
  readonly maxR?: number;
  readonly maxG?: number;
  readonly maxB?: number;
  /** Teto da diferença absoluta entre vermelho e azul. */
  readonly maxRB?: number;
}

/** Pixel de texto: escuro e opaco (a cor automática sobre branco é #1f2937). */
const INK: PixelThresholds = { minA: 200, maxR: 110, maxG: 110, maxB: 120, maxRB: 60 };
/** Pixel do texto pintado de #ff0000. */
const RED: PixelThresholds = { minA: 200, minR: 200, maxG: 60, maxB: 60 };

function canvasOf(page: Page, variant: Variant) {
  return variant.isVanilla
    ? page.locator('#canvas-container canvas')
    : page.locator('canvas-surface canvas');
}

/** Os pixels do canvas numa região (mundo, viewport em 0, 0, zoom 1), como lista de [r, g, b, a]. */
async function pixels(page: Page, variant: Variant, region: Region): Promise<number[][]> {
  return canvasOf(page, variant).evaluate((el, area) => {
    const target = el as HTMLCanvasElement;
    const ratio = target.width / target.clientWidth;
    const context = target.getContext('2d');
    if (!context) return [];
    const x = Math.max(0, Math.round(area.x * ratio));
    const y = Math.max(0, Math.round(area.y * ratio));
    const width = Math.max(1, Math.round(area.width * ratio));
    const height = Math.max(1, Math.round(area.height * ratio));
    const { data } = context.getImageData(x, y, width, height);
    const list: number[][] = [];
    for (let i = 0; i < data.length; i += 4)
      list.push([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]);
    return list;
  }, region);
}

/**
 * Quantos pixels da região passam nos limites. A contagem roda na página: devolver cada pixel pelo
 * protocolo custa centenas de milissegundos por leitura no WebKit, que pinta em escala 2.
 */
async function countPixels(
  page: Page,
  variant: Variant,
  region: Region,
  thresholds: PixelThresholds,
): Promise<number> {
  return canvasOf(page, variant).evaluate(
    (el, { area, limits }) => {
      const target = el as HTMLCanvasElement;
      const ratio = target.width / target.clientWidth;
      const context = target.getContext('2d');
      if (!context) return 0;
      const x = Math.max(0, Math.round(area.x * ratio));
      const y = Math.max(0, Math.round(area.y * ratio));
      const width = Math.max(1, Math.round(area.width * ratio));
      const height = Math.max(1, Math.round(area.height * ratio));
      const { data } = context.getImageData(x, y, width, height);
      // Sem o limite, o canal fica livre: -1 e 256 estão fora de 0..255.
      const minR = limits.minR ?? -1;
      const maxR = limits.maxR ?? 256;
      const maxG = limits.maxG ?? 256;
      const maxB = limits.maxB ?? 256;
      const maxRB = limits.maxRB ?? 256;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        if (
          a > limits.minA &&
          r > minR &&
          r < maxR &&
          g < maxG &&
          b < maxB &&
          Math.abs(r - b) < maxRB
        )
          count++;
      }
      return count;
    },
    { area: region, limits: thresholds },
  );
}

async function inkCount(page: Page, variant: Variant, region: Region): Promise<number> {
  return countPixels(page, variant, region, INK);
}

async function node(page: Page, id: string): Promise<ShapeData> {
  return (await snapshot(page)).document.nodes[id] as unknown as ShapeData;
}

async function clearSelection(page: Page): Promise<void> {
  await selectIds(page, []);
}

async function selectIds(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((list) => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { setSelection(ids: string[]): void } };
      __CANVASH_REACT__?: { section: { setSelection(ids: string[]): void } };
      __CANVASH_VUE__?: { section: { setSelection(ids: string[]): void } };
      __CANVASH_WC__?: { canvas: { section?: { setSelection(ids: string[]): void } } };
    };
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setSelection(list);
  }, ids);
}

/** O foco no canvas, para os atalhos valerem. */
async function focusCanvas(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      (document.querySelector('canvas-surface') ??
        document.querySelector('#canvas-container')) as HTMLElement
    ).focus(),
  );
}

async function addShape(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await createShape(page, {
    id: 's1',
    type: 'rectangle',
    ...BOX,
    rotation: 0,
    style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
    label: { text: 'Olá' },
    ...extra,
  });
}

for (const variant of VARIANTS) {
  test.describe(`Texto dentro das formas: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant);
    });

    test('US-SL.6: o texto longo quebra na área, a forma não cresce e nada passa do recorte', async ({
      page,
    }) => {
      await addShape(page, { label: { text: LONG_TEXT } });
      await clearSelection(page);

      // A área é a caixa menos 8 de margem: (108, 108) a (292, 192). O texto aparece nela...
      await expect
        .poll(() => inkCount(page, variant, { x: 108, y: 108, width: 184, height: 84 }))
        .toBeGreaterThan(50);
      // ...a forma não muda de tamanho...
      const shape = await node(page, 's1');
      expect([shape.width, shape.height]).toEqual([BOX.width, BOX.height]);
      // ...e nenhum pixel do texto cai fora do recorte: nas faixas de margem dentro da forma, nem
      // acima, abaixo, à esquerda e à direita dela.
      const bands = [
        { x: 90, y: 90, width: 220, height: 18 },
        { x: 90, y: 193, width: 220, height: 40 },
        { x: 90, y: 90, width: 18, height: 130 },
        { x: 293, y: 90, width: 20, height: 130 },
      ];
      for (const band of bands) expect(await inkCount(page, variant, band)).toBe(0);
    });

    test('US-SL.6: a quebra segue a largura da área ao redimensionar, sem mudar o tamanho da fonte', async ({
      page,
    }) => {
      await addShape(page, { label: { text: LONG_TEXT } });
      const box = await canvasBox(page, variant);
      const handle = { x: box.x + BOX.x + BOX.width, y: box.y + BOX.y + BOX.height };

      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x + 120, handle.y + 80, { steps: 8 });
      // Durante o gesto, o texto aparece na prévia, na área nova (320 × 180).
      await clearSelectionVisual(page);
      await expect
        .poll(() => inkCount(page, variant, { x: 108, y: 108, width: 304, height: 164 }))
        .toBeGreaterThan(200);
      await page.mouse.up();

      const shape = await node(page, 's1');
      expect(shape.width).toBeGreaterThan(300);
      expect(shape.label).toMatchObject({ text: LONG_TEXT, fontSize: 16 });
    });

    test('US-SL.8: duplo clique abre o editor sobre a área; digitar e perder o foco grava numa entrada', async ({
      page,
    }) => {
      await addShape(page, { label: undefined });
      await clearSelection(page);
      const box = await canvasBox(page, variant);
      const before = (await snapshot(page)).revision;

      await page.mouse.dblclick(box.x + 200, box.y + 150);

      const editor = page.locator(EDITOR);
      await expect(editor).toHaveCount(1);
      // O editor cobre a área inscrita (184 × 84, mais a borda de 1 px do tracejado).
      const found = await editor.boundingBox();
      expect(found!.width).toBeCloseTo(184, -1);
      expect(found!.height).toBeCloseTo(84, -1);
      await page.keyboard.type('Primeira');
      await page.mouse.click(box.x + 600, box.y + 450);

      await expect(editor).toHaveCount(0);
      expect((await node(page, 's1')).label).toMatchObject({ text: 'Primeira' });
      expect((await snapshot(page)).revision).toBe(before + 1);
    });

    test('US-SL.8: Ctrl/⌘+Enter também grava, e Esc cancela sem efeito', async ({ page }) => {
      await addShape(page);
      await clearSelection(page);
      const box = await canvasBox(page, variant);
      const point = { x: box.x + 200, y: box.y + 150 };

      await page.mouse.dblclick(point.x, point.y);
      await page.keyboard.type('Gravado');
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator(EDITOR)).toHaveCount(0);
      expect((await node(page, 's1')).label?.text).toBe('Gravado');

      await page.mouse.dblclick(point.x, point.y);
      await page.keyboard.type(' perdido');
      const revision = (await snapshot(page)).revision;
      await page.keyboard.press('Escape');
      await expect(page.locator(EDITOR)).toHaveCount(0);
      expect((await node(page, 's1')).label?.text).toBe('Gravado');
      expect((await snapshot(page)).revision).toBe(revision);
    });

    test('US-SL.8: a forma segue visível sob o editor e o texto não aparece duas vezes', async ({
      page,
    }) => {
      await addShape(page, { label: { text: 'Existente' } });
      await clearSelection(page);
      const box = await canvasBox(page, variant);
      await expect
        .poll(() => inkCount(page, variant, { x: 108, y: 108, width: 184, height: 84 }))
        .toBeGreaterThan(5);

      await page.mouse.dblclick(box.x + 200, box.y + 150);
      await expect(page.locator(EDITOR)).toHaveCount(1);

      // No canvas, o texto some (quem o mostra é o editor); a forma branca continua lá.
      await expect
        .poll(() => inkCount(page, variant, { x: 108, y: 108, width: 184, height: 84 }))
        .toBe(0);
      const [pixel] = await pixels(page, variant, { x: 150, y: 190, width: 1, height: 1 });
      expect(pixel).toEqual([255, 255, 255, 255]);
      await page.keyboard.press('Escape');
    });

    test('US-SL.8: o duplo clique no interior de um retângulo sem preenchimento e sem texto abre o editor dele', async ({
      page,
    }) => {
      await addShape(page, {
        label: undefined,
        style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
      });
      await clearSelection(page);
      const box = await canvasBox(page, variant);

      // O clique simples no mesmo ponto não seleciona a forma vazada...
      await page.mouse.click(box.x + 200, box.y + 150);
      expect((await snapshot(page)).session.selectedIds).toEqual([]);

      // ...mas o duplo clique abre o editor dela.
      await page.mouse.dblclick(box.x + 200, box.y + 150);
      await expect(page.locator(EDITOR)).toHaveCount(1);
      await page.keyboard.press('Escape');
    });

    test('US-SL.8: Enter com uma só forma selecionada e o foco no canvas abre o editor', async ({
      page,
    }) => {
      await addShape(page);
      await focusCanvas(page);

      await page.keyboard.press('Enter');

      const editor = page.locator(EDITOR);
      await expect(editor).toHaveCount(1);
      await expect(editor).toHaveValue('Olá');
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
    });

    test('US-SL.8: Enter não faz nada com duas formas selecionadas nem com texto livre', async ({
      page,
    }) => {
      await addShape(page);
      await createShape(page, {
        id: 's2',
        type: 'rectangle',
        x: 400,
        y: 100,
        width: 100,
        height: 100,
        rotation: 0,
      });
      await createShape(page, {
        id: 't1',
        type: 'text',
        x: 400,
        y: 300,
        width: 120,
        text: 'Livre',
      });

      await selectIds(page, ['s1', 's2']);
      await focusCanvas(page);
      await page.keyboard.press('Enter');
      await expect(page.locator(EDITOR)).toHaveCount(0);

      await selectIds(page, ['t1']);
      await focusCanvas(page);
      await page.keyboard.press('Enter');
      await expect(page.locator(EDITOR)).toHaveCount(0);
    });

    test('US-SL.9: ⌘/Ctrl+Z depois da primeira edição volta a forma sem texto, e refazer o restaura', async ({
      page,
    }) => {
      await addShape(page, { label: undefined });
      await clearSelection(page);
      const box = await canvasBox(page, variant);

      await page.mouse.dblclick(box.x + 200, box.y + 150);
      await page.keyboard.type('Desfazer');
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator(EDITOR)).toHaveCount(0);
      expect((await node(page, 's1')).label?.text).toBe('Desfazer');

      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await node(page, 's1')).label).toBeUndefined();
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(async () => (await node(page, 's1')).label?.text).toBe('Desfazer');
    });

    test('US-SL.11: clicar sobre o texto de uma elipse sem preenchimento a seleciona; sem texto, não', async ({
      page,
    }) => {
      const hollow = { fill: null, stroke: null, strokeWidth: 0, opacity: 1 };
      await addShape(page, { type: 'ellipse', style: hollow });
      await clearSelection(page);
      const box = await canvasBox(page, variant);
      const middle = { x: box.x + 200, y: box.y + 150 };

      await page.mouse.click(middle.x, middle.y);
      expect((await snapshot(page)).session.selectedIds).toEqual(['s1']);

      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __CANVASH_PLAYGROUND__?: {
            section: { dispatch(c: unknown): unknown; setSelection(i: string[]): void };
          };
          __CANVASH_REACT__?: {
            section: { dispatch(c: unknown): unknown; setSelection(i: string[]): void };
          };
          __CANVASH_VUE__?: {
            section: { dispatch(c: unknown): unknown; setSelection(i: string[]): void };
          };
          __CANVASH_WC__?: {
            canvas: {
              section?: { dispatch(c: unknown): unknown; setSelection(i: string[]): void };
            };
          };
        };
        const section =
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section;
        section?.dispatch({ type: 'shape.update', id: 's1', patch: { label: null } });
        section?.setSelection([]);
      });
      await page.mouse.click(middle.x, middle.y);
      expect((await snapshot(page)).session.selectedIds).toEqual([]);
    });

    test('US-SL.7: o retângulo girado em 30° mostra o texto girado', async ({ page }) => {
      const angle = Math.PI / 6;
      await addShape(page, { rotation: angle });
      await clearSelection(page);
      const center = { x: BOX.x + BOX.width / 2, y: BOX.y + BOX.height / 2 };

      // O texto "Olá" fica no centro, na direção de 30°: há mais tinta ao longo do eixo girado
      // do que ao longo do eixo espelhado (-30°).
      const along = async (theta: number): Promise<number> => {
        let total = 0;
        for (let t = -18; t <= 18; t += 3) {
          const cx = center.x + t * Math.cos(theta);
          const cy = center.y + t * Math.sin(theta);
          total += await inkCount(page, variant, { x: cx - 2, y: cy - 2, width: 4, height: 4 });
        }
        return total;
      };
      await expect.poll(() => along(angle)).toBeGreaterThan(0);
      expect(await along(angle)).toBeGreaterThan((await along(-angle)) * 2);
    });

    test('US-SL.7: durante mover, o texto acompanha a forma na prévia', async ({ page }) => {
      await addShape(page);
      const box = await canvasBox(page, variant);
      const from = { x: box.x + BOX.x + 40, y: box.y + BOX.y + 20 };

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 200, from.y + 120, { steps: 8 });
      await clearSelectionVisual(page);

      // O centro da forma foi para (400, 270): o texto está lá e já não está no centro antigo.
      await expect
        .poll(() => inkCount(page, variant, { x: 380, y: 250, width: 40, height: 40 }))
        .toBeGreaterThan(5);
      expect(await inkCount(page, variant, { x: 180, y: 130, width: 40, height: 40 })).toBe(0);
      await page.mouse.up();

      const moved = await node(page, 's1');
      expect([moved.x, moved.y]).toEqual([BOX.x + 200, BOX.y + 120]);
      expect(moved.label).toMatchObject({ text: 'Olá' });
    });

    test('US-SL.7: durante girar, o texto gira com a forma na prévia', async ({ page }) => {
      await addShape(page);
      const box = await canvasBox(page, variant);
      const center = { x: BOX.x + BOX.width / 2, y: BOX.y + BOX.height / 2 };
      const grip = { x: box.x + center.x, y: box.y + BOX.y - 24 };

      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      // A alça vai para a direita do centro: a forma gira cerca de 90°.
      await page.mouse.move(box.x + center.x + 140, box.y + center.y, { steps: 10 });
      await clearSelectionVisual(page);

      const verticalArea = { x: center.x - 4, y: center.y - 22, width: 8, height: 44 };
      const horizontalArea = { x: center.x - 22, y: center.y - 4, width: 44, height: 8 };
      // A prévia gira quando o navegador pintar o frame: espera a rotação aparecer antes de medir.
      await expect
        .poll(
          async () =>
            (await inkCount(page, variant, verticalArea)) >
            (await inkCount(page, variant, horizontalArea)),
        )
        .toBe(true);

      const vertical = await inkCount(page, variant, verticalArea);
      const horizontal = await inkCount(page, variant, horizontalArea);
      expect(vertical).toBeGreaterThan(horizontal);
      await page.mouse.up();

      expect(Math.abs((await node(page, 's1')).rotation)).toBeGreaterThan(1);
    });
  });
}

// O painel de Propriedades chega ao texto da forma nos quatro exemplos: a seção de
// <canvas-properties> em WC, React e Vue e a do Vanilla, que usa os mesmos `data-field`. O Vanilla
// roda também no layout de ilhas, onde o painel é aberto pelo botão da toolbar.
const PANELS = [
  ...VARIANTS.map((variant) => ({ variant, classic: true, name: variant.name })),
  {
    variant: VARIANTS.find((candidate) => candidate.isVanilla)!,
    classic: false,
    name: 'Vanilla (ilhas)',
  },
];
for (const { variant, classic, name } of PANELS) {
  test.describe(`Texto da forma pelo painel: ${name}`, () => {
    const AREA = { x: 108, y: 108, width: 184, height: 84 };
    const LABEL_RADIO_GROUP = {
      verticalAlign: 'label-vertical-align',
      textAlign: 'label-align',
    } as const;
    const labelSection = (page: Page) => page.locator('[part~="section-label"], #label-section');
    const radio = (page: Page, field: 'verticalAlign' | 'textAlign', value: string) =>
      page.locator(`[data-field="${LABEL_RADIO_GROUP[field]}"] [data-value="${value}"]`);

    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic });
      await addShape(page);
      await selectIds(page, ['s1']);
      await openPropertiesPanel(page, variant);
      await expect(labelSection(page)).toBeVisible();
    });

    test('US-SL.10: Posição leva o texto ao topo e ao rodapé da área', async ({ page }) => {
      await radio(page, 'verticalAlign', 'top').click();
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          verticalAlign: 'top',
        });
      await expect.poll(() => inkCount(page, variant, { ...AREA, height: 30 })).toBeGreaterThan(5);
      expect(await inkCount(page, variant, { ...AREA, y: 160, height: 32 })).toBe(0);

      await radio(page, 'verticalAlign', 'bottom').click();
      await expect
        .poll(() => inkCount(page, variant, { ...AREA, y: 160, height: 32 }))
        .toBeGreaterThan(5);
      expect(await inkCount(page, variant, { ...AREA, height: 30 })).toBe(0);
    });

    test('US-SL.10: Alinhamento leva o texto à esquerda e à direita da área', async ({ page }) => {
      await radio(page, 'textAlign', 'left').click();
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          textAlign: 'left',
        });
      await expect.poll(() => inkCount(page, variant, { ...AREA, width: 60 })).toBeGreaterThan(5);
      expect(await inkCount(page, variant, { ...AREA, x: 200, width: 92 })).toBe(0);

      await radio(page, 'textAlign', 'right').click();
      await expect
        .poll(() => inkCount(page, variant, { ...AREA, x: 232, width: 60 }))
        .toBeGreaterThan(5);
      expect(await inkCount(page, variant, { ...AREA, width: 92 })).toBe(0);
    });

    test('US-SL.10: tamanho e negrito aumentam a tinta do texto', async ({ page }) => {
      await expect.poll(() => inkCount(page, variant, AREA)).toBeGreaterThan(5);
      const base = await inkCount(page, variant, AREA);

      await page.locator('[data-field="labelFontSize"]').selectOption('32');
      await expect.poll(async () => (await node(page, 's1')).label).toMatchObject({ fontSize: 32 });
      await expect.poll(() => inkCount(page, variant, AREA)).toBeGreaterThan(base * 2);

      const large = await inkCount(page, variant, AREA);
      await page.locator('[data-field="label-bold"]').click();
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({ fontWeight: 'bold' });
      await expect.poll(() => inkCount(page, variant, AREA)).toBeGreaterThan(large);
    });

    test('US-SL.10: a cor muda o texto, e Automática devolve a cor pelo contraste', async ({
      page,
    }) => {
      const red = (): Promise<number> => countPixels(page, variant, AREA, RED);
      // O texto já pintado diz que o canvas refletiu o documento (o fixture do Vanilla tem vermelho).
      await expect.poll(() => inkCount(page, variant, AREA)).toBeGreaterThan(5);
      expect(await red()).toBe(0);

      await page.locator('[data-field="label-color"]').fill('#ff0000');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          color: '#ff0000',
        });
      await expect.poll(red).toBeGreaterThan(5);

      await page.locator('[data-field="label-color-auto"]').click();
      await expect.poll(async () => (await node(page, 's1')).label?.color).toBeNull();
      await expect.poll(red).toBe(0);
      await expect.poll(() => inkCount(page, variant, AREA)).toBeGreaterThan(5);
    });

    test('US-SL.9: com duas formas selecionadas, a Posição muda as duas numa só entrada de histórico', async ({
      page,
    }) => {
      await createShape(page, {
        id: 's2',
        type: 'ellipse',
        x: 400,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
        label: { text: 'Dois' },
      });
      await selectIds(page, ['s1', 's2']);
      await expect(labelSection(page)).toBeVisible();
      const before = (await snapshot(page)).revision;

      await radio(page, 'verticalAlign', 'top').click();

      await expect
        .poll(async () => (await node(page, 's2')).label)
        .toMatchObject({
          verticalAlign: 'top',
        });
      expect((await node(page, 's1')).label).toMatchObject({ verticalAlign: 'top' });
      expect((await snapshot(page)).revision).toBe(before + 1);

      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          verticalAlign: 'middle',
        });
      expect((await node(page, 's2')).label).toMatchObject({ verticalAlign: 'middle' });
    });
    test('US-SL.10: com duas formas diferentes, o painel mostra o estado misto e o clique iguala as duas', async ({
      page,
    }) => {
      await createShape(page, {
        id: 's2',
        type: 'ellipse',
        x: 400,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
        label: { text: 'Dois', verticalAlign: 'bottom', fontWeight: 'bold' },
      });
      await selectIds(page, ['s1', 's2']);
      await expect(labelSection(page)).toBeVisible();

      // Posição diverge (centro × base) e negrito também: nada marcado, botão "misto".
      for (const value of ['top', 'middle', 'bottom']) {
        await expect(radio(page, 'verticalAlign', value)).toHaveAttribute('aria-checked', 'false');
      }
      await expect(page.locator('[data-field="label-bold"]')).toHaveAttribute(
        'aria-pressed',
        'mixed',
      );

      // Negrito misto liga nas duas.
      await page.locator('[data-field="label-bold"]').click();
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          fontWeight: 'bold',
        });
      expect((await node(page, 's2')).label).toMatchObject({ fontWeight: 'bold' });
      await expect(page.locator('[data-field="label-bold"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('US-SL.10: as setas movem e marcam o rádio, dando a volta, e Home e End vão às pontas', async ({
      page,
    }) => {
      const middle = radio(page, 'textAlign', 'center');
      await middle.focus();

      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          textAlign: 'right',
        });
      await expect(radio(page, 'textAlign', 'right')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          textAlign: 'left',
        });
      await page.keyboard.press('End');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          textAlign: 'right',
        });
      await page.keyboard.press('Home');
      await expect
        .poll(async () => (await node(page, 's1')).label)
        .toMatchObject({
          textAlign: 'left',
        });
      await expect(radio(page, 'textAlign', 'left')).toHaveAttribute('aria-checked', 'true');
    });

    test('US-SL.10: em modo leitura os controles do texto ficam desabilitados', async ({
      page,
    }) => {
      await expect(radio(page, 'verticalAlign', 'top')).toBeEnabled();

      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __CANVASH_PLAYGROUND__?: { section: { setReadOnly(value: boolean): void } };
          __CANVASH_REACT__?: { section: { setReadOnly(value: boolean): void } };
          __CANVASH_VUE__?: { section: { setReadOnly(value: boolean): void } };
          __CANVASH_WC__?: { canvas: { section?: { setReadOnly(value: boolean): void } } };
        };
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setReadOnly(true);
      });

      await expect(radio(page, 'verticalAlign', 'top')).toBeDisabled();
      await expect(page.locator('[data-field="labelFontSize"]')).toBeDisabled();
      await expect(page.locator('[data-field="label-bold"]')).toBeDisabled();
      await expect(page.locator('[data-field="label-color"]')).toBeDisabled();
      await expect(page.locator('[data-field="label-color-auto"]')).toBeDisabled();
    });
  });
}

/**
 * Os overlays da seleção (contorno e alças) são azuis e não contam como tinta, mas a espera deixa o
 * quadro da prévia ser pintado antes de ler os pixels.
 */
async function clearSelectionVisual(page: Page): Promise<void> {
  await page.waitForTimeout(150);
}
