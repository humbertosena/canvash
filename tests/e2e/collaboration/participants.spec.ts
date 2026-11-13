import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { VARIANTS, type Variant } from '../helpers/canvas.js';
import {
  clickShare,
  copiedLinks,
  openCollabPage,
  openFromLink,
  peersOf,
  sharingOf,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';
import type { Locator } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

const PARTICIPANT_VARIANTS = VARIANTS;

const stack = (page: Page) => page.locator('[part~="participants"]');
const island = (page: Page) => page.locator('[part~="participants-island"]');
const avatars = (page: Page) => stack(page).locator('[part~="participant-avatar"]');

/**
 * Caixa do elemento, lida de novo até existir: a pilha re-renderiza quando os pares chegam, e um
 * `boundingBox()` que cai entre a troca de nós devolve null.
 */
async function stableBox(locator: Locator) {
  const last = { box: null as Awaited<ReturnType<Locator['boundingBox']>> };
  await expect.poll(async () => (last.box = await locator.boundingBox())).not.toBeNull();
  return last.box;
}

async function host(context: BrowserContext, variant: Variant, query = '') {
  const a = await openCollabPage(context, variant, { room: `${uniqueRoom()}${query}` });
  await clickShare(a);
  await waitForSharing(a, 'on');
  return a;
}

async function join(context: BrowserContext, variant: Variant, a: Page, name?: string) {
  const link = (await copiedLinks(a))[0]!;
  const url = name ? `${link}&name=${encodeURIComponent(name)}` : link;
  return openFromLink(context, variant, url);
}

for (const variant of PARTICIPANT_VARIANTS) {
  test.describe(`Participantes: ${variant.name}`, () => {
    test('US-PI.1: sozinha não há pilha; quando B entra aparece um avatar de 24 px com a cor dele; quando sai, some', async ({
      context,
    }) => {
      const a = await host(context, variant);
      await expect(stack(a)).toHaveCount(0);

      const b = await join(context, variant, a);
      await expect(stack(a)).toHaveCount(1);
      await expect(avatars(a)).toHaveCount(1);
      const box = await stableBox(avatars(a).first());
      expect(Math.round(box!.width)).toBe(24);
      expect(Math.round(box!.height)).toBe(24);
      const colorOfB = (await peersOf(a))[0]!.color;
      await expect
        .poll(async () =>
          ((await avatars(a).first().getAttribute('style')) ?? '')
            .toLowerCase()
            .includes(`--ring: ${colorOfB}`.toLowerCase()),
        )
        .toBe(true);

      await b.close({ runBeforeUnload: true });
      await expect(stack(a)).toHaveCount(0, { timeout: 3000 });
    });

    test('US-PI.2: com 5 remotos a pilha mostra 3 avatares e "+2", e o nome acessível diz "5 outras pessoas"', async ({
      context,
    }) => {
      test.slow();
      const a = await host(context, variant);
      for (let i = 0; i < 5; i += 1) await join(context, variant, a);

      await expect(avatars(a)).toHaveCount(3);
      await expect(stack(a).locator('[part~="participants-more"]')).toHaveText('+2');
      await expect(stack(a)).toHaveAttribute(
        'aria-label',
        'Participantes: 5 outras pessoas na sessão',
      );
    });

    test('US-PI.3: o hover e o clique abrem a ilha com "Na sessão (3)", a pessoa local primeiro e Seguir nos outros', async ({
      context,
    }) => {
      const a = await host(context, variant);
      await join(context, variant, a);
      await join(context, variant, a);
      await expect(stack(a)).toHaveCount(1);
      await expect(avatars(a)).toHaveCount(2);

      await stack(a).hover();
      await expect(island(a)).toHaveCount(1);
      await expect(island(a).locator('[part~="participants-title"]')).toHaveText('Na sessão (3)');
      const rows = island(a).locator('[part~="participant-row"]');
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toContainText('(você)');
      await expect(rows.first().locator('[part~="follow-button"]')).toHaveCount(0);
      await expect(island(a).locator('[part~="follow-button"]')).toHaveCount(2);
      await expect(island(a).locator('[part~="follow-button"]').first()).toHaveText('Seguir');

      // Mesma ancoragem nos quatro exemplos: 8 px abaixo da pilha, alinhada à direita dela.
      const stackBox = (await stack(a).boundingBox())!;
      const islandBox = (await island(a).boundingBox())!;
      expect(Math.round(islandBox.y - (stackBox.y + stackBox.height))).toBe(8);
      expect(
        Math.abs(islandBox.x + islandBox.width - (stackBox.x + stackBox.width)),
      ).toBeLessThanOrEqual(1);
      expect(islandBox.width).toBeGreaterThanOrEqual(260);
      expect(stackBox.height).toBe(32);

      await a.mouse.move(5, 400);
      await expect(island(a)).toHaveCount(0, { timeout: 3000 });
      await stack(a).click();
      await expect(island(a)).toHaveCount(1);
      await a.mouse.move(5, 400);
      await a.waitForTimeout(600);
      await expect(island(a)).toHaveCount(1);
    });

    test('US-PI.4: a ilha abre pelo teclado, anda com as setas, Esc fecha e devolve o foco, e o clique fora fecha', async ({
      context,
    }) => {
      const a = await host(context, variant);
      await join(context, variant, a);
      await join(context, variant, a);
      await expect(avatars(a)).toHaveCount(2);

      await stack(a).focus();
      await a.keyboard.press('ArrowDown');
      await expect(island(a)).toHaveCount(1);
      const follows = island(a).locator('[part~="follow-button"]');
      await expect(follows.first()).toBeFocused();
      // O botão só habilita quando o par publica a vista; as setas pulam os desabilitados.
      await expect(follows.nth(1)).toBeEnabled();
      await a.keyboard.press('ArrowDown');
      await expect(follows.nth(1)).toBeFocused();
      await a.keyboard.press('ArrowDown');
      await expect(island(a).locator('[part~="share-stop-item"]')).toBeFocused();

      await a.keyboard.press('Escape');
      await expect(island(a)).toHaveCount(0);
      await expect(stack(a)).toBeFocused();

      await a.keyboard.press('Enter');
      await expect(island(a)).toHaveCount(1);
      await a.mouse.click(5, 400);
      await expect(island(a)).toHaveCount(0);
    });

    test('US-PI.5: a ilha continua aberta quando alguém entra ou sai', async ({ context }) => {
      const a = await host(context, variant);
      const b = await join(context, variant, a);
      await expect(avatars(a)).toHaveCount(1);
      await stack(a).click();
      const rows = island(a).locator('[part~="participant-row"]');
      await expect(rows).toHaveCount(2);

      const c = await join(context, variant, a);
      await expect(rows).toHaveCount(3);
      await expect(island(a)).toHaveCount(1);

      await c.close({ runBeforeUnload: true });
      await expect(rows).toHaveCount(2, { timeout: 3000 });
      await expect(island(a)).toHaveCount(1);
      await b.close({ runBeforeUnload: true });
    });

    test('US-PI.6: Parar compartilhamento leva a pill a off e a pilha some', async ({
      context,
    }) => {
      const a = await host(context, variant);
      await join(context, variant, a);
      await expect(avatars(a)).toHaveCount(1);
      await stack(a).click();

      await island(a).locator('[part~="share-stop-item"]').click();

      await waitForSharing(a, 'off');
      expect(await sharingOf(a)).toBe('off');
      await expect(stack(a)).toHaveCount(0);
      await expect(island(a)).toHaveCount(0);
    });

    test('US-PI.7: um nome com marcação aparece como texto', async ({ context }) => {
      const a = await host(context, variant);
      const markup = '<img src=x onerror="window.__xss=true"><b>Eva</b>';
      await join(context, variant, a, markup);
      await expect(avatars(a)).toHaveCount(1);

      await stack(a).click();

      const name = island(a).locator('[part~="participant-name"]').nth(1);
      await expect(name).toHaveText(markup);
      await expect(island(a).locator('img, b')).toHaveCount(0);
      expect(
        await a.evaluate(() => (window as unknown as { __xss?: boolean }).__xss),
      ).toBeUndefined();
    });

    test('o texto collab-info do playground continua', async ({ context }) => {
      const a = await host(context, variant);
      await join(context, variant, a);

      await expect(a.locator('#collab-info')).toContainText('conectados');
    });
  });
}
