import { expect, test } from '@playwright/test';
import {
  canvasBox,
  createShape,
  drag,
  openVariant,
  setTool,
  snapshot,
  VARIANTS,
  type NodeData,
} from '../helpers/canvas.js';
import { openPropertiesPanel } from '../helpers/shell.js';
import { selectShapeTool } from '../helpers/toolbar.js';

type CrossData = NodeData & { readonly armRatio?: number };

test.describe('Épico 01 - Feature 03: Cruz nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria a cruz por arrasto livre pela toolbar, com braço de 1/3, em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await selectShapeTool(page, variant, 'cross');
        expect((await snapshot(page)).session.activeTool).toBe('cross');

        const box = await canvasBox(page, variant);
        await drag(page, { x: box.x + 80, y: box.y + 80 }, { x: box.x + 240, y: box.y + 170 });

        const nodes = Object.values((await snapshot(page)).document.nodes) as CrossData[];
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.type).toBe('cross');
        expect(nodes[0]!.armRatio).toBeCloseTo(1 / 3, 9);
        expect(nodes[0]!.width).toBeCloseTo(160, 0);
        expect(nodes[0]!.height).toBeCloseTo(90, 0);
      });

      test(`Shift na criação dá braços iguais (caixa 1:1) em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        await selectShapeTool(page, variant, 'cross');
        const box = await canvasBox(page, variant);

        await page.keyboard.down('Shift');
        await drag(page, { x: box.x + 80, y: box.y + 80 }, { x: box.x + 240, y: box.y + 170 });
        await page.keyboard.up('Shift');

        const [node] = Object.values((await snapshot(page)).document.nodes);
        expect(node!.type).toBe('cross');
        expect(node!.width).toBeCloseTo(160, 0);
        expect(node!.height).toBe(node!.width);
      });

      test(`redimensiona livre sem Shift e em 1:1 com Shift pelas alças em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'cross-resize',
          type: 'cross',
          x: 150,
          y: 150,
          width: 120,
          height: 80,
          rotation: 0,
        });
        const read = async (): Promise<NodeData> =>
          (await snapshot(page)).document.nodes['cross-resize']!;

        // Sem Shift: só a largura muda pela alça leste.
        let before = await read();
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! / 2 },
          { x: box.x + before.x! + before.width! + 40, y: box.y + before.y! + before.height! / 2 },
        );
        let after = await read();
        expect(after.width).toBeCloseTo(before.width! + 40, 0);
        expect(after.height).toBeCloseTo(before.height!, 4);

        // Com Shift: a alça sudeste deixa a caixa quadrada.
        before = await read();
        await page.keyboard.down('Shift');
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          { x: box.x + before.x! + before.width! + 50, y: box.y + before.y! + before.height! + 10 },
        );
        await page.keyboard.up('Shift');
        after = await read();
        expect(after.type).toBe('cross');
        expect(after.width).toBeCloseTo(after.height!, 4);
        expect(after.width).not.toBeCloseTo(before.width!, 1);
      });

      test(`edita a espessura dos braços pelo painel em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        await createShape(page, {
          id: 'cross-arm',
          type: 'cross',
          x: 120,
          y: 110,
          width: 140,
          height: 100,
          rotation: 0,
        });

        await openPropertiesPanel(page, variant);

        const input = variant.isVanilla
          ? page.locator('#input-cross-arm-ratio')
          : page.locator('canvas-properties').locator('input[data-field="armRatio"]');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('0.33');

        await input.fill('0.6');
        await input.dispatchEvent('change');
        await expect
          .poll(
            async () =>
              ((await snapshot(page)).document.nodes['cross-arm'] as CrossData | undefined)
                ?.armRatio,
          )
          .toBeCloseTo(0.6, 9);

        // Fora da faixa, o painel limita a 1.
        await input.fill('3');
        await input.dispatchEvent('change');
        await expect
          .poll(
            async () =>
              ((await snapshot(page)).document.nodes['cross-arm'] as CrossData | undefined)
                ?.armRatio,
          )
          .toBe(1);
        expect(await read(page)).toMatchObject({ x: 120, y: 110, width: 140, height: 100 });
      });

      test(`o canto vazio da caixa não seleciona e o centro seleciona em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'cross-hit',
          type: 'cross',
          x: 100,
          y: 100,
          width: 120,
          height: 120,
          rotation: 0,
          style: { fill: '#f97316' },
        });
        await setTool(page, 'select');
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

        // Canto inferior esquerdo da caixa: vazio entre os braços.
        await page.mouse.click(box.x + 105, box.y + 215);
        expect((await snapshot(page)).session.selectedIds).toEqual([]);

        await page.mouse.click(box.x + 160, box.y + 160);
        expect((await snapshot(page)).session.selectedIds).toEqual(['cross-hit']);
      });
    });
  }
});

async function read(page: import('@playwright/test').Page): Promise<NodeData> {
  return (await snapshot(page)).document.nodes['cross-arm']!;
}
