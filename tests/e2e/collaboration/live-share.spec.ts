import { expect, test } from '@playwright/test';
import { VARIANTS } from '../helpers/canvas.js';
import {
  addRect,
  clickShare,
  clickToggleCollab,
  collabResources,
  copiedLinks,
  cycleSharing,
  dropNetwork,
  expectNode,
  failNextConnection,
  liveSessionId,
  nodeIds,
  notice,
  openCollabPage,
  openFromLink,
  sharingOf,
  toggleCollabText,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';

/** Variantes que já ligam o compartilhamento ao vivo; as outras entram nas tarefas seguintes. */
const SHARING_VARIANTS = VARIANTS;

for (const variant of SHARING_VARIANTS) {
  test.describe(`Compartilhar ao vivo: ${variant.name}`, () => {
    test('US-LS.1: sem ?collab a pill fica em off e nada é enviado no canal', async ({
      context,
    }) => {
      const page = await openCollabPage(context, variant, { room: uniqueRoom() });

      await waitForSharing(page, 'off');
      await addRect(page, 'local-only');
      await page.mouse.move(300, 300);

      const resources = await collabResources(page);
      expect(resources).toEqual({ clients: 0, channels: 0, posted: 0 });
      expect(await liveSessionId(page)).toBeNull();
    });

    test('US-LS.2: Compartilhar liga na hora, sem recarregar, e uma sessão aberta pelo link troca edições', async ({
      context,
    }) => {
      const room = uniqueRoom();
      const a = await openCollabPage(context, variant, { room });
      await a.evaluate(() => {
        (window as unknown as { __marker: number }).__marker = 1;
      });

      await clickShare(a);
      await waitForSharing(a, 'on');

      expect(await a.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
      const links = await copiedLinks(a);
      expect(links).toHaveLength(1);
      expect(new URL(links[0]!).searchParams.get('collab')).toBe('true');
      expect(new URL(links[0]!).searchParams.get('room')).toBe(room);

      const b = await openFromLink(context, variant, links[0]!);
      await addRect(a, 'from-a');
      await expectNode(b, 'from-a');
      await addRect(b, 'from-b', 260, 220);
      await expectNode(a, 'from-b');
    });

    test('US-LS.3: em on, cada clique copia o link de novo e não cria outra sessão', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const sessionBefore = await liveSessionId(a);
      const resourcesBefore = await collabResources(a);

      await clickShare(a);
      await clickShare(a);

      await expect.poll(async () => (await copiedLinks(a)).length).toBe(3);
      expect(await sharingOf(a)).toBe('on');
      expect(await liveSessionId(a)).toBe(sessionBefore);
      expect(await collabResources(a)).toEqual({
        ...resourcesBefore,
        posted: expect.any(Number) as unknown as number,
      });
    });

    test('US-LS.4: parar volta a off sem perder o documento, e religar reconcilia os dois lados', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      await addRect(a, 'before-stop');
      await expectNode(b, 'before-stop');

      await clickToggleCollab(a);
      await waitForSharing(a, 'off');
      expect(await toggleCollabText(a)).toContain('Pausada');
      expect(await liveSessionId(a)).toBeNull();
      expect(await collabResources(a)).toMatchObject({ clients: 0, channels: 0 });

      const documentBefore = await nodeIds(a);
      await addRect(a, 'a-off', 40, 40);
      await addRect(b, 'b-while-a-off', 300, 40);
      // O que A edita fora do compartilhamento não chega a B, e o documento de A segue o dela.
      await expect.poll(async () => (await nodeIds(a)).includes('a-off')).toBe(true);
      expect(await nodeIds(b)).not.toContain('a-off');
      expect(await nodeIds(a)).toEqual(expect.arrayContaining(documentBefore));
      expect(await nodeIds(a)).not.toContain('b-while-a-off');

      await clickToggleCollab(a);
      await waitForSharing(a, 'on');
      expect(await toggleCollabText(a)).toContain('Ativa');
      await expectNode(a, 'b-while-a-off');
      await expectNode(b, 'a-off');
      await expect.poll(async () => (await nodeIds(a)).sort()).toEqual((await nodeIds(b)).sort());
    });

    test('US-LS.5: parar com alterações pendentes mantém on, avisa e não perde nada', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await clickShare(a);
      await waitForSharing(a, 'on');
      await dropNetwork(a, true);
      await addRect(a, 'pending-edit');

      await clickToggleCollab(a);

      await expect(notice(a)).toHaveText(
        'Há alterações pendentes; o compartilhamento continua ativo',
      );
      expect(await sharingOf(a)).toBe('on');
      expect(await toggleCollabText(a)).toContain('Ativa');
      expect(await nodeIds(a)).toContain('pending-edit');
      expect(await liveSessionId(a)).not.toBeNull();
    });

    test('US-LS.6: uma falha ao conectar volta a pill a off com aviso, e o canvas segue editável', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await failNextConnection(a);

      await clickShare(a);

      await waitForSharing(a, 'off');
      await expect(notice(a)).toHaveText('Não foi possível compartilhar');
      await addRect(a, 'still-editable');
      await expectNode(a, 'still-editable');
    });

    test('US-LS.8: ligar e desligar dez vezes não deixa cliente, canal nem sessão', async ({
      context,
    }) => {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });

      await cycleSharing(a, 10);

      await waitForSharing(a, 'off');
      expect(await collabResources(a)).toMatchObject({ clients: 0, channels: 0 });
      expect(await liveSessionId(a)).toBeNull();
    });
  });
}
