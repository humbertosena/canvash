import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  drag,
  openVariant,
  snapshot,
  VARIANTS,
  type NodeData,
  type Variant,
} from '../helpers/canvas.js';
import { closePropertiesPanel, openPropertiesPanel } from '../helpers/shell.js';

type TextData = NodeData & { readonly fontSize?: number; readonly fontSizeMode?: string };

const SENTENCE = 'Uma frase comprida o bastante para quebrar em várias linhas dentro da caixa';

async function text(page: Page, id: string): Promise<TextData> {
  return (await snapshot(page)).document.nodes[id] as TextData;
}

function fontSelect(page: Page, variant: Variant) {
  return variant.isVanilla
    ? page.locator('#prop-font-size')
    : page.locator('canvas-properties').locator('select[data-field="fontSize"]');
}

async function addText(page: Page, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await createShape(page, {
    id,
    type: 'text',
    x: 120,
    y: 100,
    width: 160,
    text: SENTENCE,
    ...extra,
  });
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { undo: () => void } };
      __CANVASH_REACT__?: { section: { undo: () => void } };
      __CANVASH_VUE__?: { section: { undo: () => void } };
      __CANVASH_WC__?: { canvas: { section?: { undo: () => void } } };
    };
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.undo();
  });
}

test.describe('Épico 03 - Feature 01: Tamanho de fonte fixo ou automático nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`US-F.1: o painel mostra Automático (16) e os 17 tamanhos em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addText(page, 'tx');

        await openPropertiesPanel(page, variant);
        const select = fontSelect(page, variant);
        await expect(select).toBeVisible();
        await expect(select).toHaveValue('auto');
        await expect(select.locator('option')).toHaveCount(18);
        await expect(select.locator('option').first()).toHaveText('Automático (16)');
        await expect(select.locator('option[value="12"]')).toHaveCount(1);
        await expect(select.locator('option[value="120"]')).toHaveCount(1);
        expect(await text(page, 'tx')).toMatchObject({ fontSize: 16, fontSizeMode: 'auto' });
      });

      test(`US-F.2: escolher 24 fixa o modo, recalcula a altura e desfaz tudo em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await addText(page, 'tx');
        const before = await text(page, 'tx');

        await openPropertiesPanel(page, variant);
        await fontSelect(page, variant).selectOption('24');
        await expect.poll(async () => (await text(page, 'tx')).fontSize).toBe(24);
        const after = await text(page, 'tx');
        expect(after.fontSizeMode).toBe('fixed');
        expect(after.height!).toBeGreaterThan(before.height!);

        await undo(page);
        await expect.poll(async () => (await text(page, 'tx')).fontSize).toBe(16);
        expect(await text(page, 'tx')).toMatchObject({
          fontSizeMode: 'auto',
          height: before.height,
        });
      });

      test(`US-F.3: em tamanho fixo, cantos e lateral mudam só a largura em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addText(page, 'tx', { fontSize: 24, fontSizeMode: 'fixed' });

        for (const handle of ['se', 'e'] as const) {
          const before = await text(page, 'tx');
          const from = {
            x: box.x + before.x! + before.width!,
            y: box.y + before.y! + (handle === 'e' ? before.height! / 2 : before.height!),
          };
          await drag(page, from, { x: from.x + 60, y: from.y + 30 });
          const after = await text(page, 'tx');
          expect(after.fontSize).toBe(24);
          expect(after.fontSizeMode).toBe('fixed');
          expect(after.width).toBeCloseTo(before.width! + 60, 0);
        }
      });

      test(`US-F.4: em modo automático o canto escala a fonte e a lateral só refaz a quebra em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await addText(page, 'tx');

        let before = await text(page, 'tx');
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! / 2 },
          { x: box.x + before.x! + before.width! + 60, y: box.y + before.y! + before.height! / 2 },
        );
        const afterSide = await text(page, 'tx');
        expect(afterSide.fontSize).toBe(16);
        expect(afterSide.width).toBeCloseTo(before.width! + 60, 0);

        before = afterSide;
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          { x: box.x + before.x! + before.width! + 80, y: box.y + before.y! + before.height! + 40 },
        );
        const afterCorner = await text(page, 'tx');
        expect(afterCorner.fontSize!).toBeGreaterThan(16);
        expect(afterCorner.fontSizeMode).toBe('auto');
      });

      test(`US-F.5: escolher Automático num texto fixo mantém o tamanho e volta a escalar em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        // Texto curto e caixa larga: com 40 de fonte a alça do canto fica à vista.
        await addText(page, 'tx', {
          width: 420,
          text: 'Olá mundo',
          fontSize: 40,
          fontSizeMode: 'fixed',
        });

        await openPropertiesPanel(page, variant);
        const select = fontSelect(page, variant);
        await expect(select).toHaveValue('40');
        await select.selectOption('auto');
        await expect.poll(async () => (await text(page, 'tx')).fontSizeMode).toBe('auto');
        expect((await text(page, 'tx')).fontSize).toBe(40);
        await expect(select.locator('option[value="auto"]')).toHaveText('Automático (40)');

        const before = await text(page, 'tx');
        await closePropertiesPanel(page);
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          {
            x: box.x + before.x! + before.width! + 100,
            y: box.y + before.y! + before.height! + 60,
          },
        );
        expect((await text(page, 'tx')).fontSize!).toBeGreaterThan(40);
      });
    });
  }

  for (const variant of VARIANTS.filter((entry) => !entry.isVanilla)) {
    test(`US-F.6: dois textos diferentes mostram Misto e escolher 32 aplica aos dois numa entrada em ${variant.name}`, async ({
      page,
    }) => {
      await openVariant(page, variant);
      await addText(page, 'a', { fontSize: 20, fontSizeMode: 'fixed' });
      await addText(page, 'b', { x: 400, fontSize: 48, fontSizeMode: 'fixed' });
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __CANVASH_REACT__?: { section: { setSelection: (ids: string[]) => void } };
          __CANVASH_VUE__?: { section: { setSelection: (ids: string[]) => void } };
          __CANVASH_WC__?: { canvas: { section?: { setSelection: (ids: string[]) => void } } };
        };
        (
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setSelection(['a', 'b']);
      });

      await openPropertiesPanel(page, variant);
      const select = fontSelect(page, variant);
      await expect(select).toHaveValue('mixed');
      await expect(select.locator('option[value="mixed"]')).toBeDisabled();

      await select.selectOption('32');
      await expect.poll(async () => (await text(page, 'a')).fontSize).toBe(32);
      expect((await text(page, 'b')).fontSize).toBe(32);

      await undo(page);
      await expect.poll(async () => (await text(page, 'a')).fontSize).toBe(20);
      expect((await text(page, 'b')).fontSize).toBe(48);
    });
  }
});
