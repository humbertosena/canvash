import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  VARIANTS,
  canvasBox,
  createBoardNode,
  createShape,
  snapshot,
  type Variant,
} from '../helpers/canvas.js';
import {
  clickShare,
  colorNear,
  copiedLinks,
  dropNetwork,
  expectNode,
  holderColor,
  mySessionId,
  nodeIds,
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

// O board na colaboração (spec boards, US-BD.14 a US-BD.16), nos quatro exemplos: o documento, o
// bloqueio e a prévia do arrasto, com duas páginas por cenário e três para o desempate.

test.describe.configure({ timeout: 120_000 });

const BOARD = { id: 'b', x: 500, y: 250, width: 320, height: 200, title: 'Fluxo' };
const RECOVERY_LAYER_ID = '__recovery__';

interface SectionLike {
  dispatch(command: unknown): unknown;
  transact(commands: readonly unknown[]): unknown;
  getPeerLock(id: string): { sessionId: string } | undefined;
  getSnapshot(): {
    document: { layers: Array<{ id: string; childIds: readonly string[] }> };
  };
  setPreview(preview: unknown): unknown;
}

interface SessionLike {
  disconnect(): void;
  reconnect(): Promise<unknown>;
}

interface Holder {
  __CANVASH_PLAYGROUND__?: { section: SectionLike; getSession?: () => SessionLike | null };
  __CANVASH_REACT__?: { section: SectionLike; collab?: { getSession?: () => SessionLike | null } };
  __CANVASH_VUE__?: { section: SectionLike; collab?: { getSession?: () => SessionLike | null } };
  __CANVASH_WC__?: {
    canvas: { section?: SectionLike };
    collab?: { getSession?: () => SessionLike | null };
  };
}

const rect = (id: string, x: number, y: number, fill = '#334155') => ({
  id,
  type: 'rectangle',
  x,
  y,
  width: 80,
  height: 60,
  rotation: 0,
  style: { fill, stroke: null, strokeWidth: 0, opacity: 1 },
});

async function twoSessions(context: BrowserContext, variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  return { a, b };
}

async function threeSessions(context: BrowserContext, variant: Variant) {
  const { a, b } = await twoSessions(context, variant);
  const c = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(c);
  return { a, b, c };
}

/** Os comandos de A aplicados pelo host, numa só transação. */
function transactOn(page: Page, commands: readonly unknown[]): Promise<void> {
  return page.evaluate((list) => {
    const w = globalThis as unknown as Holder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    const result = section?.transact(list) as { ok: boolean } | undefined;
    if (!result?.ok) throw new Error(`transact recusado: ${JSON.stringify(result)}`);
  }, commands);
}

/** Tira a sessão do ar (as edições seguintes ficam pendentes) ou a devolve, reenviando-as. */
async function setOnline(page: Page, online: boolean): Promise<void> {
  await page.evaluate(async (value) => {
    const w = globalThis as unknown as Holder;
    const session =
      w.__CANVASH_PLAYGROUND__?.getSession?.() ??
      w.__CANVASH_REACT__?.collab?.getSession?.() ??
      w.__CANVASH_VUE__?.collab?.getSession?.() ??
      w.__CANVASH_WC__?.collab?.getSession?.();
    if (!session) throw new Error('Sessão de colaboração não encontrada');
    if (value) await session.reconnect();
    else session.disconnect();
  }, online);
}

/** Quem a página diz deter o nó (o `sessionId`), ou `null` se está livre. */
function holderSession(page: Page, id: string): Promise<string | null> {
  return page.evaluate((nodeId) => {
    const w = globalThis as unknown as Holder;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    return section?.getPeerLock(nodeId)?.sessionId ?? null;
  }, id);
}

/** A camada de recuperação da página e o que há nela. */
async function recoveryOf(page: Page): Promise<readonly string[] | undefined> {
  const { document } = await snapshot(page);
  return document.layers.find((layer) => layer.id === RECOVERY_LAYER_ID)?.childIds;
}

/**
 * O board `b` com os filhos `c` e `d`, criado em A numa só transação (a projeção de uma presença
 * remota pode reordenar as camadas entre duas chamadas) e já visível nas outras páginas, sem seleção.
 */
async function buildBoard(a: Page, others: readonly Page[]): Promise<void> {
  await a.evaluate(
    (input) => {
      const w = globalThis as unknown as Holder;
      const section =
        w.__CANVASH_PLAYGROUND__?.section ??
        w.__CANVASH_REACT__?.section ??
        w.__CANVASH_VUE__?.section ??
        w.__CANVASH_WC__?.canvas.section;
      if (!section) throw new Error('Canvas não encontrado');
      const layerId = section.getSnapshot().document.layers[0]!.id;
      const result = section.transact([
        { type: 'shape.create', layerId, shape: input.c },
        { type: 'shape.create', layerId, shape: input.d },
        { type: 'shape.create', layerId, shape: { type: 'board', ...input.board } },
        { type: 'board.attach', boardId: input.board.id, ids: ['c', 'd'] },
      ]) as { ok: boolean };
      if (!result.ok) throw new Error(`transact recusado: ${JSON.stringify(result)}`);
      (section as unknown as { setSelection(ids: string[]): void }).setSelection([]);
    },
    {
      c: rect('c', BOARD.x + 30, BOARD.y + 40),
      d: rect('d', BOARD.x + 170, BOARD.y + 40),
      board: BOARD,
    },
  );
  for (const page of others) {
    await expectNode(page, 'b');
    await expectNode(page, 'c');
    await expectNode(page, 'd');
  }
}

const boardOf = async (page: Page) =>
  (await snapshot(page)).document.nodes['b'] as unknown as {
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    childIds: string[];
    style: { fill: string | null; fillOpacity: number; stroke: string | null };
  };
const nodeOf = async (page: Page, id: string) =>
  (await snapshot(page)).document.nodes[id] as unknown as { x: number; y: number };

/** O ponto de tela, em B, do mundo `(x, y)` (viewport 0, 0, zoom 1). */
async function screenPoint(page: Page, variant: Variant, x: number, y: number) {
  const box = await canvasBox(page, variant);
  return { x: box.x + x, y: box.y + y };
}

for (const variant of VARIANTS) {
  test.describe(`Board na colaboração: ${variant.name}`, () => {
    test('US-BD.14: criar, mover, redimensionar, renomear, mudar a pertença e apagar chegam a B', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await buildBoard(a, [b]);
      expect(await boardOf(b)).toMatchObject({
        title: 'Fluxo',
        x: BOARD.x,
        width: BOARD.width,
        childIds: ['c', 'd'],
      });

      await transactOn(a, [
        { type: 'shape.update', id: 'b', patch: { x: BOARD.x + 50, y: BOARD.y + 20 } },
        { type: 'shape.update', id: 'c', patch: { x: BOARD.x + 80, y: BOARD.y + 60 } },
        { type: 'shape.update', id: 'd', patch: { x: BOARD.x + 220, y: BOARD.y + 60 } },
      ]);
      await expect.poll(async () => (await boardOf(b)).x).toBe(BOARD.x + 50);
      expect(await nodeOf(b, 'c')).toMatchObject({ x: BOARD.x + 80, y: BOARD.y + 60 });

      await transactOn(a, [
        { type: 'shape.update', id: 'b', patch: { width: 400, height: 260 } },
        { type: 'shape.update', id: 'b', patch: { title: 'Jornada' } },
      ]);
      await expect.poll(async () => (await boardOf(b)).title).toBe('Jornada');
      expect(await boardOf(b)).toMatchObject({ width: 400, height: 260, childIds: ['c', 'd'] });

      await transactOn(a, [{ type: 'board.detach', ids: ['d'] }]);
      await expect.poll(async () => (await boardOf(b)).childIds).toEqual(['c']);
      await transactOn(a, [{ type: 'board.attach', boardId: 'b', ids: ['d'] }]);
      await expect.poll(async () => (await boardOf(b)).childIds).toEqual(['c', 'd']);

      await transactOn(a, [{ type: 'shape.remove', id: 'b' }]);
      await expect.poll(async () => (await nodeIds(b)).includes('b')).toBe(false);
      expect(await nodeIds(b)).not.toContain('c');
      expect(await nodeIds(b)).not.toContain('d');
    });

    test('US-BD.14: o nó que B pôs num board que A apagou aparece na camada de recuperação', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      // O nó vem antes do board na camada: apagar o board não muda a posição dele.
      await createShape(a, rect('n', BOARD.x + 30, BOARD.y + 40));
      await createBoardNode(a, BOARD, []);
      await selectIds(a, []);
      await expectNode(b, 'n');
      await expectNode(b, 'b');

      // A apaga o board sem rede (o commit fica pendente) enquanto B põe o nó nele; depois a rede
      // de A volta e o commit pendente chega a B.
      await dropNetwork(a, true);
      await transactOn(a, [{ type: 'shape.remove', id: 'b' }]);
      await transactOn(b, [{ type: 'board.attach', boardId: 'b', ids: ['n'] }]);
      await dropNetwork(a, false);
      await setOnline(a, false);
      await setOnline(a, true);

      for (const page of [a, b]) {
        await expect.poll(() => recoveryOf(page)).toEqual(['n']);
        expect(await nodeIds(page)).not.toContain('b');
      }
    });

    test('US-BD.14: A e B soltam o mesmo nó em boards diferentes ao mesmo tempo e terminam com o nó no mesmo board', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createShape(a, rect('n', 100, 100));
      await createBoardNode(a, { ...BOARD, id: 'b1', title: 'Um' }, []);
      await createBoardNode(a, { ...BOARD, id: 'b2', x: BOARD.x + 400, title: 'Dois' }, []);
      await selectIds(a, []);
      for (const id of ['n', 'b1', 'b2']) await expectNode(b, id);

      await setOnline(a, false);
      await setOnline(b, false);
      await transactOn(a, [{ type: 'board.attach', boardId: 'b1', ids: ['n'] }]);
      await transactOn(b, [{ type: 'board.attach', boardId: 'b2', ids: ['n'] }]);
      await setOnline(a, true);
      await setOnline(b, true);

      const ownerOn = async (page: Page): Promise<string[]> => {
        const nodes = (await snapshot(page)).document.nodes as unknown as Record<
          string,
          { childIds?: string[] }
        >;
        return ['b1', 'b2'].filter((id) => nodes[id]?.childIds?.includes('n'));
      };
      await expect.poll(async () => (await ownerOn(a)).length).toBe(1);
      await expect.poll(async () => (await ownerOn(b)).length).toBe(1);
      expect(await ownerOn(a)).toEqual(await ownerOn(b));
    });

    test('US-BD.15: com um filho selecionado por A, em B o board não se move nem é apagado, e o contorno de A marca o filho', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await buildBoard(a, [b]);
      await selectIds(a, ['c']);
      await expect.poll(() => holderSession(b, 'c')).not.toBeNull();
      expect(await holderSession(b, 'b')).toBeNull();
      const color = (await holderColor(b, 'c'))!;
      // O contorno de 2 px no meio da borda esquerda do filho.
      await expect.poll(() => colorNear(b, BOARD.x + 30, BOARD.y + 40 + 30, color, 3)).toBe(true);

      await selectIds(b, ['b']);
      const title = await screenPoint(b, variant, BOARD.x + 120, BOARD.y - 12);
      await b.mouse.move(title.x, title.y);
      await b.mouse.down();
      await b.mouse.move(title.x + 80, title.y + 50, { steps: 6 });
      await b.mouse.up();
      expect(await boardOf(b)).toMatchObject({ x: BOARD.x, y: BOARD.y });
      expect(await nodeOf(b, 'c')).toMatchObject({ x: BOARD.x + 30 });

      await b.evaluate(() => {
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus();
      });
      await b.keyboard.press('ArrowRight');
      await b.keyboard.press('Delete');
      expect(await boardOf(b)).toMatchObject({ x: BOARD.x, y: BOARD.y });
      expect(await nodeIds(b)).toContain('b');
      expect(await nodeIds(b)).toContain('c');
    });

    test('US-BD.15: com o board selecionado por A, em B nem o board nem os filhos são selecionáveis', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await buildBoard(a, [b]);
      await selectIds(a, ['b']);
      for (const id of ['b', 'c', 'd']) {
        await expect.poll(() => holderSession(b, id)).not.toBeNull();
      }

      const child = await screenPoint(b, variant, BOARD.x + 70, BOARD.y + 70);
      await b.mouse.click(child.x, child.y);
      expect(await selectedOf(b)).toEqual([]);
      const title = await screenPoint(b, variant, BOARD.x + 120, BOARD.y - 12);
      await b.mouse.click(title.x, title.y);
      expect(await selectedOf(b)).toEqual([]);

      const from = await screenPoint(b, variant, BOARD.x - 40, BOARD.y - 60);
      const to = await screenPoint(b, variant, BOARD.x + BOARD.width + 40, BOARD.y + 260);
      await b.mouse.move(from.x, from.y);
      await b.mouse.down();
      await b.mouse.move(to.x, to.y, { steps: 8 });
      await b.mouse.up();
      expect(await selectedOf(b)).toEqual([]);
    });

    test('US-BD.15: board primeiro, A vence o board e o filho, e B, C e A veem o mesmo vencedor', async ({
      context,
    }) => {
      const { a, b, c } = await threeSessions(context, variant);
      await buildBoard(a, [b, c]);
      const [aId] = await Promise.all([mySessionId(a), mySessionId(b), mySessionId(c)]);
      await shiftSelectedAt(a, -2000);
      await shiftSelectedAt(b, -1000);

      await selectIds(a, ['b']);
      await expect.poll(() => holderSession(b, 'c')).toBe(aId);
      await selectIds(b, ['c']);

      await expect.poll(() => selectedOf(b)).toEqual([]);
      expect(await selectedOf(a)).toEqual(['b']);
      await expect.poll(() => holderSession(c, 'c')).toBe(aId);
      await expect.poll(() => holderSession(b, 'c')).toBe(aId);
      expect(await holderSession(a, 'c')).toBeNull();
    });

    test('US-BD.15: filho primeiro, B vence o filho e A só o board, e A, B e C veem o mesmo vencedor', async ({
      context,
    }) => {
      const { a, b, c } = await threeSessions(context, variant);
      await buildBoard(a, [b, c]);
      const [aId, bId] = await Promise.all([mySessionId(a), mySessionId(b), mySessionId(c)]);
      await shiftSelectedAt(b, -2000);
      await shiftSelectedAt(a, -1000);

      await selectIds(b, ['c']);
      await expect.poll(() => holderSession(a, 'c')).toBe(bId);
      await selectIds(a, ['b']);

      // A mantém o board selecionado; o filho de B fica livre para B e travado para A e C.
      await expect.poll(() => holderSession(c, 'd')).toBe(aId);
      expect(await selectedOf(a)).toEqual(['b']);
      expect(await selectedOf(b)).toEqual(['c']);
      await expect.poll(() => holderSession(c, 'c')).toBe(bId);
      expect(await holderSession(a, 'c')).toBe(bId);
      expect(await holderSession(b, 'c')).toBeNull();
      expect(await holderSession(b, 'd')).toBe(aId);
    });

    test('US-BD.16: enquanto A arrasta o board, B vê a prévia do board e do filho na cor de A, e nada entra no documento', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await buildBoard(a, [b]);
      await selectIds(a, ['b']);
      await expect.poll(() => holderSession(b, 'c')).not.toBeNull();
      const color = (await holderColor(b, 'c'))!;
      const before = JSON.stringify((await snapshot(b)).document);
      const revision = (await snapshot(b)).revision;

      // O arrasto de A: o preview do board e dos filhos deslocados juntos por 300.
      await a.evaluate(
        (input) => {
          const w = globalThis as unknown as Holder;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          const nodes = (
            section as unknown as {
              getSnapshot(): { document: { nodes: Record<string, Record<string, unknown>> } };
            }
          ).getSnapshot().document.nodes;
          const updates = input.ids.map((id) => {
            const node = nodes[id]!;
            const moved: Record<string, unknown> = { ...node, x: (node['x'] as number) + input.dx };
            if (node['type'] !== 'board') return moved;
            // O preview de um board não leva a lista de filhos.
            delete moved['childIds'];
            return moved;
          });
          section?.setPreview({ updates });
        },
        { ids: ['b', 'c', 'd'], dx: -380 },
      );

      await expect
        .poll(async () => (await peersOf(b))[0]?.drag?.ids.slice().sort())
        .toEqual(['b', 'c', 'd']);
      // A moldura do board, deslocada: a borda esquerda vai de x = 500 para x = 120.
      await expect
        .poll(() => colorNear(b, BOARD.x - 380, BOARD.y + BOARD.height / 2, color, 3))
        .toBe(true);
      // O filho deslocado: a borda esquerda dele vai de x = 530 para x = 150.
      await expect
        .poll(() => colorNear(b, BOARD.x + 30 - 380, BOARD.y + 40 + 30, color, 3))
        .toBe(true);

      expect(JSON.stringify((await snapshot(b)).document)).toBe(before);
      expect((await snapshot(b)).revision).toBe(revision);
      expect(await boardOf(b)).toMatchObject({ x: BOARD.x });

      await a.evaluate(() => {
        const w = globalThis as unknown as Holder;
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setPreview(null);
      });
      await expect.poll(async () => (await peersOf(b))[0]?.drag ?? null).toBeNull();
    });
  });
}
