import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  VARIANTS,
  createBoardNode,
  createShape,
  snapshot,
  type Variant,
} from '../helpers/canvas.js';
import {
  clickShare,
  copiedLinks,
  expectNode,
  holderColor,
  waitHolderColor,
  openCollabPage,
  openFromLink,
  peersOf,
  resetViewport,
  selectIds,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';

// Exportar o board não deixa rastro: nem overlay no arquivo, nem documento ou revisão mudados na
// outra sessão (spec board-export, US-BE.10).

test.describe.configure({ timeout: 120_000 });

/** Os exemplos que já ligam Exportar board. */
const WIRED: readonly Variant['name'][] = ['Web Components', 'React', 'Vue', 'Vanilla'];

function selectors(variant: Variant) {
  return variant.isVanilla
    ? {
        button: '[data-testid="btn-selection-export-board"]',
        item: (format: 'png' | 'svg') => `[data-testid="btn-selection-export-board-${format}"]`,
      }
    : {
        button: 'canvas-selection-menu [data-action="export-board"]',
        item: (format: 'png' | 'svg') =>
          `canvas-selection-menu [part="export-board-item"][data-format="${format}"]`,
      };
}

async function twoSessions(context: BrowserContext, variant: Variant) {
  const a = await openCollabPage(context, variant, { room: uniqueRoom() });
  await clickShare(a);
  await waitForSharing(a, 'on');
  await resetViewport(a);
  const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
  await resetViewport(b);
  return { a, b };
}

/** Conta os eventos de documento que chegam à página, pela assinatura do canvas. */
async function countDocumentEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as Record<string, unknown> & {
      __CANVASH_PLAYGROUND__?: { section: Subscribable };
      __CANVASH_REACT__?: { section: Subscribable };
      __CANVASH_VUE__?: { section: Subscribable };
      __CANVASH_WC__?: { canvas: { section?: Subscribable } };
    };
    interface Subscribable {
      subscribe(listener: (change: { areas: readonly string[] }) => void): unknown;
    }
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    w['__documentEvents'] = 0;
    section?.subscribe((change) => {
      if (change.areas.includes('document'))
        w['__documentEvents'] = (w['__documentEvents'] as number) + 1;
    });
  });
}

const documentEvents = (page: Page): Promise<number> =>
  page.evaluate(() => (globalThis as unknown as { __documentEvents: number }).__documentEvents);

for (const variant of VARIANTS.filter((candidate) => WIRED.includes(candidate.name))) {
  test.describe(`Exportar board na colaboração: ${variant.name}`, () => {
    test('US-BE.10: com seleção, bloqueio e cursor de B visíveis em A, o SVG não tem overlay e B não vê mudança', async ({
      context,
    }) => {
      const { a, b } = await twoSessions(context, variant);
      await createShape(a, {
        id: 'child',
        type: 'rectangle',
        x: 350,
        y: 100,
        width: 100,
        height: 50,
        rotation: 0,
        style: { fill: '#336699', stroke: null, strokeWidth: 0, opacity: 1 },
      });
      await createBoardNode(
        a,
        { id: 'ref', x: 100, y: 50, width: 300, height: 200, title: 'Plano' },
        ['child'],
      );
      await selectIds(a, []);
      await expectNode(b, 'ref');
      await expectNode(b, 'child');

      // B só seleciona depois de saber que A soltou o board: quem selecionou antes fica com o filho.
      await expect.poll(async () => (await peersOf(b))[0]?.selection).toEqual([]);
      // B seleciona o filho (bloqueio visível em A) e mexe o ponteiro (cursor visível em A).
      await selectIds(b, ['child']);
      await b.mouse.move(600, 400);
      await expect.poll(async () => (await peersOf(a)).length).toBe(1);
      await expect.poll(() => holderColor(a, 'child')).not.toBeNull();
      const colorOfB = await waitHolderColor(a, 'child');
      const nameOfB = (await peersOf(a))[0]!.name;

      await selectIds(a, ['ref']);
      await countDocumentEvents(b);
      const revisionOfA = (await snapshot(a)).revision;
      const revisionOfB = (await snapshot(b)).revision;

      const target = selectors(variant);
      await a.locator(target.button).click();
      const [download] = await Promise.all([
        a.waitForEvent('download'),
        a.locator(target.item('svg')).click(),
      ]);
      const svg = readFileSync((await download.path())!, 'utf8');
      await a.waitForTimeout(500);

      expect(svg).toContain('<g clip-path="url(#canvash-board-clip-1)">');
      expect(svg.toLowerCase()).not.toContain(colorOfB.toLowerCase());
      expect(svg).not.toContain(nameOfB);
      expect(svg).not.toContain('Plano');
      expect(await documentEvents(b)).toBe(0);
      expect((await snapshot(a)).revision).toBe(revisionOfA);
      expect((await snapshot(b)).revision).toBe(revisionOfB);
    });
  });
}
