import { expect, test, type Page } from '@playwright/test';
import { VARIANTS, canvasBox, createShape, snapshot, type Variant } from '../helpers/canvas.js';
import {
  clickShare,
  copiedLinks,
  dropNetwork,
  expectNode,
  lockHolder,
  mySessionId,
  nodeIds,
  notice,
  openCollabPage,
  openFromLink,
  peersOf,
  resetViewport,
  selectedOf,
  selectIds,
  shiftSelectedAt,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';
import { showShellPanels } from '../helpers/shell.js';

/** Onde o nó de teste fica, em mundo: longe do fixture e das ilhas, no viewport padrão. */
const NODE = { x: 700, y: 420, width: 120, height: 80 };

async function addNode(page: Page, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await createShape(page, {
    id,
    type: 'rectangle',
    ...NODE,
    rotation: 0,
    style: { fill: '#2563eb', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
    ...extra,
  });
  await selectIds(page, []);
}

/** Dois participantes na mesma sala, com o mesmo nó nos dois quadros. */
async function twoSessions(context: Parameters<typeof openCollabPage>[0], variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  return { a, b };
}

async function screenOf(page: Page, variant: Variant, dx = 0, dy = 0) {
  const box = await canvasBox(page, variant);
  return { x: box.x + NODE.x + NODE.width / 2 + dx, y: box.y + NODE.y + NODE.height / 2 + dy };
}

const holderOf = (page: Page, id: string) => () => lockHolder(page, id);

// As jornadas abrem de duas a três páginas por teste: com a máquina carregada passam de 30 s.
test.describe.configure({ timeout: 90_000 });

for (const variant of VARIANTS) {
  test.describe(`Bloqueio remoto: ${variant.name}`, () => {
    test('US-RL.1: o que A seleciona fica bloqueado em B (clique, arrasto, Delete e marquee)', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addNode(a, 'alvo');
      await expectNode(b, 'alvo');

      await selectIds(a, ['alvo']);
      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();

      const point = await screenOf(b, variant);
      await b.mouse.click(point.x, point.y);
      expect(await selectedOf(b)).toEqual([]);

      await b.mouse.move(point.x, point.y);
      await b.mouse.down();
      await b.mouse.move(point.x + 60, point.y + 40, { steps: 6 });
      await b.mouse.up();
      const moved = (await snapshot(b)).document.nodes['alvo'] as { x: number; y: number };
      expect(moved.x).toBe(NODE.x);
      expect(moved.y).toBe(NODE.y);

      await b.keyboard.press('Delete');
      expect(await nodeIds(b)).toContain('alvo');

      const box = await canvasBox(b, variant);
      await b.mouse.move(box.x + NODE.x - 30, box.y + NODE.y - 30);
      await b.mouse.down();
      await b.mouse.move(box.x + NODE.x + NODE.width + 30, box.y + NODE.y + NODE.height + 30, {
        steps: 6,
      });
      await b.mouse.up();
      expect(await selectedOf(b)).not.toContain('alvo');
    });

    // O Vanilla não tem lista de camadas: a jornada vale para os exemplos com <canvas-layers>.
    if (!variant.isVanilla) {
      test('US-RL.2: a lista de camadas de B mostra o cadeado do nó que A seleciona', async ({
        context,
      }) => {
        const { a, b } = await twoSessions(context, variant);
        await addNode(a, 'alvo');
        await expectNode(b, 'alvo');
        await showShellPanels(b);

        await selectIds(a, ['alvo']);

        await expect(b.locator('canvas-layers [part~="node-peer-lock"]')).toHaveCount(1);
        await selectIds(a, []);
        await expect(b.locator('canvas-layers [part~="node-peer-lock"]')).toHaveCount(0);
      });
    }

    test('US-RL.3: A desseleciona, fecha a aba ou expira e o nó fica livre em B', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addNode(a, 'alvo');
      await expectNode(b, 'alvo');

      await selectIds(a, ['alvo']);
      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();
      await selectIds(a, []);
      await expect.poll(holderOf(b, 'alvo')).toBeNull();

      await selectIds(a, ['alvo']);
      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();
      await a.close({ runBeforeUnload: true });
      await expect.poll(holderOf(b, 'alvo'), { timeout: 2000 }).toBeNull();
    });

    test('US-RL.3: sem notícias de A, o bloqueio expira com o timeout curto', async ({
      context,
    }) => {
      const room = `${uniqueRoom()}&presenceTimeout=1500`;
      const a = await openCollabPage(context, variant, { room });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      await addNode(a, 'alvo');
      await expectNode(b, 'alvo');
      await selectIds(a, ['alvo']);
      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();

      await dropNetwork(a, true);

      await expect.poll(holderOf(b, 'alvo'), { timeout: 8000 }).toBeNull();
    });

    test('US-RL.4: três sessões selecionam o mesmo nó e todas concordam sobre quem o detém', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      const c = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      await resetViewport(c);
      await addNode(a, 'alvo');
      await expectNode(b, 'alvo');
      await expectNode(c, 'alvo');
      await shiftSelectedAt(a, -2000);
      await shiftSelectedAt(b, -1000);
      const pages = [a, b, c];
      const ids = await Promise.all(pages.map((page) => mySessionId(page)));

      await Promise.all(pages.map((page) => selectIds(page, ['alvo'])));

      // Quem selecionou "antes" (A) fica com o nó; B e C o perdem e veem o bloqueio de A.
      await expect.poll(() => selectedOf(a)).toEqual(['alvo']);
      await expect.poll(() => selectedOf(b)).toEqual([]);
      await expect.poll(() => selectedOf(c)).toEqual([]);
      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();
      await expect.poll(holderOf(c, 'alvo')).not.toBeNull();
      const aId = ids[0]!;
      const peerOfA = (await peersOf(b)).find((peer) => peer.sessionId === aId);
      expect(peerOfA?.selection).toEqual(['alvo']);
      await expect(notice(b)).toContainText('já está editando este elemento');
    });

    test('US-RL.5: B perde o bloqueio no meio de um arrasto e nada é confirmado', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addNode(a, 'alvo');
      await expectNode(b, 'alvo');
      await shiftSelectedAt(a, -60_000);
      await expect.poll(holderOf(b, 'alvo')).toBeNull();
      const point = await screenOf(b, variant);
      await b.mouse.click(point.x, point.y);
      await expect.poll(() => selectedOf(b)).toEqual(['alvo']);
      await b.mouse.move(point.x, point.y);
      await b.mouse.down();
      await b.mouse.move(point.x + 40, point.y + 30, { steps: 4 });
      const revision = (await snapshot(b)).revision;

      await selectIds(a, ['alvo']);

      await expect.poll(holderOf(b, 'alvo')).not.toBeNull();
      await b.mouse.move(point.x + 80, point.y + 60, { steps: 4 });
      await b.mouse.up();
      const node = (await snapshot(b)).document.nodes['alvo'] as { x: number; y: number };
      expect(node.x).toBe(NODE.x);
      expect(node.y).toBe(NODE.y);
      expect((await snapshot(b)).revision).toBe(revision);
      await expect(notice(b)).toContainText('já está editando este elemento');
    });

    test('US-RL.6: o texto de A só chega a B quando a edição termina; Esc não envia nada', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createShape(a, {
        id: 'texto',
        type: 'text',
        ...NODE,
        width: 220,
        text: 'Original',
        fontSize: 18,
      });
      await selectIds(a, []);
      await expectNode(b, 'texto');
      await expect.poll(holderOf(b, 'texto')).toBeNull();
      const textOf = async (page: Page) =>
        ((await snapshot(page)).document.nodes['texto'] as unknown as { text: string }).text;

      const point = await screenOf(a, variant, -40, -20);
      await a.mouse.dblclick(point.x, point.y);
      await expect(a.locator('textarea[data-testid="canvash-text-editor"]')).toHaveCount(1);
      await a.keyboard.type('Digitando devagar');
      await expect.poll(holderOf(b, 'texto')).not.toBeNull();
      await a.waitForTimeout(300);
      expect(await textOf(b)).toBe('Original');

      await a.keyboard.press('Control+Enter');
      await expect.poll(() => textOf(b)).toBe('Digitando devagar');

      await a.mouse.dblclick(point.x, point.y);
      await a.keyboard.type('Descartado');
      await a.keyboard.press('Escape');
      await a.waitForTimeout(300);
      expect(await textOf(b)).toBe('Digitando devagar');
    });

    test('US-RL.7: B perde a edição do texto, o aviso aparece e "Copiar meu texto" copia o buffer', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createShape(a, {
        id: 'texto',
        type: 'text',
        ...NODE,
        width: 220,
        text: 'Original',
        fontSize: 18,
      });
      await selectIds(a, []);
      await expectNode(b, 'texto');
      await shiftSelectedAt(a, -60_000);
      await expect.poll(holderOf(b, 'texto')).toBeNull();
      const point = await screenOf(b, variant, -40, -20);
      await b.mouse.dblclick(point.x, point.y);
      await expect(b.locator('textarea[data-testid="canvash-text-editor"]')).toHaveCount(1);
      await b.keyboard.type('Meu rascunho');

      await selectIds(a, ['texto']);

      await expect(b.locator('textarea[data-testid="canvash-text-editor"]')).toHaveCount(0);
      const supersededNotice = b.locator('[data-testid="superseded-notice"]');
      await expect(supersededNotice).toContainText('já está editando este elemento');
      await supersededNotice.locator('[data-testid="copy-my-text"]').click();
      expect(
        await b.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1)),
      ).toBe('Meu rascunho');
      const text = ((await snapshot(b)).document.nodes['texto'] as unknown as { text: string })
        .text;
      expect(text).toBe('Original');
    });

    test('US-RL.9: um nó de grupo selecionado por A bloqueia o membro isolado em B', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await addNode(a, 'membro');
      await addNode(a, 'irmao', { x: NODE.x + 160 });
      await expectNode(b, 'irmao');
      const grouped = await a.evaluate(() => {
        const w = window as unknown as {
          __CANVASH_PLAYGROUND__?: { section: { dispatch(c: unknown): { ok: boolean } } };
          __CANVASH_REACT__?: { section: { dispatch(c: unknown): { ok: boolean } } };
          __CANVASH_VUE__?: { section: { dispatch(c: unknown): { ok: boolean } } };
          __CANVASH_WC__?: { canvas: { section?: { dispatch(c: unknown): { ok: boolean } } } };
        };
        const section =
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section;
        return section?.dispatch({
          type: 'group.create',
          id: 'grupo',
          childIds: ['membro', 'irmao'],
        }).ok;
      });
      expect(grouped).toBe(true);
      await expect
        .poll(async () => Object.keys((await snapshot(b)).document.nodes))
        .toContain('grupo');

      await selectIds(a, ['grupo']);
      await expect.poll(holderOf(b, 'membro')).not.toBeNull();

      const point = await screenOf(b, variant);
      await b.mouse.click(point.x, point.y);
      expect(await selectedOf(b)).toEqual([]);
    });
  });
}
