import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  drag,
  openVariant,
  snapshot,
  VARIANTS,
  type NodeData,
} from '../helpers/canvas.js';
import { openPropertiesPanel } from '../helpers/shell.js';
import { selectShapeTool } from '../helpers/toolbar.js';

type BraceData = NodeData & {
  readonly orientation?: string;
  readonly tipPosition?: number;
  readonly curvature?: number;
  readonly style?: { readonly strokeWidth?: number };
};

async function brace(page: Page, id: string): Promise<BraceData> {
  return (await snapshot(page)).document.nodes[id] as BraceData;
}

test.describe('Épico 01 - Feature 03: Chaves nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria a chave de ponta à esquerda pela toolbar, só com traço, em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await selectShapeTool(page, variant, 'brace');
        expect((await snapshot(page)).session.activeTool).toBe('brace');

        const box = await canvasBox(page, variant);
        await drag(page, { x: box.x + 80, y: box.y + 60 }, { x: box.x + 140, y: box.y + 240 });

        const nodes = Object.values((await snapshot(page)).document.nodes) as BraceData[];
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toMatchObject({
          type: 'brace',
          orientation: 'left',
          tipPosition: 0.5,
          curvature: 0.5,
        });
        expect(nodes[0]!.width).toBeCloseTo(60, 0);
        expect(nodes[0]!.height).toBeCloseTo(180, 0);
        expect('fill' in nodes[0]!.style!).toBe(false);
      });

      test(`edita orientação, posição da ponta e curvatura pelo painel em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await createShape(page, {
          id: 'brace-panel',
          type: 'brace',
          x: 120,
          y: 90,
          width: 60,
          height: 180,
          rotation: 0,
        });

        await openPropertiesPanel(page, variant);

        const select = variant.isVanilla
          ? page.locator('#select-brace-orientation')
          : page.locator('canvas-properties').locator('select[data-field="orientation"]');
        const tip = variant.isVanilla
          ? page.locator('#input-brace-tip-position')
          : page.locator('canvas-properties').locator('input[data-field="tipPosition"]');
        const curvature = variant.isVanilla
          ? page.locator('#input-brace-curvature')
          : page.locator('canvas-properties').locator('input[data-field="curvature"]');
        await expect(select).toBeVisible();
        await expect(select).toHaveValue('left');
        await expect(tip).toHaveValue('0.5');
        await expect(curvature).toHaveValue('0.5');

        for (const orientation of ['right', 'up', 'down']) {
          await select.selectOption(orientation);
          await expect
            .poll(async () => (await brace(page, 'brace-panel')).orientation)
            .toBe(orientation);
        }

        await tip.fill('0.25');
        await tip.dispatchEvent('change');
        await curvature.fill('0.9');
        await curvature.dispatchEvent('change');
        await expect
          .poll(async () => (await brace(page, 'brace-panel')).tipPosition)
          .toBeCloseTo(0.25, 9);
        await expect
          .poll(async () => (await brace(page, 'brace-panel')).curvature)
          .toBeCloseTo(0.9, 9);

        await curvature.fill('4');
        await curvature.dispatchEvent('change');
        await expect.poll(async () => (await brace(page, 'brace-panel')).curvature).toBe(1);
        expect(await brace(page, 'brace-panel')).toMatchObject({
          x: 120,
          y: 90,
          width: 60,
          height: 180,
        });
      });

      test(`esticar a caixa não muda a espessura do traço em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'brace-resize',
          type: 'brace',
          x: 150,
          y: 100,
          width: 60,
          height: 160,
          rotation: 0,
          style: { strokeWidth: 5 },
        });

        const before = await brace(page, 'brace-resize');
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          {
            x: box.x + before.x! + before.width! + 80,
            y: box.y + before.y! + before.height! + 100,
          },
        );
        const after = await brace(page, 'brace-resize');
        expect(after.width).toBeCloseTo(before.width! + 80, 0);
        expect(after.height).toBeCloseTo(before.height! + 100, 0);
        expect(after.style?.strokeWidth).toBe(5);
        expect(after.orientation).toBe('left');
      });

      test(`só o traço seleciona: a ponta sim, o miolo da caixa não, em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'brace-hit',
          type: 'brace',
          x: 100,
          y: 100,
          width: 100,
          height: 200,
          rotation: 0,
          curvature: 1,
          style: { strokeWidth: 6 },
        });
        await page.evaluate(() => {
          const w = globalThis as unknown as {
            __CANVASH_PLAYGROUND__?: { section: { setSelection: (ids: string[]) => void } };
            __CANVASH_REACT__?: { section: { setSelection: (ids: string[]) => void } };
            __CANVASH_VUE__?: { section: { setSelection: (ids: string[]) => void } };
            __CANVASH_WC__?: { canvas: { section?: { setSelection: (ids: string[]) => void } } };
          };
          (
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section
          )?.setSelection([]);
        });

        // Dentro da caixa, longe do traço.
        await page.mouse.click(box.x + 160, box.y + 200);
        expect((await snapshot(page)).session.selectedIds).toEqual([]);

        // Na ponta da chave, em (100, 200).
        await page.mouse.click(box.x + 101, box.y + 200);
        expect((await snapshot(page)).session.selectedIds).toEqual(['brace-hit']);
      });
    });
  }
});
