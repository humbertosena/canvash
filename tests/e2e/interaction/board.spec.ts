import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createBoardNode,
  createShape,
  drag,
  openVariant,
  snapshot,
  VARIANTS,
} from '../helpers/canvas.js';
import { openPropertiesPanel, showShellPanels } from '../helpers/shell.js';

// Boards (spec organizacao-boards): a ferramenta da toolbar, a adoção, a ordem do fundo e a
// acessibilidade do botão, nos exemplos com <canvas-toolbar>. O Vanilla entra com a toolbar dele.

interface BoardData {
  readonly id: string;
  readonly type: 'board';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly childIds: readonly string[];
}

/** O botão Board: o da `<canvas-toolbar>` nos componentes e o `#btn-tool-board` do Vanilla. */
const boardButton = (page: Page) =>
  page.locator('canvas-toolbar [data-tool="board"], #btn-tool-board');

async function boards(page: Page): Promise<BoardData[]> {
  const { document } = await snapshot(page);
  return Object.values(document.nodes).filter(
    (node): node is BoardData => node.type === 'board',
  ) as BoardData[];
}

async function sessionOf(page: Page): Promise<{ tool: string; selected: readonly string[] }> {
  const { session } = await snapshot(page);
  const raw = session as unknown as { activeTool: string; selectedIds: readonly string[] };
  return { tool: raw.activeTool, selected: raw.selectedIds };
}

/** Os pixels do canvas numa região (mundo, viewport em 0, 0, zoom 1), como lista de [r, g, b, a]. */
async function pixels(
  page: Page,
  region: { x: number; y: number; width: number; height: number },
): Promise<number[][]> {
  return page.locator('canvas-surface canvas, #canvas-container canvas').evaluate((el, area) => {
    const target = el as HTMLCanvasElement;
    const ratio = target.width / target.clientWidth;
    const context = target.getContext('2d');
    if (!context) return [];
    const { data } = context.getImageData(
      Math.max(0, Math.round(area.x * ratio)),
      Math.max(0, Math.round(area.y * ratio)),
      Math.max(1, Math.round(area.width * ratio)),
      Math.max(1, Math.round(area.height * ratio)),
    );
    const list: number[][] = [];
    for (let i = 0; i < data.length; i += 4)
      list.push([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]);
    return list;
  }, region);
}

async function centerPixel(page: Page, x: number, y: number): Promise<number[]> {
  const [pixel] = await pixels(page, { x, y, width: 1, height: 1 });
  return pixel ?? [0, 0, 0, 0];
}

/**
 * A camada onde as ferramentas criam: a última visível e destravada. O Vanilla tem três camadas
 * (`createShape` põe na primeira), e o board só adota o que está na mesma camada que ele.
 */
async function toolLayer(page: Page): Promise<{ id: string; childIds: readonly string[] }> {
  const { document } = await snapshot(page);
  const layer = [...document.layers]
    .reverse()
    .find((candidate) => candidate.visible && !candidate.locked);
  return { id: layer!.id, childIds: layer!.childIds };
}

const RECT_STYLE = { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 } as const;

const rect = (id: string, x: number, y: number) => ({
  id,
  type: 'rectangle',
  x,
  y,
  width: 40,
  height: 40,
  rotation: 0,
  style: RECT_STYLE,
});

function sectionDispatch(page: Page, command: unknown): Promise<void> {
  return page.evaluate((input) => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section?: { dispatch(c: unknown): unknown } };
      __CANVASH_REACT__?: { section: { dispatch(c: unknown): unknown } };
      __CANVASH_VUE__?: { section: { dispatch(c: unknown): unknown } };
      __CANVASH_WC__?: { canvas: { section?: { dispatch(c: unknown): unknown } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.dispatch(input);
  }, command);
}

for (const variant of VARIANTS) {
  test.describe(`Boards: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant);
    });

    test('US-BD.17: o botão Board tem nome acessível e aria-pressed pela ferramenta ativa', async ({
      page,
    }) => {
      const button = boardButton(page);

      await expect(button).toHaveAttribute('aria-label', 'Board');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect((await sessionOf(page)).tool).toBe('board');
    });

    // No layout de ilhas do Vanilla o botão fica solto na área de formas, depois do grupo Desenho.
    if (variant.isVanilla) {
      test('US-BD.17: no layout de ilhas o botão Board fica fora das ilhas, com nome acessível e aria-pressed', async ({
        page,
      }) => {
        await openVariant(page, variant, { classic: false });
        const button = boardButton(page);

        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', 'Board');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.island-group #btn-tool-board')).toHaveCount(0);
        await expect(page.locator('#area-shapes > #btn-tool-board')).toHaveCount(1);
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        expect((await sessionOf(page)).tool).toBe('board');
      });
    }

    test('US-BD.1: o arrasto cria "Board 1", selecionado, e a ferramenta volta a Selecionar', async ({
      page,
    }) => {
      const box = await canvasBox(page, variant);
      await boardButton(page).click();

      await drag(page, { x: box.x + 100, y: box.y + 120 }, { x: box.x + 400, y: box.y + 320 });

      await expect.poll(async () => (await boards(page)).length).toBe(1);
      const [created] = await boards(page);
      expect(created).toMatchObject({ title: 'Board 1', width: 300, height: 200, childIds: [] });
      expect(created!.x).toBeCloseTo(100, 0);
      expect(created!.y).toBeCloseTo(120, 0);
      const session = await sessionOf(page);
      expect(session.selected).toEqual([created!.id]);
      expect(session.tool).toBe('select');
      await expect(boardButton(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('US-BD.1: o clique cria 640 × 400 no ponto, e o segundo é "Board 2"', async ({ page }) => {
      const box = await canvasBox(page, variant);
      await boardButton(page).click();
      await page.mouse.click(box.x + 20, box.y + 120);
      await expect.poll(async () => (await boards(page)).length).toBe(1);

      await boardButton(page).click();
      await drag(page, { x: box.x + 700, y: box.y + 140 }, { x: box.x + 780, y: box.y + 220 });

      await expect.poll(async () => (await boards(page)).length).toBe(2);
      const list = await boards(page);
      const first = list.find((board) => board.title === 'Board 1')!;
      expect(first).toMatchObject({ width: 640, height: 400 });
      expect(first.x).toBeCloseTo(20, 0);
      expect(first.y).toBeCloseTo(120, 0);
      expect(list.map((board) => board.title).sort()).toEqual(['Board 1', 'Board 2']);
    });

    test('US-BD.2: o board sobre três retângulos adota os dois com o centro dentro, e Ctrl/⌘+Z desfaz tudo', async ({
      page,
    }) => {
      const { id: layerId } = await toolLayer(page);
      for (const shape of [rect('in1', 110, 130), rect('out', 600, 500), rect('in2', 220, 220)]) {
        await sectionDispatch(page, { type: 'shape.create', layerId, shape });
      }
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __CANVASH_PLAYGROUND__?: { section?: { setSelection(ids: string[]): void } };
          __CANVASH_REACT__?: { section: { setSelection(ids: string[]): void } };
          __CANVASH_VUE__?: { section: { setSelection(ids: string[]): void } };
          __CANVASH_WC__?: { canvas: { section?: { setSelection(ids: string[]): void } } };
        };
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setSelection([]);
      });
      const before = (await toolLayer(page)).childIds;
      const box = await canvasBox(page, variant);
      await boardButton(page).click();

      await drag(page, { x: box.x + 90, y: box.y + 110 }, { x: box.x + 330, y: box.y + 290 });

      await expect.poll(async () => (await boards(page)).length).toBe(1);
      const [created] = await boards(page);
      expect(created!.childIds).toEqual(['in1', 'in2']);
      expect((await toolLayer(page)).childIds).toEqual(['out', created!.id]);

      await page.evaluate(() =>
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus(),
      );
      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(async () => (await boards(page)).length).toBe(0);
      expect((await toolLayer(page)).childIds).toEqual(before);
    });

    test('US-BD.4: o pixel no centro do filho é o do filho, e não o do fundo, também com o board à frente', async ({
      page,
    }) => {
      await createShape(page, rect('behind', 400, 300));
      await createBoardNode(
        page,
        {
          id: 'b',
          x: 100,
          y: 100,
          width: 200,
          height: 150,
          style: { fill: '#0000ff', fillOpacity: 1, stroke: null },
        },
        [],
      );
      await createShape(page, rect('child', 180, 160));
      await sectionDispatch(page, { type: 'board.attach', boardId: 'b', ids: ['child'] });
      await expect.poll(async () => (await centerPixel(page, 200, 180))[0]).toBeGreaterThan(240);

      // O fundo azul está em volta do filho, e o centro do filho é vermelho.
      expect(await centerPixel(page, 120, 120)).toEqual([0, 0, 255, 255]);
      expect(await centerPixel(page, 200, 180)).toEqual([255, 0, 0, 255]);

      // Levar o board para a frente de toda a camada não passa o fundo sobre o filho.
      await sectionDispatch(page, { type: 'node.reorder', id: 'b', index: 2 });
      const order = (await snapshot(page)).document.layers[0]!.childIds;
      expect(order.at(-1)).toBe('b');
      await expect.poll(async () => (await centerPixel(page, 200, 180))[0]).toBeGreaterThan(240);
      expect(await centerPixel(page, 200, 180)).toEqual([255, 0, 0, 255]);
      expect(await centerPixel(page, 120, 120)).toEqual([0, 0, 255, 255]);
    });

    test('US-BD.5: arrastar a alça redimensiona só o board; os filhos ficam, e um undo desfaz', async ({
      page,
    }) => {
      await createShape(page, rect('child', 150, 160));
      await createBoardNode(page, { id: 'b', x: 100, y: 120, width: 200, height: 150 }, ['child']);
      const box = await canvasBox(page, variant);

      // A alça sudeste fica em (300, 270); encolhe o board para além do filho.
      await drag(page, { x: box.x + 300, y: box.y + 270 }, { x: box.x + 170, y: box.y + 190 });

      await expect.poll(async () => (await boards(page))[0]?.width).toBeCloseTo(70, 0);
      const [resized] = await boards(page);
      expect(resized).toMatchObject({ x: 100, y: 120, childIds: ['child'] });
      expect(resized!.height).toBeCloseTo(70, 0);
      const child = (await snapshot(page)).document.nodes['child']!;
      expect(child).toMatchObject({ x: 150, y: 160, width: 40, height: 40 });

      await page.evaluate(() =>
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus(),
      );
      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(async () => (await boards(page))[0]?.width).toBe(200);
    });

    /** O canvas com o foco, para os atalhos de teclado valerem. */
    const focusCanvas = (page: Page) =>
      page.evaluate(() =>
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus(),
      );

    const childOf = async (page: Page, id: string) =>
      (await snapshot(page)).document.nodes[id] as unknown as { x: number; y: number };

    test('US-BD.5: arrastar o board selecionado move o board e os filhos juntos, e um undo desfaz', async ({
      page,
    }) => {
      await createShape(page, rect('child', 150, 160));
      await createBoardNode(page, { id: 'b', x: 100, y: 120, width: 200, height: 150 }, ['child']);
      const box = await canvasBox(page, variant);

      await drag(page, { x: box.x + 270, y: box.y + 250 }, { x: box.x + 330, y: box.y + 290 });

      await expect.poll(async () => (await boards(page))[0]?.x).toBeCloseTo(160, 0);
      expect((await boards(page))[0]).toMatchObject({ childIds: ['child'] });
      expect((await boards(page))[0]!.y).toBeCloseTo(160, 0);
      expect((await childOf(page, 'child')).x).toBeCloseTo(210, 0);
      expect((await childOf(page, 'child')).y).toBeCloseTo(200, 0);

      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(async () => (await boards(page))[0]?.x).toBe(100);
      expect(await childOf(page, 'child')).toMatchObject({ x: 150, y: 160 });
    });

    test('US-BD.5: as setas movem o board e os filhos pelo mesmo vetor', async ({ page }) => {
      await createShape(page, rect('child', 150, 160));
      await createBoardNode(page, { id: 'b', x: 100, y: 120, width: 200, height: 150 }, ['child']);
      await focusCanvas(page);

      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('ArrowDown');

      await expect.poll(async () => (await boards(page))[0]?.x).toBe(110);
      expect((await boards(page))[0]!.y).toBe(121);
      expect(await childOf(page, 'child')).toMatchObject({ x: 160, y: 161 });
    });

    test('US-BD.8: Delete apaga o board e os filhos, e o undo restaura tudo com os mesmos IDs e a mesma ordem', async ({
      page,
    }) => {
      await createShape(page, rect('a', 150, 160));
      await createShape(page, rect('z', 600, 400));
      await createBoardNode(page, { id: 'b', x: 100, y: 120, width: 200, height: 150 }, ['a']);
      const before = (await snapshot(page)).document;
      await focusCanvas(page);

      await page.keyboard.press('Delete');

      await expect.poll(async () => (await boards(page)).length).toBe(0);
      expect(Object.keys((await snapshot(page)).document.nodes)).toEqual(['z']);

      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(async () => (await boards(page)).length).toBe(1);
      const after = (await snapshot(page)).document;
      expect(Object.keys(after.nodes).sort()).toEqual(Object.keys(before.nodes).sort());
      expect(after.layers[0]!.childIds).toEqual(before.layers[0]!.childIds);
      expect((await boards(page))[0]!.childIds).toEqual(['a']);
    });

    const selectIds = (page: Page, ids: readonly string[]) =>
      page.evaluate((list) => {
        const w = globalThis as unknown as {
          __CANVASH_PLAYGROUND__?: { section?: { setSelection(ids: readonly string[]): void } };
          __CANVASH_REACT__?: { section: { setSelection(ids: readonly string[]): void } };
          __CANVASH_VUE__?: { section: { setSelection(ids: readonly string[]): void } };
          __CANVASH_WC__?: { canvas: { section?: { setSelection(ids: readonly string[]): void } } };
        };
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setSelection(list);
      }, ids);

    test('US-BD.3: soltar com o centro dentro entra no board, soltar fora sai, e cada gesto é uma entrada', async ({
      page,
    }) => {
      await createBoardNode(page, { id: 'b', x: 100, y: 140, width: 300, height: 200 });
      await createShape(page, rect('r', 500, 400));
      const box = await canvasBox(page, variant);

      // O centro de `r` (520, 420) vai para (220, 240): dentro do board.
      await drag(page, { x: box.x + 520, y: box.y + 420 }, { x: box.x + 220, y: box.y + 240 });

      await expect.poll(async () => (await boards(page))[0]?.childIds).toEqual(['r']);
      expect((await snapshot(page)).document.layers[0]!.childIds).toEqual(['b']);

      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await boards(page))[0]?.childIds).toEqual([]);
      expect((await snapshot(page)).document.layers[0]!.childIds).toEqual(['b', 'r']);
      expect(await childOf(page, 'r')).toMatchObject({ x: 500, y: 400 });
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(async () => (await boards(page))[0]?.childIds).toEqual(['r']);

      // De volta para fora: o filho vai à camada, logo à frente do board.
      await drag(page, { x: box.x + 220, y: box.y + 240 }, { x: box.x + 620, y: box.y + 480 });

      await expect.poll(async () => (await boards(page))[0]?.childIds).toEqual([]);
      expect((await snapshot(page)).document.layers[0]!.childIds).toEqual(['b', 'r']);
    });

    test('US-BD.9: soltar um board sobre outro não o põe dentro, e Agrupar não vale com board na seleção', async ({
      page,
    }) => {
      await createBoardNode(page, { id: 'b1', x: 100, y: 100, width: 250, height: 200 });
      await createBoardNode(page, { id: 'b2', x: 450, y: 100, width: 150, height: 150 });
      const box = await canvasBox(page, variant);

      // b2 está selecionado; o centro dele (525, 175) vai para (225, 175): dentro do b1.
      await drag(page, { x: box.x + 540, y: box.y + 230 }, { x: box.x + 240, y: box.y + 230 });

      await expect
        .poll(async () => (await boards(page)).find((b) => b.id === 'b2')?.x)
        .toBeCloseTo(150, 0);
      const list = await boards(page);
      expect(list.find((b) => b.id === 'b1')!.childIds).toEqual([]);
      expect((await snapshot(page)).document.layers[0]!.childIds).toEqual(['b1', 'b2']);

      await selectIds(page, ['b1', 'b2']);
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+g');

      const nodes = Object.values((await snapshot(page)).document.nodes);
      expect(nodes.filter((node) => node.type === 'group')).toEqual([]);
    });

    const selectedOf = async (page: Page) => (await sessionOf(page)).selected;

    test('US-BD.7: o clique no fundo seleciona o board, e o clique num filho seleciona o filho', async ({
      page,
    }) => {
      await createShape(page, rect('child', 150, 180));
      await createBoardNode(page, { id: 'b', x: 100, y: 140, width: 300, height: 200 }, ['child']);
      await selectIds(page, []);
      const box = await canvasBox(page, variant);

      await page.mouse.click(box.x + 350, box.y + 300);
      await expect.poll(() => selectedOf(page)).toEqual(['b']);

      await page.mouse.click(box.x + 170, box.y + 200);
      await expect.poll(() => selectedOf(page)).toEqual(['child']);
    });

    test('US-BD.7: o arrasto no fundo de um board não selecionado faz marquee e pega só os filhos', async ({
      page,
    }) => {
      await createShape(page, rect('c1', 130, 180));
      await createShape(page, rect('c2', 330, 280));
      await createBoardNode(page, { id: 'b', x: 100, y: 140, width: 300, height: 200 }, [
        'c1',
        'c2',
      ]);
      await selectIds(page, []);
      const box = await canvasBox(page, variant);

      // Da esquerda para a direita (contém): começa no fundo do board e cobre só o c1.
      await drag(page, { x: box.x + 115, y: box.y + 155 }, { x: box.x + 200, y: box.y + 240 });

      await expect.poll(() => selectedOf(page)).toEqual(['c1']);
      expect((await boards(page))[0]).toMatchObject({ x: 100, y: 140 });
    });

    test('US-BD.7: a marquee que contém o board inteiro seleciona o board', async ({ page }) => {
      await createShape(page, rect('c1', 130, 180));
      await createBoardNode(page, { id: 'b', x: 200, y: 160, width: 300, height: 200 }, ['c1']);
      await selectIds(page, []);
      const box = await canvasBox(page, variant);

      await drag(page, { x: box.x + 150, y: box.y + 90 }, { x: box.x + 560, y: box.y + 400 });

      await expect.poll(() => selectedOf(page)).toEqual(['b']);
    });

    test('US-BD.6: arrastar o título move o board, mesmo sem seleção prévia', async ({ page }) => {
      await createShape(page, rect('child', 150, 180));
      await createBoardNode(page, { id: 'b', x: 100, y: 140, width: 300, height: 200 }, ['child']);
      await selectIds(page, []);
      const box = await canvasBox(page, variant);

      // O título ocupa a faixa de y = 116 a 140, logo acima do canto superior esquerdo.
      await drag(page, { x: box.x + 150, y: box.y + 128 }, { x: box.x + 210, y: box.y + 168 });

      await expect.poll(async () => (await boards(page))[0]?.x).toBeCloseTo(160, 0);
      expect((await boards(page))[0]!.y).toBeCloseTo(180, 0);
      expect((await childOf(page, 'child')).x).toBeCloseTo(210, 0);
      expect(await selectedOf(page)).toEqual(['b']);
    });

    const titleEditor = (page: Page) =>
      page.locator('input[data-testid="canvash-board-title-editor"]');

    /** Cria um board em (100, 140) e devolve o ponto, em tela, no meio da faixa do título. */
    async function boardWithTitlePoint(page: Page): Promise<{ x: number; y: number }> {
      await createBoardNode(
        page,
        { id: 'b', x: 100, y: 140, width: 300, height: 200, title: 'Board 1' },
        [],
      );
      await selectIds(page, []);
      const box = await canvasBox(page, variant);
      return { x: box.x + 200, y: box.y + 128 };
    }

    test('US-BD.6: o duplo clique no título abre o editor com o texto selecionado e rótulo; Enter grava uma só entrada', async ({
      page,
    }) => {
      const point = await boardWithTitlePoint(page);

      await page.mouse.dblclick(point.x, point.y);

      const editor = titleEditor(page);
      await expect(editor).toBeFocused();
      await expect(editor).toHaveAttribute('aria-label', 'Título do board');
      await expect(editor).toHaveAttribute('maxlength', '200');
      await expect(editor).toHaveValue('Board 1');
      expect(
        await editor.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!),
      ).toBe('Board 1'.length);
      expect(await selectedOf(page)).toEqual(['b']);

      await page.keyboard.type('  Jornada do cliente  ');
      await page.keyboard.press('Enter');

      await expect(editor).toHaveCount(0);
      await expect.poll(async () => (await boards(page))[0]?.title).toBe('Jornada do cliente');
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await boards(page))[0]?.title).toBe('Board 1');
    });

    test('US-BD.6: Esc cancela, e título vazio ou igual ao atual não muda nada', async ({
      page,
    }) => {
      const point = await boardWithTitlePoint(page);
      const editor = titleEditor(page);

      await page.mouse.dblclick(point.x, point.y);
      await page.keyboard.type('Outro');
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      expect((await boards(page))[0]!.title).toBe('Board 1');

      await page.mouse.dblclick(point.x, point.y);
      await page.keyboard.press('Delete');
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
      expect((await boards(page))[0]!.title).toBe('Board 1');
      expect((await boards(page)).length).toBe(1);
    });

    test('US-BD.6: perder o foco confirma o título', async ({ page }) => {
      const point = await boardWithTitlePoint(page);

      await page.mouse.dblclick(point.x, point.y);
      await page.keyboard.type('Visão geral');
      // Dentro do canvas e da janela, longe do campo (no Vanilla o canvas começa mais abaixo).
      await page.mouse.click(point.x + 60, point.y + 120);

      await expect(titleEditor(page)).toHaveCount(0);
      await expect.poll(async () => (await boards(page))[0]?.title).toBe('Visão geral');
    });

    test('US-BD.6: o campo não aceita mais de 200 caracteres', async ({ page }) => {
      const point = await boardWithTitlePoint(page);

      await page.mouse.dblclick(point.x, point.y);
      await titleEditor(page).fill('x'.repeat(260));

      expect(await titleEditor(page).evaluate((el: HTMLInputElement) => el.value.length)).toBe(200);
    });

    test('US-BD.6: com o board bloqueado, o duplo clique no título não abre o editor', async ({
      page,
    }) => {
      const point = await boardWithTitlePoint(page);
      await sectionDispatch(page, { type: 'shape.update', id: 'b', patch: { locked: true } });

      await page.mouse.dblclick(point.x, point.y);

      await expect(titleEditor(page)).toHaveCount(0);
    });

    // Só os componentes: quem anuncia é o <canvas-surface>, que o Vanilla não tem.
    if (!variant.isVanilla) {
      test('US-BD.17: selecionar o board anuncia "Board <título> selecionado"', async ({
        page,
      }) => {
        await createBoardNode(
          page,
          { id: 'b', x: 100, y: 140, width: 300, height: 200, title: 'Fluxo' },
          [],
        );
        await selectIds(page, []);
        await selectIds(page, ['b']);

        await expect(page.locator('canvas-surface [aria-live="polite"]')).toHaveText(
          'Board Fluxo selecionado',
        );
      });
    }

    const part = (page: Page, name: string) => page.locator(`[part~="${name}"]`);

    /** O board `b` com o filho `child`, selecionado, e o painel de propriedades aberto. */
    async function openBoardPanel(page: Page): Promise<void> {
      await createShape(page, rect('child', 150, 180));
      await createBoardNode(
        page,
        { id: 'b', x: 100, y: 140, width: 300, height: 200, title: 'Fluxo' },
        ['child'],
      );
      await openPropertiesPanel(page, variant);
      await expect(part(page, 'section-board')).toBeVisible();
    }

    test('US-BD.10: o painel mostra a seção do board e grava título, fundo, opacidade e borda', async ({
      page,
    }) => {
      await openBoardPanel(page);

      await expect(part(page, 'input-board-title')).toHaveValue('Fluxo');

      await part(page, 'input-board-title').fill('Jornada');
      await part(page, 'input-board-title').press('Enter');
      await expect.poll(async () => (await boards(page))[0]?.title).toBe('Jornada');

      await part(page, 'input-board-fill').fill('#ff0000');
      await part(page, 'input-board-fill-opacity').fill('70');
      await part(page, 'input-board-fill-opacity').press('Enter');
      await expect
        .poll(async () => ((await boards(page))[0] as unknown as { style: object }).style)
        .toMatchObject({ fill: '#ff0000', fillOpacity: 0.7 });

      await part(page, 'button-board-stroke-none').click();
      await expect
        .poll(async () => ((await boards(page))[0] as unknown as { style: object }).style)
        .toMatchObject({ stroke: null });

      await part(page, 'button-board-fill-none').click();
      await expect
        .poll(async () => ((await boards(page))[0] as unknown as { style: object }).style)
        .toMatchObject({ fill: null });
    });
    // Só os componentes: o painel do Vanilla não tem seção de transformação nem de estilo.
    if (!variant.isVanilla) {
      test('US-BD.10: com board selecionado, section-transform não tem rotação nem conversões e não há section-style', async ({
        page,
      }) => {
        await openBoardPanel(page);

        await expect(part(page, 'section-transform')).toBeVisible();
        await expect(part(page, 'input-rotation')).toHaveCount(0);
        await expect(part(page, 'btn-convert-type')).toHaveCount(0);
        await expect(part(page, 'section-style')).toHaveCount(0);
      });
    }

    // Só os componentes: o painel do Vanilla não tem X, Y, largura nem altura.
    if (!variant.isVanilla) {
      test('US-BD.10: X do painel leva o board e o filho pelo mesmo vetor, e um undo desfaz', async ({
        page,
      }) => {
        await openBoardPanel(page);

        await part(page, 'input-x').fill('160');
        await part(page, 'input-x').press('Enter');

        await expect.poll(async () => (await boards(page))[0]?.x).toBe(160);
        expect((await childOf(page, 'child')).x).toBeCloseTo(210, 0);

        await focusCanvas(page);
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await boards(page))[0]?.x).toBe(100);
        expect((await childOf(page, 'child')).x).toBeCloseTo(150, 0);
      });
    }

    test('US-BD.10: com dois boards o título some, o estado é misto, e a mudança é uma só entrada de histórico', async ({
      page,
    }) => {
      await openBoardPanel(page);
      await createBoardNode(
        page,
        {
          id: 'b2',
          x: 500,
          y: 140,
          width: 200,
          height: 150,
          title: 'Outro',
          style: { fill: '#00ff00', fillOpacity: 0.5, stroke: '#112233' },
        },
        [],
      );
      await selectIds(page, ['b', 'b2']);

      await expect(part(page, 'section-board')).toBeVisible();
      await expect(part(page, 'input-board-title')).toBeHidden();
      await expect(part(page, 'input-board-fill-opacity')).toHaveValue('');

      await part(page, 'input-board-fill').fill('#123456');

      await expect
        .poll(async () =>
          (await boards(page)).map(
            (board) => (board as unknown as { style: { fill: string } }).style.fill,
          ),
        )
        .toEqual(['#123456', '#123456']);
      await focusCanvas(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(async () =>
          (await boards(page)).map(
            (board) => (board as unknown as { style: { fill: string } }).style.fill,
          ),
        )
        .not.toContain('#123456');
    });

    // O layout de ilhas do Vanilla abre o mesmo painel por um botão da toolbar.
    if (variant.isVanilla) {
      test('US-BD.10: no layout de ilhas do Vanilla a seção do board abre pelo botão Propriedades', async ({
        page,
      }) => {
        await openVariant(page, variant, { classic: false });
        await createBoardNode(
          page,
          { id: 'b', x: 100, y: 140, width: 300, height: 200, title: 'Fluxo' },
          [],
        );

        await openPropertiesPanel(page, variant);

        await expect(part(page, 'section-board')).toBeVisible();
        await expect(part(page, 'input-board-title')).toHaveValue('Fluxo');
      });
    }

    test('US-BD.10: com seleção mista os campos do board somem', async ({ page }) => {
      await openBoardPanel(page);
      await createShape(page, rect('out', 600, 200));
      await selectIds(page, ['b', 'out']);

      // O componente tira a seção do DOM; o Vanilla a esconde.
      await expect(part(page, 'section-board')).toBeHidden();
    });

    // Só os componentes: o painel genérico do Vanilla não age com mais de um nó.
    if (!variant.isVanilla) {
      test('US-BD.10: com seleção mista o painel genérico só age nos outros nós', async ({
        page,
      }) => {
        await openBoardPanel(page);
        await createShape(page, rect('out', 600, 200));
        await selectIds(page, ['b', 'out']);

        await expect(part(page, 'section-style')).toBeVisible();

        await part(page, 'input-x').fill('640');
        await part(page, 'input-x').press('Enter');

        await expect
          .poll(async () => ((await snapshot(page)).document.nodes['out'] as { x: number }).x)
          .toBe(640);
        expect((await boards(page))[0]!.x).toBe(100);
      });
    }

    // Só os componentes: o Vanilla não tem painel de camadas.
    if (!variant.isVanilla) {
      test('US-BD.11: o painel de camadas mostra o board com o título e os filhos aninhados, e subir só reordena no board', async ({
        page,
      }) => {
        await createShape(page, rect('c1', 150, 180));
        await createShape(page, rect('c2', 220, 180));
        await createBoardNode(
          page,
          { id: 'b', x: 100, y: 140, width: 300, height: 200, title: 'Fluxo' },
          ['c1', 'c2'],
        );
        await showShellPanels(page);
        const layers = page.locator('canvas-layers');
        const row = (id: string) => layers.locator(`[data-node-id="${id}"]`);

        await expect(row('b')).toContainText('Fluxo');
        const children = layers.locator('[data-parent-id="b"]');
        await expect(children).toHaveCount(2);
        // Da frente para o fundo: c2 (o último de childIds) vem antes de c1.
        await expect(children.nth(0)).toHaveAttribute('data-node-id', 'c2');
        await expect(children.nth(1)).toHaveAttribute('data-node-id', 'c1');
        await expect(row('c2').locator('[data-action="node-up"]')).toBeDisabled();
        await expect(row('c1').locator('[data-action="node-down"]')).toBeDisabled();

        const layerBefore = (await snapshot(page)).document.layers[0]!.childIds;
        await row('c1').locator('[data-action="node-up"]').click();

        await expect.poll(async () => (await boards(page))[0]?.childIds).toEqual(['c2', 'c1']);
        expect((await snapshot(page)).document.layers[0]!.childIds).toEqual(layerBefore);
        await expect(layers.locator('[data-parent-id="b"]').nth(0)).toHaveAttribute(
          'data-node-id',
          'c1',
        );
      });
    }
  });
}
