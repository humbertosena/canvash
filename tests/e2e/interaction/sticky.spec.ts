import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  drag,
  openVariant,
  snapshot,
  VARIANTS,
  type NodeData,
  type Variant,
} from '../helpers/canvas.js';
import { closePropertiesPanel, openPropertiesPanel } from '../helpers/shell.js';

type NoteData = NodeData & {
  readonly text?: string;
  readonly fontSize?: number;
  readonly fontSizeMode?: string;
  readonly style?: { readonly fill?: string | null };
};

const COLORS = {
  yellow: '#fff59d',
  pink: '#f8bbd0',
  green: '#c8e6c9',
  blue: '#bbdefb',
  orange: '#ffcc80',
  purple: '#d1c4e9',
} as const;

const EDITOR = '[data-testid="canvash-text-editor"]';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const LONG_PHRASE =
  'Reunião de planejamento: revisar as metas do trimestre, alinhar as prioridades com o time e registrar os próximos passos';

async function note(page: Page, id: string): Promise<NoteData> {
  return (await snapshot(page)).document.nodes[id] as NoteData;
}

async function addNote(page: Page, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await createShape(page, {
    id,
    type: 'sticky',
    x: 120,
    y: 100,
    width: 200,
    height: 200,
    ...extra,
  });
}

function stickyToolButton(page: Page, variant: Variant) {
  return variant.isVanilla
    ? page.locator('#btn-tool-sticky')
    : page.locator('canvas-toolbar [data-tool="sticky"]');
}

/** Escolhe a cor das próximas notas pela interface do exemplo. */
async function chooseNextColor(page: Page, variant: Variant, name: string): Promise<void> {
  if (variant.isVanilla) {
    await page.locator('#select-sticky-color').selectOption(name);
    return;
  }
  const toolbar = page.locator('canvas-toolbar');
  await toolbar.locator('[data-action="open-sticky-colors"]').click();
  await toolbar.locator(`[role="menuitemradio"][data-color="${name}"]`).click();
}

/** Escolhe a cor da nota selecionada pelo painel do exemplo. */
async function chooseNoteColor(page: Page, variant: Variant, name: string): Promise<void> {
  if (variant.isVanilla) {
    await page.locator('#prop-sticky-color').selectOption(name);
    return;
  }
  await openPropertiesPanel(page, variant);
  await page
    .locator('canvas-properties')
    .locator(`button[data-field="sticky-color"][data-color="${name}"]`)
    .click();
}

function fontSelect(page: Page, variant: Variant) {
  return variant.isVanilla
    ? page.locator('#prop-font-size')
    : page.locator('canvas-properties').locator('select[data-field="fontSize"]');
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { undo: () => void } };
      __CANVASH_REACT__?: { section: { undo: () => void } };
      __CANVASH_VUE__?: { section: { undo: () => void } };
      __CANVASH_WC__?: { canvas: { section?: { undo: () => void } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.undo();
  });
}

async function selectIds(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((value) => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_REACT__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_VUE__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_WC__?: { canvas: { section?: { setSelection: (ids: string[]) => void } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.setSelection(value);
  }, ids);
}

async function dispatchCommand(page: Page, command: Record<string, unknown>): Promise<void> {
  await page.evaluate((input) => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { dispatch: (c: unknown) => unknown } };
      __CANVASH_REACT__?: { section: { dispatch: (c: unknown) => unknown } };
      __CANVASH_VUE__?: { section: { dispatch: (c: unknown) => unknown } };
      __CANVASH_WC__?: { canvas: { section?: { dispatch: (c: unknown) => unknown } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.dispatch(input);
  }, command);
}

async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_REACT__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_VUE__?: { section: { setSelection: (ids: string[]) => void } };
      __CANVASH_WC__?: { canvas: { section?: { setSelection: (ids: string[]) => void } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.setSelection([]);
  });
}

/** Aplica `setStickyColor` pela API pública do exemplo. */
async function setStickyColorByApi(page: Page, variant: Variant, color: string): Promise<void> {
  if (variant.isVanilla) {
    await page.evaluate((value) => {
      const w = globalThis as unknown as {
        __CANVASH_PLAYGROUND__?: { interaction?: { setStickyColor: (c: string) => void } };
      };
      w.__CANVASH_PLAYGROUND__?.interaction?.setStickyColor(value);
    }, color);
    return;
  }
  await page
    .locator('canvas-surface')
    .evaluate(
      (el, value) => (el as unknown as { setStickyColor(c: string): void }).setStickyColor(value),
      color,
    );
}

/** Lê um pixel do canvas na posição de mundo dada (viewport em 0, 0, zoom 1). */
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

function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

test.describe('Épico 02 - Feature 01: Nota adesiva nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`US-S.1: clicar cria a nota amarela 200 × 200 e abre a edição; blur grava em uma entrada em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await stickyToolButton(page, variant).click();
        expect((await snapshot(page)).session.activeTool).toBe('sticky');
        const revisionBefore = (await snapshot(page)).revision;

        await page.mouse.click(box.x + 120, box.y + 100);
        const editor = page.locator(EDITOR);
        await expect(editor).toBeVisible();
        await editor.fill('Primeira ideia');
        await page.mouse.click(2, 2);
        await expect(editor).not.toBeVisible();

        const after = await snapshot(page);
        expect(after.revision).toBe(revisionBefore + 1);
        const [id] = after.session.selectedIds;
        expect(id).toBeDefined();
        const created = after.document.nodes[id!] as NoteData;
        expect(created).toMatchObject({
          type: 'sticky',
          x: 120,
          y: 100,
          width: 200,
          height: 200,
          text: 'Primeira ideia',
          style: { fill: COLORS.yellow },
        });
        expect(after.session.activeTool).toBe('select');

        await undo(page);
        expect((await snapshot(page)).document.nodes[id!]).toBeUndefined();
      });

      test(`US-S.1: arrastar cria a nota na caixa do gesto em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await stickyToolButton(page, variant).click();

        await drag(page, { x: box.x + 150, y: box.y + 120 }, { x: box.x + 390, y: box.y + 300 });
        const editor = page.locator(EDITOR);
        await expect(editor).toBeVisible();
        await editor.fill('Caixa livre');
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();

        const [id] = (await snapshot(page)).session.selectedIds;
        expect(await note(page, id!)).toMatchObject({
          type: 'sticky',
          x: 150,
          y: 120,
          width: 240,
          height: 180,
        });
      });

      test(`US-S.2: fundo da cor, dobra mais escura e sombra no canvas em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addNote(page, 'n1');
        await clearSelection(page);

        const [fr, fg, fb] = hexToRgb(COLORS.yellow);
        await expect
          .poll(async () => (await pixel(page, variant, 150, 130)).slice(0, 3))
          .toEqual([fr, fg, fb]);

        // Dobra: triângulo no canto inferior direito, mais escuro que o fundo.
        const [dr, dg, db, da] = await pixel(page, variant, 320 - 18, 300 - 18);
        expect(da).toBe(255);
        expect(dr).toBeLessThan(fr);
        expect(dg).toBeLessThan(fg);
        expect(db).toBeLessThan(fb);

        // Sombra: logo abaixo da borda, escurecendo o que houver atrás da nota.
        const nearShadow = await pixel(page, variant, 200, 302);
        const farAway = await pixel(page, variant, 200, 380);
        expect(nearShadow).not.toEqual(farAway);
      });

      test(`US-S.2/S.3: texto escuro no amarelo, claro no roxo escuro, editor sobre a nota em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1', { text: 'Amarela' });
        await addNote(page, 'n2', {
          x: 420,
          text: 'Escura',
          style: { fill: '#4c1d95', stroke: null, strokeWidth: 0, opacity: 1 },
        });
        await clearSelection(page);

        const editor = page.locator(EDITOR);
        await page.mouse.dblclick(box.x + 220, box.y + 200);
        await expect(editor).toBeVisible();
        await expect(editor).toHaveValue('Amarela');
        await expect(editor).toHaveCSS('color', 'rgb(31, 41, 55)');
        await expect(editor).toHaveCSS('background-color', 'rgb(255, 245, 157)');
        await page.keyboard.press('Escape');
        await expect(editor).not.toBeVisible();

        await page.mouse.dblclick(box.x + 520, box.y + 200);
        await expect(editor).toBeVisible();
        await expect(editor).toHaveCSS('color', 'rgb(255, 255, 255)');
        await page.keyboard.press('Escape');
      });

      test(`US-S.3: duplo clique edita no lugar e Esc restaura o texto anterior em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1', { text: 'Texto original' });
        await clearSelection(page);
        const revision = (await snapshot(page)).revision;

        await page.mouse.dblclick(box.x + 220, box.y + 200);
        const editor = page.locator(EDITOR);
        await expect(editor).toBeVisible();
        await expect(editor).toHaveValue('Texto original');
        const editorBox = await editor.boundingBox();
        expect(editorBox!.width).toBeCloseTo(200, 0);
        expect(editorBox!.height).toBeCloseTo(200, 0);

        await editor.fill('Rascunho que não vale');
        await page.keyboard.press('Escape');
        await expect(editor).not.toBeVisible();
        expect((await note(page, 'n1')).text).toBe('Texto original');
        expect((await snapshot(page)).revision).toBe(revision);

        await page.mouse.dblclick(box.x + 220, box.y + 200);
        await editor.fill('Texto novo');
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();
        expect((await note(page, 'n1')).text).toBe('Texto novo');
        await undo(page);
        await expect.poll(async () => (await note(page, 'n1')).text).toBe('Texto original');
      });

      test(`US-S.4: no modo automático, mais texto reduz a fonte, menos aumenta e redimensionar reajusta em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1', { text: 'Oi' });
        await clearSelection(page);
        const short = (await note(page, 'n1')).fontSize!;
        expect((await note(page, 'n1')).fontSizeMode).toBe('auto');

        const editor = page.locator(EDITOR);
        await page.mouse.dblclick(box.x + 220, box.y + 200);
        await editor.fill(LONG_PHRASE);
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();
        const long = (await note(page, 'n1')).fontSize!;
        expect(long).toBeLessThan(short);
        expect(long).toBeGreaterThanOrEqual(12);

        await page.mouse.dblclick(box.x + 220, box.y + 200);
        await editor.fill('Oi');
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();
        expect((await note(page, 'n1')).fontSize).toBe(short);

        // Redimensionar a nota reajusta a fonte: o texto longo cabe maior numa nota maior.
        await dispatchCommand(page, {
          type: 'shape.update',
          id: 'n1',
          patch: { text: LONG_PHRASE },
        });
        const small = (await note(page, 'n1')).fontSize!;
        await page.mouse.click(box.x + 220, box.y + 200);
        const selected = await note(page, 'n1');
        const corner = {
          x: box.x + selected.x! + selected.width!,
          y: box.y + selected.y! + selected.height!,
        };
        await drag(page, corner, { x: corner.x + 160, y: corner.y + 160 });
        const bigger = await note(page, 'n1');
        expect(bigger.width!).toBeGreaterThan(selected.width!);
        expect(bigger.fontSize!).toBeGreaterThan(small);
      });

      test(`US-S.4: medição do ajuste automático, frase longa em sans-serif sem recorte em ${variant.name}`, async ({
        page,
        browserName,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1', { text: LONG_PHRASE, fontFamily: 'sans-serif' });
        await clearSelection(page);
        const fitted = await note(page, 'n1');

        await page.mouse.dblclick(box.x + 220, box.y + 200);
        const editor = page.locator(EDITOR);
        await expect(editor).toBeVisible();
        const metrics = await editor.evaluate((el) => {
          const area = el as HTMLTextAreaElement;
          const measured = {
            clientHeight: area.clientHeight,
            scrollHeight: area.scrollHeight,
            clientWidth: area.clientWidth,
            scrollWidth: area.scrollWidth,
            fontSize: getComputedStyle(area).fontSize,
            naturalHeight: 0,
          };
          // Altura que o texto realmente ocupa: com a caixa do editor zerada, o scrollHeight é o conteúdo.
          const previous = area.style.height;
          area.style.height = '0px';
          measured.naturalHeight = area.scrollHeight;
          area.style.height = previous;
          return measured;
        });
        const report = `${browserName}/${variant.name}: fontSize=${fitted.fontSize} (${metrics.fontSize}), altura ${metrics.scrollHeight}/${metrics.clientHeight} (texto ocupa ${metrics.naturalHeight}), largura ${metrics.scrollWidth}/${metrics.clientWidth}`;
        test.info().annotations.push({ type: 'medicao-ajuste-automatico', description: report });
        console.log(`MEDICAO ${report}`);

        expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
        await page.keyboard.press('Escape');
      });

      test(`US-S.5: escolher 24 fixa a fonte e redimensionar não a muda em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1', { text: LONG_PHRASE });

        await openPropertiesPanel(page, variant);
        const select = fontSelect(page, variant);
        await expect(select).toBeVisible();
        await expect(select).toHaveValue('auto');
        await select.selectOption('24');
        await expect.poll(async () => (await note(page, 'n1')).fontSize).toBe(24);
        expect((await note(page, 'n1')).fontSizeMode).toBe('fixed');

        const before = await note(page, 'n1');
        await closePropertiesPanel(page);
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          {
            x: box.x + before.x! + before.width! + 80,
            y: box.y + before.y! + before.height! + 80,
          },
        );
        const after = await note(page, 'n1');
        expect(after.width!).toBeGreaterThan(before.width!);
        expect(after).toMatchObject({ fontSize: 24, fontSizeMode: 'fixed' });
      });

      test(`US-S.6: o painel troca a cor da nota e o undo volta em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addNote(page, 'n1', { text: 'Cor' });

        if (!variant.isVanilla) {
          await openPropertiesPanel(page, variant);
          const swatches = page
            .locator('canvas-properties')
            .locator('button[data-field="sticky-color"]');
          await expect(swatches).toHaveCount(6);
          await expect(
            page.locator('canvas-properties').locator('input[data-field="sticky-color-custom"]'),
          ).toHaveCount(1);
          await expect(
            page
              .locator('canvas-properties')
              .locator('button[data-field="sticky-color"][data-color="yellow"]'),
          ).toHaveAttribute('aria-checked', 'true');
        }

        await chooseNoteColor(page, variant, 'blue');
        await expect.poll(async () => (await note(page, 'n1')).style?.fill).toBe(COLORS.blue);
        await undo(page);
        await expect.poll(async () => (await note(page, 'n1')).style?.fill).toBe(COLORS.yellow);

        if (!variant.isVanilla) {
          await openPropertiesPanel(page, variant);
          await page
            .locator('canvas-properties')
            .locator('input[data-field="sticky-color-custom"]')
            .fill('#4c1d95');
          await expect.poll(async () => (await note(page, 'n1')).style?.fill).toBe('#4c1d95');
        }
      });

      test(`US-S.7: o chip escolhe a cor das próximas notas e setStickyColor faz o mesmo em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);

        await chooseNextColor(page, variant, 'pink');
        expect((await snapshot(page)).session.activeTool).toBe('sticky');
        await page.mouse.click(box.x + 120, box.y + 100);
        const editor = page.locator(EDITOR);
        await expect(editor).toBeVisible();
        await editor.fill('Rosa');
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();
        const [pinkId] = (await snapshot(page)).session.selectedIds;
        expect((await note(page, pinkId!)).style?.fill).toBe(COLORS.pink);

        await setStickyColorByApi(page, variant, COLORS.green);
        await stickyToolButton(page, variant).click();
        await page.mouse.click(box.x + 420, box.y + 100);
        await expect(editor).toBeVisible();
        await editor.fill('Verde');
        await page.keyboard.press('Control+Enter');
        await expect(editor).not.toBeVisible();
        const [greenId] = (await snapshot(page)).session.selectedIds;
        expect((await note(page, greenId!)).style?.fill).toBe(COLORS.green);
        // A nota anterior não muda.
        expect((await note(page, pinkId!)).style?.fill).toBe(COLORS.pink);
      });

      test(`US-S.8: a seta vinculada acompanha mover, redimensionar e rotacionar a nota em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addNote(page, 'n1');
        await createShape(page, {
          id: 'seta',
          type: 'arrow',
          start: { targetId: 'n1', anchor: { x: 1, y: 0.5 } },
          end: { x: 620, y: 400 },
          style: { stroke: '#ff0000', strokeWidth: 4, opacity: 1 },
        });
        await clearSelection(page);

        const isRed = ([r, g, b]: readonly number[]): boolean => r! > 200 && g! < 80 && b! < 80;
        const onArrow = async (start: { x: number; y: number }): Promise<boolean> => {
          const dx = 620 - start.x;
          const dy = 400 - start.y;
          const length = Math.hypot(dx, dy);
          const sample = {
            x: Math.round(start.x + (dx / length) * 30),
            y: Math.round(start.y + (dy / length) * 30),
          };
          return isRed(await pixel(page, variant, sample.x, sample.y));
        };

        // Inicial: borda direita da nota 200 × 200 em (120, 100): (320, 200).
        await expect.poll(() => onArrow({ x: 320, y: 200 })).toBe(true);

        // Mover a nota pela interface.
        await selectIds(page, ['n1']);
        await drag(page, { x: box.x + 200, y: box.y + 160 }, { x: box.x + 260, y: box.y + 160 });
        await clearSelection(page);
        const moved = await note(page, 'n1');
        expect(moved.x).toBeCloseTo(180, 0);
        await expect
          .poll(() => onArrow({ x: moved.x! + moved.width!, y: moved.y! + moved.height! / 2 }))
          .toBe(true);
        // A seta saiu do ponto antigo: a linha velha não está mais lá.
        expect(await onArrow({ x: 320, y: 200 })).toBe(false);

        // Redimensionar pela alça sudeste.
        await selectIds(page, ['n1']);
        await drag(
          page,
          { x: box.x + moved.x! + moved.width!, y: box.y + moved.y! + moved.height! },
          { x: box.x + moved.x! + moved.width! + 60, y: box.y + moved.y! + moved.height! },
        );
        await clearSelection(page);
        const resized = await note(page, 'n1');
        expect(resized.width!).toBeGreaterThan(moved.width!);
        await expect
          .poll(() =>
            onArrow({ x: resized.x! + resized.width!, y: resized.y! + resized.height! / 2 }),
          )
          .toBe(true);
        expect(await onArrow({ x: moved.x! + moved.width!, y: moved.y! + moved.height! / 2 })).toBe(
          false,
        );

        // Rotacionar 90°: a borda direita passa a ser a borda inferior.
        await dispatchCommand(page, {
          type: 'shape.update',
          id: 'n1',
          patch: { rotation: Math.PI / 2 },
        });
        const centerX = resized.x! + resized.width! / 2;
        const centerY = resized.y! + resized.height! / 2;
        // Meio da borda direita (+w/2, 0) girado 90° horário fica em (0, +w/2).
        await expect
          .poll(() => onArrow({ x: centerX, y: centerY + resized.width! / 2 }))
          .toBe(true);
        expect(
          await onArrow({ x: resized.x! + resized.width!, y: resized.y! + resized.height! / 2 }),
        ).toBe(false);
      });

      test(`US-S.10: o seletor de cor e os campos da nota passam no axe em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addNote(page, 'n1', { text: 'Acessível' });

        if (variant.isVanilla) {
          const results = await new AxeBuilder({ page })
            .include('#select-sticky-color')
            .include('#prop-sticky-color')
            .include('#btn-tool-sticky')
            .withTags(AXE_TAGS)
            .analyze();
          expect(results.violations).toEqual([]);
          return;
        }

        await openPropertiesPanel(page, variant);
        const propertiesAxe = await new AxeBuilder({ page })
          .include('canvas-properties')
          .withTags(AXE_TAGS)
          .analyze();
        expect(propertiesAxe.violations).toEqual([]);

        const toolbar = page.locator('canvas-toolbar');
        const chip = toolbar.locator('[data-action="open-sticky-colors"]');
        await expect(chip).toHaveAttribute('aria-haspopup', 'menu');
        await expect(chip).toHaveAttribute('aria-expanded', 'false');
        await chip.focus();
        await page.keyboard.press('ArrowDown');
        const menu = toolbar.locator('[role="menu"]');
        await expect(menu).toBeVisible();
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        const items = menu.locator('[role="menuitemradio"]');
        await expect(items).toHaveCount(6);
        for (let index = 0; index < 6; index++) {
          await expect(items.nth(index)).toHaveAttribute('aria-label', /\S/);
          await expect(items.nth(index)).toHaveAttribute('aria-checked', /^(true|false)$/);
        }
        await expect(toolbar.locator('[role="menuitemradio"]:focus')).toHaveCount(1);

        const menuAxe = await new AxeBuilder({ page })
          .include('canvas-toolbar')
          .withTags(AXE_TAGS)
          .analyze();
        expect(menuAxe.violations).toEqual([]);

        // Teclado: setas movem o foco, Enter escolhe, o menu fecha e o foco volta ao chip.
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(menu).toHaveCount(0);
        await expect(chip).toBeFocused();
        expect((await snapshot(page)).session.activeTool).toBe('sticky');
      });

      test(`a nota adesiva não tem atalho de teclado em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await page.mouse.move(box.x + 300, box.y + 300);
        for (const key of ['n', 'N', 's', 'S']) {
          await page.keyboard.press(key);
          expect((await snapshot(page)).session.activeTool).not.toBe('sticky');
        }
      });
    });
  }
});
