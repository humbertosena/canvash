import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { VARIANTS, canvasBox, createShape, snapshot, type Variant } from '../helpers/canvas.js';
import {
  clickShare,
  copiedLinks,
  expectNode,
  mySessionId,
  notice,
  openCollabPage,
  openFromLink,
  peersOf,
  selectIds,
  setViewportOf,
  uniqueRoom,
  viewState,
  waitForSharing,
} from '../helpers/collab.js';

test.describe.configure({ timeout: 120_000 });

const stack = (page: Page) => page.locator('[part~="participants"]');
const island = (page: Page) => page.locator('[part~="participants-island"]');
const banner = (page: Page) => page.locator('[part~="following-banner"]');
const frame = (page: Page) => page.locator('[part~="follow-frame"]');

async function host(context: BrowserContext, variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await a.setViewportSize({ width: 1280, height: 720 });
  return a;
}

async function join(context: BrowserContext, variant: Variant, a: Page, size?: [number, number]) {
  const page = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  return page;
}

/** Abre a ilha de `page` e clica no botão Seguir da linha de `name`. */
async function followBy(page: Page, name: string): Promise<void> {
  if ((await island(page).count()) === 0) await stack(page).click();
  await island(page)
    .locator('[part~="participant-row"]', { hasText: name })
    .locator('[part~="follow-button"]')
    .click();
}

const nameOf = async (page: Page) => (await peersOf(page)).map((peer) => peer.name).sort()[0] ?? '';

/** Espera o centro do canvas de `follower` coincidir com o de `leader` (1 px de tela). */
async function expectSameCenter(follower: Page, leader: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [f, l] = await Promise.all([viewState(follower), viewState(leader)]);
        const tolerance = 1.5 / f.viewport.zoom;
        return (
          Math.abs(f.viewport.zoom - l.viewport.zoom) < 1e-6 &&
          Math.abs(f.center.x - l.center.x) <= tolerance &&
          Math.abs(f.center.y - l.center.y) <= tolerance
        );
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

for (const variant of VARIANTS) {
  test.describe(`Seguir o apresentador: ${variant.name}`, () => {
    test('US-FP.1 e US-FP.2: B segue A, com telas diferentes, e acompanha pan e zoom dela', async ({
      context,
    }) => {
      const a = await host(context, variant);
      await setViewportOf(a, { x: -200, y: -100, zoom: 1.5 });
      const b = await join(context, variant, a, [1024, 768]);
      await expect(stack(b)).toHaveCount(1);
      const aName = await nameOf(b);

      await followBy(b, aName);

      await expectSameCenter(b, a);
      await expect(banner(b)).toContainText(`Seguindo ${aName}`);
      await expect(banner(b).locator('[role="status"]')).toHaveCount(1);
      const color = (await peersOf(b))[0]!.color;
      await expect
        .poll(async () =>
          ((await frame(b).getAttribute('style')) ?? '')
            .toLowerCase()
            .includes(color.toLowerCase()),
        )
        .toBe(true);

      for (const viewport of [
        { x: 50, y: 80, zoom: 0.75 },
        { x: -900, y: 300, zoom: 3 },
      ]) {
        await setViewportOf(a, viewport);
        await expectSameCenter(b, a);
      }
    });

    test('US-FP.3: o cursor de A aparece em B maior e com etiqueta, e o de C continua normal', async ({
      context,
    }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      const c = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      await expect.poll(async () => (await peersOf(b)).length).toBe(2);
      const aId = await mySessionId(a);
      const cId = await mySessionId(c);
      const aName = (await peersOf(b)).find((peer) => peer.sessionId === aId)!.name;

      const box = await canvasBox(a, variant);
      await a.mouse.move(box.x + 300, box.y + 300);
      await a.mouse.move(box.x + 320, box.y + 310);
      await c.mouse.move(box.x + 500, box.y + 300);
      await c.mouse.move(box.x + 520, box.y + 310);
      await followBy(b, aName);

      const cursorA = b.locator(`[data-testid="remote-cursor"][data-session-id="${aId}"]`);
      const cursorC = b.locator(`[data-testid="remote-cursor"][data-session-id="${cId}"]`);
      await expect(cursorA).toHaveAttribute('data-followed', 'true');
      await expect(cursorC).not.toHaveAttribute('data-followed', 'true');
      const [boxA, boxC] = [(await cursorA.boundingBox())!, (await cursorC.boundingBox())!];
      expect(boxA.height / boxC.height).toBeGreaterThan(1.15);
      expect(boxA.height / boxC.height).toBeLessThan(1.35);
      await expect(cursorA).toContainText(aName);
    });

    test('US-FP.4: pan e zoom locais encerram o seguir', async ({ context }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      const aName = await nameOf(b);
      const box = await canvasBox(b, variant);
      const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      for (const gesture of ['pan-wheel', 'zoom-wheel', 'hand-drag'] as const) {
        await followBy(b, aName);
        await expect(banner(b)).toHaveCount(1);
        await b.mouse.move(middle.x, middle.y);
        if (gesture === 'pan-wheel') await b.mouse.wheel(0, 120);
        else if (gesture === 'zoom-wheel') {
          await b.keyboard.down('Control');
          await b.mouse.wheel(0, -120);
          await b.keyboard.up('Control');
        } else {
          await b.evaluate(() => {
            const w = window as unknown as {
              __CANVASH_PLAYGROUND__?: { section: { setTool(t: string): void } };
              __CANVASH_REACT__?: { section: { setTool(t: string): void } };
              __CANVASH_VUE__?: { section: { setTool(t: string): void } };
              __CANVASH_WC__?: { canvas: { section?: { setTool(t: string): void } } };
            };
            (
              w.__CANVASH_PLAYGROUND__?.section ??
              w.__CANVASH_REACT__?.section ??
              w.__CANVASH_VUE__?.section ??
              w.__CANVASH_WC__?.canvas.section
            )?.setTool('hand');
          });
          await b.mouse.down();
          await b.mouse.move(middle.x + 60, middle.y + 40, { steps: 5 });
          await b.mouse.up();
        }
        await expect(banner(b)).toHaveCount(0);
        await expect(frame(b)).toHaveCount(0);
      }
    });

    test('US-FP.5: selecionar e mover uma forma não encerra o seguir', async ({ context }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      const aName = await nameOf(b);
      await followBy(b, aName);
      await expect(banner(b)).toHaveCount(1);
      await setViewportOf(a, { x: 0, y: 0, zoom: 1 });
      await expectSameCenter(b, a);

      await createShape(b, {
        id: 'minha',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 100,
        height: 80,
        rotation: 0,
        style: { fill: '#334155', stroke: null, strokeWidth: 0, opacity: 1 },
      });
      await selectIds(b, ['minha']);
      await b.evaluate(() => {
        const w = window as unknown as {
          __CANVASH_PLAYGROUND__?: { section: { dispatch(c: unknown): unknown } };
          __CANVASH_REACT__?: { section: { dispatch(c: unknown): unknown } };
          __CANVASH_VUE__?: { section: { dispatch(c: unknown): unknown } };
          __CANVASH_WC__?: { canvas: { section?: { dispatch(c: unknown): unknown } } };
        };
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.dispatch({ type: 'shape.update', id: 'minha', patch: { x: 360 } });
      });

      await expectNode(b, 'minha');
      await expect(banner(b)).toHaveCount(1);
    });

    test('US-FP.6: se A sai, B para de seguir com o aviso, e parar o compartilhamento também encerra', async ({
      context,
    }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      const aName = await nameOf(b);
      await followBy(b, aName);
      await expect(banner(b)).toHaveCount(1);

      await a.close({ runBeforeUnload: true });

      await expect(banner(b)).toHaveCount(0, { timeout: 4000 });
      await expect(notice(b)).toHaveText(`${aName} saiu; você parou de seguir`);
    });

    test('US-FP.6: desligar o compartilhamento em B encerra o seguir', async ({ context }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      await followBy(b, await nameOf(b));
      await expect(banner(b)).toHaveCount(1);

      await island(b).locator('[part~="share-stop-item"]').click();

      await waitForSharing(b, 'off');
      await expect(banner(b)).toHaveCount(0);
    });

    test('US-FP.7: em cadeia, A segue B, B segue C, e A vê o que C vê', async ({ context }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a, [1024, 768]);
      const c = await join(context, variant, a, [1100, 700]);
      await expect.poll(async () => (await peersOf(a)).length).toBe(2);
      await expect.poll(async () => (await peersOf(b)).length).toBe(2);
      await expect.poll(async () => (await peersOf(c)).length).toBe(2);
      const nameC = (await peersOf(a)).find((peer) => peer.sessionId === (undefined as never))
        ? ''
        : '';
      void nameC;
      const idC = await mySessionId(c);
      const idB = await mySessionId(b);
      const nameOfPeer = async (viewer: Page, id: string) =>
        (await peersOf(viewer)).find((peer) => peer.sessionId === id)!.name;

      await followBy(b, await nameOfPeer(b, idC));
      await followBy(a, await nameOfPeer(a, idB));
      await setViewportOf(c, { x: -400, y: 150, zoom: 2 });

      await expectSameCenter(b, c);
      await expectSameCenter(a, b);
      await expectSameCenter(a, c);
    });

    test('US-FP.8: quem não publica a vista tem o Seguir desabilitado, com o título explicativo', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: `${uniqueRoom()}&noview=1` });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const link = new URL((await copiedLinks(a))[0]!);
      link.searchParams.delete('noview');
      const b = await openFromLink(context, variant, link.toString());
      await expect(stack(b)).toHaveCount(1);

      await stack(b).click();

      const follow = island(b).locator('[part~="follow-button"]');
      await expect(follow).toBeDisabled();
      await expect(follow).toHaveAttribute('title', 'Versão sem suporte a seguir');
      await expect(banner(b)).toHaveCount(0);
    });

    test('US-FP.9: seguir não deixa viewport no documento, no histórico nem no autosave', async ({
      context,
    }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(stack(b)).toHaveCount(1);
      await followBy(b, await nameOf(b));
      await setViewportOf(a, { x: -123, y: 456, zoom: 2.5 });
      await expectSameCenter(b, a);
      const before = await snapshot(b);

      await b.waitForTimeout(800);

      const result = await b.evaluate(async () => {
        const w = window as unknown as {
          __CANVASH_PLAYGROUND__?: { storage: { load(k: string): Promise<unknown> } };
          __CANVASH_REACT__?: { collab?: { storage: { load(k: string): Promise<unknown> } } };
          __CANVASH_VUE__?: { collab?: { storage: { load(k: string): Promise<unknown> } } };
          __CANVASH_WC__?: { collab?: { storage: { load(k: string): Promise<unknown> } } };
        };
        const storage =
          w.__CANVASH_PLAYGROUND__?.storage ??
          (w.__CANVASH_REACT__ ?? w.__CANVASH_VUE__ ?? w.__CANVASH_WC__)?.collab?.storage;
        return JSON.stringify(await storage?.load('playground-document'));
      });
      expect(JSON.stringify(before.document)).not.toContain('viewport');
      expect(result).not.toContain('"viewport"');
      expect(result).not.toContain('2.5');
      const history = (before as unknown as { history: { canUndo: boolean } }).history;
      expect(history.canUndo).toBe(false);
    });
  });
}
