import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  openVariant,
  snapshot,
  VARIANTS,
  type NodeData,
  type Variant,
} from '../helpers/canvas.js';
import { selectDrawTool } from '../helpers/toolbar.js';

interface StrokeData {
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly kind: string;
}

type InkData = NodeData & {
  readonly strokes: readonly StrokeData[];
  readonly rotation: number;
};

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type CanvasSectionLike = {
  section?: Record<string, (...args: unknown[]) => unknown>;
  canvas?: { section?: Record<string, (...args: unknown[]) => unknown> };
};

async function inkNode(page: Page, id: string): Promise<InkData | undefined> {
  return (await snapshot(page)).document.nodes[id] as InkData | undefined;
}

async function revision(page: Page): Promise<number> {
  return (await snapshot(page)).revision;
}

/** Chama um método do canvas do exemplo: undo, redo ou setViewport. */
async function sectionCall(page: Page, method: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ({ name, params }) => {
      const w = globalThis as unknown as Record<string, CanvasSectionLike>;
      const section =
        w['__CANVASH_PLAYGROUND__']?.section ??
        w['__CANVASH_REACT__']?.section ??
        w['__CANVASH_VUE__']?.section ??
        w['__CANVASH_WC__']?.canvas?.section;
      section?.[name]?.(...params);
    },
    { name: method, params: args },
  );
}

async function previewCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = globalThis as unknown as Record<string, CanvasSectionLike>;
    const section =
      w['__CANVASH_PLAYGROUND__']?.section ??
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w['__CANVASH_WC__']?.canvas?.section;
    const preview = section?.['getPreview']?.() as { updates: Record<string, unknown> } | null;
    return preview ? Object.keys(preview.updates).length : 0;
  });
}

/** Escolhe a borracha pela interface do exemplo e devolve a caixa do canvas já com a página no topo. */
async function selectEraser(page: Page, variant: Variant) {
  await selectDrawTool(page, variant, 'eraser');
  await page.evaluate(() => window.scrollTo(0, 0));
  return canvasBox(page, variant);
}

async function chooseSize(page: Page, variant: Variant, size: string): Promise<void> {
  if (variant.isVanilla) {
    await page.locator('#select-eraser-size').selectOption(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    return;
  }
  const toolbar = page.locator('canvas-toolbar');
  // Os tamanhos aparecem na ilha de Desenho quando a borracha é a opção marcada.
  await selectDrawTool(page, variant, 'eraser');
  await toolbar.locator('[data-action="open-draw"]').click();
  await toolbar.locator(`[data-eraser-size="${size}"]`).click();
}

/** Uma linha horizontal de tinta, de (50, y) a (350, y). */
async function addLine(page: Page, id: string, y: number): Promise<void> {
  await createShape(page, {
    id,
    type: 'ink',
    strokes: [
      {
        points: [
          { x: 50, y },
          { x: 350, y },
        ],
      },
    ],
  });
}

/** Passada vertical com o mouse em x, de y0 a y1. */
async function sweepMouse(
  page: Page,
  box: { x: number; y: number },
  x: number,
  y0: number,
  y1: number,
): Promise<void> {
  await page.mouse.move(box.x + x, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x, box.y + y1, { steps: 12 });
  await page.mouse.up();
}

/** Passada vertical por eventos de ponteiro sintéticos (toque ou stylus) no contêiner do exemplo. */
async function sweepPointer(
  page: Page,
  variant: Variant,
  kind: 'touch' | 'pen',
  x: number,
  y0: number,
  y1: number,
): Promise<void> {
  await page.evaluate(
    ({ pointerType, isVanilla, px, from, to }) => {
      const element = isVanilla
        ? document.querySelector<HTMLElement>('#canvas-container')
        : (document
            .querySelector('canvas-surface')
            ?.shadowRoot?.querySelector('.surface-container') as HTMLElement | null | undefined);
      if (!element) throw new Error('contêiner interativo não encontrado');
      const rect = element.getBoundingClientRect();
      const fire = (type: string, y: number, buttons: number): void => {
        element.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 5,
            pointerType,
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons,
            clientX: rect.left + px,
            clientY: rect.top + y,
            bubbles: true,
          }),
        );
      };
      fire('pointerdown', from, 1);
      const steps = 12;
      for (let i = 1; i <= steps; i += 1) fire('pointermove', from + ((to - from) * i) / steps, 1);
      fire('pointerup', to, 0);
    },
    { pointerType: kind, isVanilla: variant.isVanilla, px: x, from: y0, to: y1 },
  );
}

async function pixel(
  page: Page,
  variant: Variant,
  x: number,
  y: number,
): Promise<readonly [number, number, number, number]> {
  const canvas = variant.isVanilla
    ? page.locator('#canvas-container canvas')
    : page.locator('canvas-surface canvas');
  return canvas.evaluate(
    (el, point) => {
      const target = el as HTMLCanvasElement;
      const ratio = target.width / target.clientWidth;
      const context = target.getContext('2d');
      if (!context) return [0, 0, 0, 0] as const;
      const data = context.getImageData(
        Math.round(point.x * ratio),
        Math.round(point.y * ratio),
        1,
        1,
      ).data;
      return [data[0]!, data[1]!, data[2]!, data[3]!] as const;
    },
    { x, y },
  );
}

/** Pontos de tela em x da linha em y = 150 que ficaram fora da passada vertical em x = 200. */
function gap(ink: InkData): number {
  const [left, right] = ink.strokes;
  const toWorldX = (p: { x: number }) => ink.x! + p.x * ink.width!;
  return toWorldX(right!.points[0]!) - toWorldX(left!.points[left!.points.length - 1]!);
}

test.describe('Épico 04 - Feature 02: Borracha nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`US-E.1: passar pelo meio divide o traço em dois no mesmo elemento em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        const box = await selectEraser(page, variant);
        const before = await revision(page);

        await sweepMouse(page, box, 200, 100, 200);

        const ink = (await inkNode(page, 'k'))!;
        expect(ink.strokes).toHaveLength(2);
        // Raio médio: 8 de cada lado de x = 200.
        expect(gap(ink)).toBeCloseTo(16, 0);
        expect(await revision(page)).toBe(before + 1);
        expect(await previewCount(page)).toBe(0);
      });

      test(`US-E.2: passar pela ponta encurta e passar por um pingo o remove em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        await createShape(page, {
          id: 'pingo',
          type: 'ink',
          strokes: [{ points: [{ x: 120, y: 260 }] }],
        });
        const box = await selectEraser(page, variant);

        await sweepMouse(page, box, 52, 100, 200);
        const ink = (await inkNode(page, 'k'))!;
        expect(ink.strokes).toHaveLength(1);
        expect(ink.x!).toBeGreaterThan(55);

        await page.mouse.click(box.x + 122, box.y + 260);
        expect(await inkNode(page, 'pingo')).toBeUndefined();
      });

      test(`US-E.3: apagar tudo remove o elemento e desfazer o devolve inteiro em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        const original = (await inkNode(page, 'k'))!;
        const box = await selectEraser(page, variant);

        await page.mouse.move(box.x + 30, box.y + 150);
        await page.mouse.down();
        await page.mouse.move(box.x + 380, box.y + 150, { steps: 20 });
        await page.mouse.up();
        expect(await inkNode(page, 'k')).toBeUndefined();

        await sectionCall(page, 'undo');
        expect(await inkNode(page, 'k')).toEqual(original);
        await sectionCall(page, 'redo');
        expect(await inkNode(page, 'k')).toBeUndefined();
      });

      test(`US-E.4: uma passada que cruza três elementos altera os três numa só entrada em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'a', 120);
        await addLine(page, 'b', 180);
        await addLine(page, 'c', 240);
        const box = await selectEraser(page, variant);
        const before = await revision(page);

        await sweepMouse(page, box, 200, 90, 270);

        for (const id of ['a', 'b', 'c'])
          expect((await inkNode(page, id))!.strokes).toHaveLength(2);
        expect(await revision(page)).toBe(before + 1);
      });

      test(`US-E.5: fina e grossa apagam 4 e 16 CSS px de raio, em qualquer zoom, e o círculo tem o mesmo raio em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        await selectEraser(page, variant);

        await chooseSize(page, variant, 'thin');
        await page.evaluate(() => window.scrollTo(0, 0));
        const box = await canvasBox(page, variant);
        await sweepMouse(page, box, 200, 100, 200);
        expect(gap((await inkNode(page, 'k'))!)).toBeCloseTo(8, 0);
        await sectionCall(page, 'undo');

        await chooseSize(page, variant, 'thick');
        await page.evaluate(() => window.scrollTo(0, 0));
        await sweepMouse(page, box, 200, 100, 200);
        expect(gap((await inkNode(page, 'k'))!)).toBeCloseTo(32, 0);
        await sectionCall(page, 'undo');

        // Em zoom 2 a mesma borracha grossa apaga a metade em unidades do documento.
        await sectionCall(page, 'setViewport', { x: 0, y: 0, zoom: 2 });
        await sweepMouse(page, box, 400, 250, 350);
        expect(gap((await inkNode(page, 'k'))!)).toBeCloseTo(16, 0);

        // O círculo do cursor: passando o mouse, a borda a 16 CSS px do ponteiro ganha tinta.
        await sectionCall(page, 'undo');
        const cx = 301;
        const cy = 203;
        const before = await pixel(page, variant, cx + 16, cy);
        await page.mouse.move(box.x + cx, box.y + cy);
        await expect
          .poll(async () => (await pixel(page, variant, cx + 16, cy)).join(','))
          .not.toBe(before.join(','));
      });

      test(`US-E.6: retângulos, textos e setas sob a passada não mudam em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        await createShape(page, {
          id: 'ret',
          type: 'rectangle',
          x: 150,
          y: 120,
          width: 100,
          height: 60,
          rotation: 0,
        });
        await createShape(page, {
          id: 'txt',
          type: 'text',
          x: 160,
          y: 130,
          width: 80,
          text: 'Olá',
        });
        await createShape(page, {
          id: 'seta',
          type: 'arrow',
          start: { x: 100, y: 100 },
          end: { x: 300, y: 200 },
        });
        const nodes = (await snapshot(page)).document.nodes;
        const before = { ret: nodes['ret'], txt: nodes['txt'], seta: nodes['seta'] };
        const box = await selectEraser(page, variant);

        await sweepMouse(page, box, 200, 90, 210);

        const after = (await snapshot(page)).document.nodes;
        expect(after['ret']).toEqual(before.ret);
        expect(after['txt']).toEqual(before.txt);
        expect(after['seta']).toEqual(before.seta);
        expect((await inkNode(page, 'k'))!.strokes).toHaveLength(2);
      });

      test(`US-E.7: Esc no meio da passada restaura o desenho, sem histórico em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        const original = (await inkNode(page, 'k'))!;
        const box = await selectEraser(page, variant);
        const before = await revision(page);

        await page.mouse.move(box.x + 200, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 170, { steps: 8 });
        expect(await previewCount(page)).toBe(1);
        await page.keyboard.press('Escape');
        expect(await previewCount(page)).toBe(0);
        await page.mouse.up();

        expect(await inkNode(page, 'k')).toEqual(original);
        expect(await revision(page)).toBe(before);
      });

      test(`US-E.8: mouse, toque e stylus apagam o mesmo trecho para o mesmo caminho em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addLine(page, 'k', 150);
        const box = await selectEraser(page, variant);

        await sweepMouse(page, box, 200, 100, 200);
        const mouse = (await inkNode(page, 'k'))!;
        await sectionCall(page, 'undo');

        await sweepPointer(page, variant, 'touch', 200, 100, 200);
        const touch = (await inkNode(page, 'k'))!;
        await sectionCall(page, 'undo');

        await sweepPointer(page, variant, 'pen', 200, 100, 200);
        const pen = (await inkNode(page, 'k'))!;

        expect(mouse.strokes).toHaveLength(2);
        expect(touch).toEqual(mouse);
        expect(pen).toEqual(mouse);
      });

      test(`a borracha não tem atalho de teclado em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await page.mouse.move(box.x + 300, box.y + 200);
        for (const key of ['e', 'E', 'x', 'X']) {
          await page.keyboard.press(key);
          expect((await snapshot(page)).session.activeTool).not.toBe('eraser');
        }
      });

      test(`o menu de tamanho passa no axe e se navega pelo teclado em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        if (variant.isVanilla) {
          const results = await new AxeBuilder({ page })
            .include('#btn-tool-eraser')
            .include('#select-eraser-size')
            .withTags(AXE_TAGS)
            .analyze();
          expect(results.violations).toEqual([]);
          return;
        }

        const toolbar = page.locator('canvas-toolbar');
        // A borracha é a opção marcada do grupo Desenho: a ilha mostra os tamanhos dela.
        await selectDrawTool(page, variant, 'eraser');
        const chip = toolbar.locator('[data-action="open-draw"]');
        await expect(chip).toHaveAttribute('aria-haspopup', 'menu');
        await expect(chip).toHaveAttribute('aria-expanded', 'false');
        await chip.focus();
        await page.keyboard.press('ArrowDown');
        const menu = toolbar.locator('[role="menu"]');
        await expect(menu).toBeVisible();
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        const items = menu.locator('[role="menuitemradio"]');
        // 4 opções do grupo + 3 tamanhos.
        await expect(items).toHaveCount(7);
        for (let index = 0; index < 7; index++) {
          await expect(items.nth(index)).toHaveAttribute('aria-label', /\S/);
          await expect(items.nth(index)).toHaveAttribute('aria-checked', /^(true|false)$/);
        }
        await expect(toolbar.locator('[role="menuitemradio"]:focus')).toHaveCount(1);

        const axe = await new AxeBuilder({ page })
          .include('canvas-toolbar')
          .withTags(AXE_TAGS)
          .analyze();
        expect(axe.violations).toEqual([]);

        // O foco abre na opção Borracha; seta para baixo e Enter escolhem a grossa, o menu fecha e
        // o foco volta ao botão do grupo.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(toolbar.locator('[data-eraser-size="thick"]')).toHaveCount(0);
        await expect(menu).toHaveCount(0);
        await expect(chip).toBeFocused();
        expect((await snapshot(page)).session.activeTool).toBe('eraser');
      });
    });
  }
});
