import { expect, test, type Page } from '@playwright/test';
import { VARIANTS, canvasBox, createShape, snapshot, type Variant } from '../helpers/canvas.js';
import {
  canvasPixel,
  clickShare,
  colorNear,
  commitMove,
  copiedLinks,
  expectNode,
  holderColor,
  openCollabPage,
  openFromLink,
  peersOf,
  previewMove,
  previewMoveMany,
  resetViewport,
  selectedOf,
  selectIds,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';

test.describe.configure({ timeout: 90_000 });

const NODE = { x: 500, y: 300, width: 120, height: 80 };
const FILL = '#334155';

async function addRect(
  page: Page,
  id: string,
  x: number,
  y: number,
  w = NODE.width,
  h = NODE.height,
) {
  await createShape(page, {
    id,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    style: { fill: FILL, stroke: null, strokeWidth: 0, opacity: 1 },
  });
  await selectIds(page, []);
}

async function twoSessions(context: Parameters<typeof openCollabPage>[0], variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  return { a, b };
}

/** Espera A ter a cor conhecida em B e devolve-a. */
/** O arrasto que A publica, como B o vê, ou `null`. */
async function peersOfDrag(b: Page): Promise<unknown> {
  return (await peersOf(b))[0]?.drag ?? null;
}

async function colorOfA(a: Page, b: Page): Promise<string> {
  await expect.poll(() => holderColor(b, 'alvo')).not.toBeNull();
  // Uma segunda leitura solta pode pegar o lock já liberado (null) e quebrar o `colorNear` adiante:
  // a cor devolvida é a que a própria espera viu.
  let color: string | null = null;
  await expect.poll(async () => (color = await holderColor(b, 'alvo'))).not.toBeNull();
  return color!;
}

for (const variant of VARIANTS) {
  test.describe(`Prévia do arrasto remoto: ${variant.name}`, () => {
    test('US-DP.1: B vê o contorno acompanhando o arrasto de A, sem preenchimento e com a forma real parada', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addRect(a, 'alvo', NODE.x, NODE.y);
      await expectNode(b, 'alvo');
      await selectIds(a, ['alvo']);
      const color = await colorOfA(a, b);
      const midY = NODE.y + NODE.height / 2;

      for (const dx of [200, 300, 400]) {
        await previewMove(a, { id: 'alvo', dx, dy: 0 });
        await expect.poll(() => colorNear(b, NODE.x + dx, midY, color, 3)).toBe(true);
        // Sem preenchimento: o miolo do contorno não ganha a cor da forma (fundo transparente ou claro).
        const inside = await canvasPixel(b, NODE.x + dx + NODE.width / 2, midY);
        expect(inside[3] === 0 || inside[0] > 150).toBe(true);
        // A forma real de B não saiu do lugar.
        expect(
          (await snapshot(b)).document.nodes['alvo'] as unknown as { x: number },
        ).toMatchObject({
          x: NODE.x,
        });
        expect((await canvasPixel(b, NODE.x + NODE.width / 2, midY))[0]).toBeLessThan(90);
      }
    });

    test('US-DP.2: ao soltar, a forma vai para a posição final e o contorno some, nas duas ordens', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addRect(a, 'alvo', NODE.x, NODE.y);
      await expectNode(b, 'alvo');
      await selectIds(a, ['alvo']);
      const color = await colorOfA(a, b);
      const midY = NODE.y + NODE.height / 2;
      const nodeX = async () =>
        ((await snapshot(b)).document.nodes['alvo'] as unknown as { x: number }).x;

      // Ordem 1: o commit chega antes do fim do gesto.
      await previewMove(a, { id: 'alvo', dx: 200, dy: 0 });
      await expect.poll(() => colorNear(b, NODE.x + 200, midY, color, 3)).toBe(true);
      await commitMove(a, ['alvo'], 200, 0);
      await previewMove(a, null);
      await expect.poll(nodeX).toBe(NODE.x + 200);
      await expect
        .poll(() => canvasPixel(b, NODE.x + 200 + 60, midY).then((p) => p[0]))
        .toBeLessThan(90);
      await expect.poll(() => colorNear(b, NODE.x + 400, midY, color, 3)).toBe(false);

      // Ordem 2: o gesto termina antes do commit.
      await expect.poll(async () => (await peersOfDrag(b)) === null).toBe(true);
      await previewMove(a, { id: 'alvo', dx: 200, dy: 0 });
      await expect.poll(() => colorNear(b, NODE.x + 400, midY, color, 3)).toBe(true);
      await previewMove(a, null);
      await commitMove(a, ['alvo'], 200, 0);
      await expect.poll(nodeX).toBe(NODE.x + 400);
      await expect.poll(() => colorNear(b, NODE.x + 600, midY, color, 3)).toBe(false);
    });

    test('US-DP.3: Esc em A remove o contorno em B e a forma de B não se move', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addRect(a, 'alvo', NODE.x, NODE.y);
      await expectNode(b, 'alvo');
      const box = await canvasBox(a, variant);
      const start = { x: box.x + NODE.x + 60, y: box.y + NODE.y + 40 };
      await a.mouse.click(start.x, start.y);
      await expect.poll(() => selectedOf(a)).toEqual(['alvo']);
      const color = await colorOfA(a, b);
      const midY = NODE.y + NODE.height / 2;

      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 200, start.y, { steps: 8 });
      await expect.poll(() => colorNear(b, NODE.x + 200, midY, color, 4)).toBe(true);

      await a.keyboard.press('Escape');
      await a.mouse.up();

      await expect.poll(() => colorNear(b, NODE.x + 200, midY, color, 4)).toBe(false);
      expect(((await snapshot(b)).document.nodes['alvo'] as unknown as { x: number }).x).toBe(
        NODE.x,
      );
    });

    test('US-DP.4: texto e nota mostram um retângulo e a tinta uma polilinha', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createShape(a, {
        id: 'texto',
        type: 'text',
        x: 100,
        y: 120,
        width: 200,
        text: 'Olá mundo',
        fontSize: 18,
      });
      await createShape(a, {
        id: 'nota',
        type: 'sticky',
        x: 100,
        y: 300,
        width: 160,
        height: 120,
        text: 'Nota',
      });
      await createShape(a, {
        id: 'tinta',
        type: 'ink',
        strokes: [
          {
            points: Array.from({ length: 300 }, (_, i) => ({
              x: 100 + i,
              y: 520 + Math.sin(i / 8) * 4,
            })),
          },
        ],
      });
      await selectIds(a, []);
      await expectNode(b, 'tinta');
      await selectIds(a, ['texto']);
      const color = await (async () => {
        await expect.poll(() => holderColor(b, 'texto')).not.toBeNull();
        return (await holderColor(b, 'texto'))!;
      })();

      // Texto: contorno retangular deslocado; o texto em si não é desenhado como tal.
      await previewMove(a, { id: 'texto', dx: 500, dy: 0 });
      await expect.poll(() => colorNear(b, 100 + 500, 130, color, 4)).toBe(true);
      await previewMove(a, null);

      // Nota: idem.
      await selectIds(a, ['nota']);
      await expect.poll(() => holderColor(b, 'nota')).not.toBeNull();
      await previewMove(a, { id: 'nota', dx: 500, dy: 0 });
      await expect.poll(() => colorNear(b, 100 + 500, 360, color, 4)).toBe(true);
      await previewMove(a, null);

      // Tinta: uma linha fina ao longo do traço deslocado, sem caixa em volta.
      await selectIds(a, ['tinta']);
      await expect.poll(() => holderColor(b, 'tinta')).not.toBeNull();
      await previewMove(a, { id: 'tinta', dx: 400, dy: 0 });
      await expect.poll(() => colorNear(b, 100 + 400 + 150, 520, color, 1)).toBe(true);
      expect(await colorNear(b, 100 + 400 + 150, 520 - 40, color, 1)).toBe(false);
    });

    test('US-DP.5: com 25 nós aparece só a caixa da união, tracejada', async ({ context }) => {
      const { a, b } = await twoSessions(context, variant);
      const ids: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const id = `n${i}`;
        ids.push(id);
        await addRect(a, id, 60 + (i % 5) * 90, 80 + Math.floor(i / 5) * 70, 70, 50);
      }
      await expectNode(b, 'n24');
      await selectIds(a, ids);
      await expect.poll(() => holderColor(b, 'n0')).not.toBeNull();
      const color = (await holderColor(b, 'n0'))!;

      await previewMoveMany(a, { ids, dx: 600, dy: 0 });

      // Borda esquerda da caixa da união, deslocada: x = 60 + 600, a meio da altura.
      await expect.poll(() => colorNear(b, 60 + 600, 80 + 130, color, 4)).toBe(true);
      // Nenhum contorno individual dentro dela: a borda do 2º nó da fila (x = 150 + 600) está limpa.
      expect(await colorNear(b, 150 + 600, 80 + 25, color, 2)).toBe(false);
    });
  });
}
