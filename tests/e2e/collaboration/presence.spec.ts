import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { VARIANTS, canvasBox } from '../helpers/canvas.js';
import {
  addRect,
  clickShare,
  copiedLinks,
  expectNode,
  mySessionId,
  openCollabPage,
  openFromLink,
  peersOf,
  previewMove,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';

/** Timeout curto de presença, só aceito sob automação. */
const SHORT_TIMEOUT_MS = 1500;

for (const variant of VARIANTS) {
  test.describe(`Canal de presença: ${variant.name}`, () => {
    test('US-PC.2: o participante parado continua nos pares e some em até 1 s ao fechar a aba', async ({
      context,
    }) => {
      // Espera 3× o timeout de propósito: o teste inteiro passa de 10 s com a máquina carregada.
      test.slow();
      const room = `${uniqueRoom()}&presenceTimeout=${SHORT_TIMEOUT_MS}`;
      const a = await openCollabPage(context, variant, { room });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      const aId = await mySessionId(a);
      await expect.poll(async () => (await peersOf(b)).map((p) => p.sessionId)).toContain(aId);

      // 3× o timeout sem A fazer nada: o heartbeat a mantém na lista.
      await b.waitForTimeout(SHORT_TIMEOUT_MS * 3);
      expect((await peersOf(b)).map((p) => p.sessionId)).toContain(aId);

      await a.close({ runBeforeUnload: true });
      await expect
        .poll(async () => (await peersOf(b)).map((p) => p.sessionId), { timeout: 1000 })
        .not.toContain(aId);
    });

    test('US-PC.5: a seleção e o arrasto de A aparecem nos peers de B', async ({ context }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      const aId = await mySessionId(a);
      await addRect(a, 'alvo', 300, 300);
      await expectNode(b, 'alvo');

      const peerOfA = async () => (await peersOf(b)).find((p) => p.sessionId === aId);
      await expect.poll(async () => (await peerOfA())?.selection).toEqual(['alvo']);
      expect((await peerOfA())?.selectedAt).toEqual(expect.any(Number));

      await previewMove(a, { id: 'alvo', dx: 40, dy: 25 });
      await expect
        .poll(async () => (await peerOfA())?.drag)
        .toEqual({
          ids: ['alvo'],
          dx: 40,
          dy: 25,
        });

      await previewMove(a, null);
      await expect.poll(async () => (await peerOfA())?.drag).toBeNull();
    });

    test('o cursor de A aparece em B como um remote-cursor e some quando o ponteiro sai', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      const aId = await mySessionId(a);

      const box = await canvasBox(a, variant);
      await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await a.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);

      await expect(
        b.locator(`[data-testid="remote-cursor"][data-session-id="${aId}"]`),
      ).toHaveCount(1);
      await expect(b.locator('[data-testid="remote-cursors-layer"]')).toHaveCount(1);

      await a.mouse.move(box.x + box.width + 50, box.y + box.height + 50);
      await expect(
        b.locator(`[data-testid="remote-cursor"][data-session-id="${aId}"]`),
      ).toHaveCount(0);
    });
  });
}

test('US-PC.6: os quatro exemplos não têm código próprio de presença e compartilham o mesmo transporte', () => {
  const files = [
    'examples/vanilla/src/collab-persistence.ts',
    'examples/web-components/src/collab-persistence.ts',
    'examples/react/src/collabPersistence.ts',
    'examples/vue/src/collabPersistence.ts',
  ].map((path) => readFileSync(path, 'utf8'));

  for (const source of files) {
    expect(source).not.toContain('renderRemoteCursors');
    expect(source).not.toContain('handlePointerMove');
    expect(source).toContain('bindCanvasPresence');
  }
  const normalized = files.map((source) => source.replace(/appName = '[^']*'/, "appName = 'X'"));
  for (const source of normalized) expect(source).toBe(normalized[0]);
});
