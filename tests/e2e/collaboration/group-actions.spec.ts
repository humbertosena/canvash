import { expect, test, type Page } from '@playwright/test';
import { VARIANTS, canvasBox, createShape, snapshot, type Variant } from '../helpers/canvas.js';
import {
  clickShare,
  copiedLinks,
  expectNode,
  lockHolder,
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

// Agrupar e Desagrupar com duas sessões na mesma sala (spec group-actions, US-GA.8): o nó que outra
// sessão seleciona não entra no grupo, e o menu de quem olha se atualiza sem a seleção mudar.

/** Retângulos lado a lado, longe do fixture e das ilhas, no viewport padrão: r1 a r4. */
const NODES = [
  { id: 'r1', x: 620 },
  { id: 'r2', x: 740 },
  { id: 'r3', x: 860 },
  { id: 'r4', x: 980 },
] as const;
const Y = 420;
const SIZE = { width: 100, height: 80 };

async function twoSessions(context: Parameters<typeof openCollabPage>[0], variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  for (const node of NODES) {
    await createShape(a, {
      id: node.id,
      type: 'rectangle',
      x: node.x,
      y: Y,
      ...SIZE,
      rotation: 0,
      style: { fill: '#2563eb', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
    });
  }
  await selectIds(a, []);
  for (const node of NODES) await expectNode(b, node.id);
  // A presença de A já diz que ele não seleciona nada: nenhum nó começa bloqueado em B.
  await expect
    .poll(async () => (await peersOf(b)).every((peer) => peer.selection.length === 0))
    .toBe(true);
  return { a, b };
}

/** Os botões de grupo do mini-menu da página: o HTML do Vanilla ou o <canvas-selection-menu>. */
function menuOf(page: Page, variant: Variant) {
  if (variant.isVanilla) {
    const menu = page.locator('#selection-menu');
    return {
      menu,
      buttons: menu.locator('button'),
      group: page.locator('#btn-selection-group'),
      ungroup: page.locator('#btn-selection-ungroup'),
    };
  }
  const host = page.locator('canvas-selection-menu');
  return {
    menu: host.locator('[part~="selection-menu"]'),
    buttons: host.locator('button'),
    group: host.locator('[part~="selection-action-group"]'),
    ungroup: host.locator('[part~="selection-action-ungroup"]'),
  };
}

/** Os grupos do documento da página: id → filhos, ordenados. */
async function groupsOf(page: Page): Promise<Record<string, string[]>> {
  const nodes = (await snapshot(page)).document.nodes as Record<
    string,
    { type: string; childIds?: string[] }
  >;
  const groups: Record<string, string[]> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'group') groups[id] = [...(node.childIds ?? [])].sort();
  }
  return groups;
}

/** Cria um grupo pela API da página, como o host, e devolve o ID dele. */
async function createGroup(page: Page, id: string, childIds: readonly string[]): Promise<void> {
  await page.evaluate(
    ({ groupId, children }) => {
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
      const res = section?.dispatch({ type: 'group.create', id: groupId, childIds: children });
      if (!res?.ok) throw new Error('grupo recusado');
    },
    { groupId: id, children: childIds },
  );
}

const holderOf = (page: Page, id: string) => () => lockHolder(page, id);

/** O foco no canvas, para os atalhos valerem. */
const focusCanvas = (page: Page) =>
  page.evaluate(() =>
    (
      (document.querySelector('canvas-surface') ??
        document.querySelector('#canvas-container')) as HTMLElement
    ).focus(),
  );

// As jornadas abrem duas páginas por teste: com a máquina carregada passam de 30 s.
test.describe.configure({ timeout: 90_000 });

for (const variant of VARIANTS) {
  test.describe(`Agrupar e Desagrupar em colaboração: ${variant.name}`, () => {
    test('US-GA.8: o que A seleciona fica fora do grupo que B cria pela marquee, e A recebe o grupo', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await selectIds(a, ['r1']);
      await expect.poll(holderOf(b, 'r1')).not.toBeNull();

      // Marquee de B sobre r1, r2 e r3: só r2 e r3 são livres.
      const box = await canvasBox(b, variant);
      await b.mouse.move(box.x + 600, box.y + Y - 30);
      await b.mouse.down();
      await b.mouse.move(box.x + 980, box.y + Y + SIZE.height + 30, { steps: 8 });
      await b.mouse.up();
      expect((await selectedOf(b)).sort()).toEqual(['r2', 'r3']);

      const { group, buttons } = menuOf(b, variant);
      await expect(group).toBeVisible();
      await expect(buttons).toHaveCount(4);
      await group.click();

      await expect.poll(async () => Object.values(await groupsOf(b))).toEqual([['r2', 'r3']]);
      // A recebe o grupo, e r1 segue solto.
      await expect.poll(async () => Object.values(await groupsOf(a))).toEqual([['r2', 'r3']]);
      expect(Object.values(await groupsOf(b)).flat()).not.toContain('r1');
    });

    test('US-GA.8: um grupo que A seleciona esconde Agrupar e Desagrupar na seleção de B', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createGroup(a, 'g', ['r2', 'r3']);
      await expect.poll(async () => Object.keys(await groupsOf(b))).toEqual(['g']);

      await selectIds(a, ['g']);
      await expect.poll(holderOf(b, 'g')).not.toBeNull();
      await selectIds(b, ['g', 'r4']);

      const { menu, buttons, group, ungroup } = menuOf(b, variant);
      await expect(menu).toBeVisible();
      // Só r4 é livre: os dois botões de grupo somem, e o menu volta aos três de sempre.
      await expect(buttons).toHaveCount(3);
      await expect(group).toHaveCount(0);
      await expect(ungroup).toHaveCount(0);
      // O canvas de B não deixa selecionar o que A deteve antes: sobra r4.
      expect(await selectedOf(b)).toEqual(['r4']);
    });

    test('US-GA.8: B desfaz dois grupos de uma vez, e um único undo restaura os dois nas duas sessões', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createGroup(b, 'ga', ['r1', 'r2']);
      await createGroup(b, 'gb', ['r3', 'r4']);
      await expect.poll(async () => Object.keys(await groupsOf(a)).sort()).toEqual(['ga', 'gb']);

      await selectIds(b, ['ga', 'gb']);
      const { ungroup } = menuOf(b, variant);
      await expect(ungroup).toBeVisible();
      await ungroup.click();

      await expect.poll(async () => Object.keys(await groupsOf(b))).toEqual([]);
      await expect.poll(async () => Object.keys(await groupsOf(a))).toEqual([]);

      await focusCanvas(b);
      await b.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => Object.keys(await groupsOf(b)).sort()).toEqual(['ga', 'gb']);
      await expect.poll(async () => Object.keys(await groupsOf(a)).sort()).toEqual(['ga', 'gb']);
    });

    test('US-GA.8: quando A passa a deter um nó da seleção de B, o menu de B se atualiza', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await selectIds(b, ['r2', 'r3']);
      const { menu, buttons, group } = menuOf(b, variant);
      await expect(menu).toBeVisible();
      await expect(buttons).toHaveCount(4);
      await expect(group).toBeVisible();

      // A passa a deter r2: a seleção dele "é mais antiga" que a de B, então vale a dele.
      await shiftSelectedAt(a, -60_000);
      await selectIds(a, ['r2']);
      await expect.poll(holderOf(b, 'r2')).not.toBeNull();

      // B perde r2 da seleção; só r3 é livre, e Agrupar some do menu de B.
      await expect.poll(() => selectedOf(b)).toEqual(['r3']);
      await expect(buttons).toHaveCount(3);
      await expect(group).toHaveCount(0);

      // Liberado o nó, B volta a poder agrupar.
      await selectIds(a, []);
      await expect.poll(holderOf(b, 'r2')).toBeNull();
      await selectIds(b, ['r2', 'r3']);
      await expect(buttons).toHaveCount(4);
      await expect(group).toBeVisible();
    });
  });
}
