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
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';
import { openPropertiesPanel } from '../helpers/shell.js';

// Texto dentro das formas com duas sessões na mesma sala (spec shape-label, US-SL.14 e US-SL.10):
// quem edita o texto mantém a forma selecionada, então a outra sessão vê o bloqueio e o texto
// antigo, e nada sai do Y.Doc até o commit.

const EDITOR = 'textarea[data-testid="canvash-text-editor"]';
const SHAPE = { id: 's', x: 620, y: 420, width: 100, height: 80 } as const;

interface YDocLike {
  getMap(name: string): { get(id: string): { get(key: string): unknown } | undefined };
  on(event: 'update', handler: () => void): void;
}
interface SessionLike {
  getYDoc(): YDocLike;
}
interface CollabHolder {
  __CANVASH_PLAYGROUND__?: { getSession?: () => SessionLike | null };
  __CANVASH_REACT__?: { collab?: { getSession?: () => SessionLike | null } | null };
  __CANVASH_VUE__?: { collab?: { getSession?: () => SessionLike | null } | null };
  __CANVASH_WC__?: { collab?: { getSession?: () => SessionLike | null } | null };
}

async function twoSessions(context: Parameters<typeof openCollabPage>[0], variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  await createShape(a, {
    id: SHAPE.id,
    type: 'rectangle',
    x: SHAPE.x,
    y: SHAPE.y,
    width: SHAPE.width,
    height: SHAPE.height,
    rotation: 0,
    style: { fill: '#ffffff', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
    label: { text: 'antigo' },
  });
  await selectIds(a, []);
  await expectNode(b, SHAPE.id);
  await expect
    .poll(async () => (await peersOf(b)).every((peer) => peer.selection.length === 0))
    .toBe(true);
  return { a, b };
}

/** Conta os updates que o Y.Doc da página produz a partir de agora, em `window.__labelUpdates`. */
async function countUpdates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as CollabHolder & { __labelUpdates: number };
    const session = (
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab
    )?.getSession?.();
    if (!session) throw new Error('Sessão de colaboração não encontrada');
    w.__labelUpdates = 0;
    session.getYDoc().on('update', () => {
      w.__labelUpdates++;
    });
  });
}

const updatesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __labelUpdates: number }).__labelUpdates);

/** O `labelText` gravado no Y.Doc da página para a forma. */
const storedText = (page: Page) =>
  page.evaluate((id) => {
    const w = window as unknown as CollabHolder;
    const session = (
      w.__CANVASH_PLAYGROUND__ ??
      w.__CANVASH_REACT__?.collab ??
      w.__CANVASH_VUE__?.collab ??
      w.__CANVASH_WC__?.collab
    )?.getSession?.();
    return session?.getYDoc().getMap('shapes').get(id)?.get('labelText');
  }, SHAPE.id);

const textOf = async (page: Page): Promise<string | undefined> =>
  (
    (await snapshot(page)).document.nodes[SHAPE.id] as unknown as {
      label?: { text: string };
    }
  ).label?.text;

/** Abre o editor de A sobre a forma e troca o texto, sem confirmar. */
async function typeInEditor(a: Page, variant: Variant, text: string): Promise<void> {
  const box = await canvasBox(a, variant);
  await a.mouse.dblclick(box.x + SHAPE.x + SHAPE.width / 2, box.y + SHAPE.y + SHAPE.height / 2);
  await expect(a.locator(EDITOR)).toHaveCount(1);
  await a.keyboard.press('ControlOrMeta+A');
  await a.keyboard.type(text);
}

// As jornadas abrem duas páginas por teste: com a máquina carregada passam de 30 s.
test.describe.configure({ timeout: 90_000 });

for (const variant of VARIANTS) {
  test.describe(`Texto da forma em colaboração: ${variant.name}`, () => {
    test('US-SL.14: enquanto A digita, B vê o texto antigo com o bloqueio e nada sai de A; no commit B recebe numa alteração', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await countUpdates(a);
      await selectIds(a, [SHAPE.id]);
      await expect.poll(() => lockHolder(b, SHAPE.id)).not.toBeNull();

      await typeInEditor(a, variant, 'texto novo');

      // O editor é só um campo de texto: o documento de A e o de B seguem com o texto antigo.
      expect(await updatesOf(a)).toBe(0);
      expect(await storedText(a)).toBe('antigo');
      expect(await textOf(b)).toBe('antigo');
      expect(await lockHolder(b, SHAPE.id)).not.toBeNull();

      // Perder o foco confirma: um único update sai de A e o texto chega a B.
      const box = await canvasBox(a, variant);
      await a.mouse.click(box.x + 300, box.y + 120);
      await expect(a.locator(EDITOR)).toHaveCount(0);

      await expect.poll(() => textOf(b)).toBe('texto novo');
      expect(await storedText(a)).toBe('texto novo');
      expect(await updatesOf(a)).toBe(1);
    });

    test('US-SL.14: com Esc, nada chega a B e o texto de A volta ao que era', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await countUpdates(a);
      await selectIds(a, [SHAPE.id]);
      await expect.poll(() => lockHolder(b, SHAPE.id)).not.toBeNull();

      await typeInEditor(a, variant, 'descartado');
      await a.keyboard.press('Escape');
      await expect(a.locator(EDITOR)).toHaveCount(0);

      expect(await textOf(a)).toBe('antigo');
      expect(await textOf(b)).toBe('antigo');
      expect(await storedText(a)).toBe('antigo');
      expect(await updatesOf(a)).toBe(0);
    });

    test('US-SL.10: a forma que A está editando não entra na seleção de B', async ({ context }) => {
      const { a, b } = await twoSessions(context, variant);
      await selectIds(a, [SHAPE.id]);
      await typeInEditor(a, variant, 'em edição');
      await expect.poll(() => lockHolder(b, SHAPE.id)).not.toBeNull();

      await selectIds(b, [SHAPE.id]);

      // Sem a forma selecionada, o painel de B não tem o que alterar nela.
      expect(await selectedOf(b)).not.toContain(SHAPE.id);
      expect(await textOf(b)).toBe('antigo');
    });

    test('US-SL.10: com a forma bloqueada por outra sessão, os controles do texto ficam desabilitados', async ({
      context,
    }) => {
      const { b } = await twoSessions(context, variant);
      await selectIds(b, [SHAPE.id]);
      await openPropertiesPanel(b, variant);
      const radios = b.locator('[data-field="label-vertical-align"] [role="radio"]');
      await expect(radios.first()).toBeVisible();
      await expect(radios.first()).toBeEnabled();

      // Quem perde a disputa deixa de ter o nó selecionado, então a jornada real só passa por
      // este estado de relance: o detentor é simulado e o documento muda uma vez para o painel
      // reler o bloqueio (como no a11y do painel bloqueado).
      await b.evaluate((id) => {
        type Simulated = {
          getPeerLock: (nodeId: string) => unknown;
          dispatch: (command: unknown) => void;
        };
        const w = window as unknown as Record<string, unknown>;
        const holder = (name: string) => w[name] as { section?: unknown } | undefined;
        const section = (holder('__CANVASH_PLAYGROUND__')?.section ??
          holder('__CANVASH_REACT__')?.section ??
          holder('__CANVASH_VUE__')?.section ??
          (w['__CANVASH_WC__'] as { canvas: { section: unknown } } | undefined)?.canvas
            .section) as Simulated;
        section.getPeerLock = (nodeId: string) =>
          nodeId === id ? { name: 'Maria', color: '#7c3aed', sessionId: 'outra' } : undefined;
        section.dispatch({ type: 'shape.update', id, patch: { x: 621 } });
      }, SHAPE.id);

      const count = await radios.count();
      for (let i = 0; i < count; i++) await expect(radios.nth(i)).toBeDisabled();
      await expect(b.locator('[data-field="label-bold"]')).toBeDisabled();
      await expect(b.locator('[data-field="labelFontSize"]')).toBeDisabled();
      await expect(b.locator('[data-field="label-color"]')).toBeDisabled();
      await expect(b.locator('[data-field="label-color-auto"]')).toBeDisabled();
    });
  });
}
