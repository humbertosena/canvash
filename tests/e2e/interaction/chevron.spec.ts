import { expect, test } from '@playwright/test';
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

type ChevronData = NodeData & { readonly direction?: string; readonly notchDepth?: number };

async function chevron(page: import('@playwright/test').Page, id: string): Promise<ChevronData> {
  return (await snapshot(page)).document.nodes[id] as ChevronData;
}

test.describe('Épico 01 - Feature 03: Chevron nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria o chevron apontando para a direita pela toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await selectShapeTool(page, variant, 'chevron');
        expect((await snapshot(page)).session.activeTool).toBe('chevron');

        const box = await canvasBox(page, variant);
        await drag(page, { x: box.x + 80, y: box.y + 80 }, { x: box.x + 240, y: box.y + 170 });

        const nodes = Object.values((await snapshot(page)).document.nodes) as ChevronData[];
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toMatchObject({ type: 'chevron', direction: 'right', notchDepth: 0.25 });
        expect(nodes[0]!.width).toBeCloseTo(160, 0);
        expect(nodes[0]!.height).toBeCloseTo(90, 0);
      });

      test(`troca a direção e a profundidade pelo painel preservando a caixa em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await createShape(page, {
          id: 'chev-panel',
          type: 'chevron',
          x: 120,
          y: 110,
          width: 140,
          height: 100,
          rotation: 0,
        });

        await openPropertiesPanel(page, variant);

        const select = variant.isVanilla
          ? page.locator('#select-chevron-direction')
          : page.locator('canvas-properties').locator('select[data-field="direction"]');
        const depth = variant.isVanilla
          ? page.locator('#input-chevron-notch-depth')
          : page.locator('canvas-properties').locator('input[data-field="notchDepth"]');
        await expect(select).toBeVisible();
        await expect(select).toHaveValue('right');
        await expect(depth).toHaveValue('0.25');

        for (const direction of ['down', 'left', 'up']) {
          await select.selectOption(direction);
          await expect
            .poll(async () => (await chevron(page, 'chev-panel')).direction)
            .toBe(direction);
          expect(await chevron(page, 'chev-panel')).toMatchObject({
            x: 120,
            y: 110,
            width: 140,
            height: 100,
          });
        }

        await depth.fill('0.4');
        await depth.dispatchEvent('change');
        await expect
          .poll(async () => (await chevron(page, 'chev-panel')).notchDepth)
          .toBeCloseTo(0.4, 9);

        await depth.fill('2');
        await depth.dispatchEvent('change');
        await expect.poll(async () => (await chevron(page, 'chev-panel')).notchDepth).toBe(0.5);
      });

      test(`redimensiona livre e, com Shift, preserva a proporção em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'chev-resize',
          type: 'chevron',
          x: 150,
          y: 150,
          width: 120,
          height: 60,
          rotation: 0,
        });

        let before = await chevron(page, 'chev-resize');
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! / 2 },
          { x: box.x + before.x! + before.width! + 40, y: box.y + before.y! + before.height! / 2 },
        );
        let after = await chevron(page, 'chev-resize');
        expect(after.width).toBeCloseTo(before.width! + 40, 0);
        expect(after.height).toBeCloseTo(before.height!, 4);

        before = after;
        await page.keyboard.down('Shift');
        await drag(
          page,
          { x: box.x + before.x! + before.width!, y: box.y + before.y! + before.height! },
          { x: box.x + before.x! + before.width! + 60, y: box.y + before.y! + before.height! + 5 },
        );
        await page.keyboard.up('Shift');
        after = await chevron(page, 'chev-resize');
        expect(after.width! / after.height!).toBeCloseTo(before.width! / before.height!, 3);
        expect(after.width).not.toBeCloseTo(before.width!, 1);
      });

      test(`o entalhe vazio não seleciona e o corpo seleciona em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await createShape(page, {
          id: 'chev-hit',
          type: 'chevron',
          x: 100,
          y: 100,
          width: 120,
          height: 120,
          rotation: 0,
          direction: 'right',
          notchDepth: 0.25,
          style: { fill: '#3b82f6' },
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

        // Entalhe da borda oeste (o vértice do entalhe está a 30 da borda, no meio da altura).
        await page.mouse.click(box.x + 108, box.y + 160);
        expect((await snapshot(page)).session.selectedIds).toEqual([]);

        await page.mouse.click(box.x + 160, box.y + 160);
        expect((await snapshot(page)).session.selectedIds).toEqual(['chev-hit']);
      });
    });
  }
});
