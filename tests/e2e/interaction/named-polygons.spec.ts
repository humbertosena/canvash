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

const PRESETS = [
  { tool: 'pentagon', sides: 5 },
  { tool: 'hexagon', sides: 6 },
  { tool: 'octagon', sides: 8 },
] as const;

test.describe('Épico 01 - Feature 02: Polígonos nomeados nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      for (const { tool, sides } of PRESETS) {
        test(`${tool} cria um polígono de ${sides} lados com caixa 1:1 pela toolbar em ${variant.name}`, async ({
          page,
        }) => {
          await openVariant(page, variant);
          await selectShapeTool(page, variant, tool);
          expect((await snapshot(page)).session.activeTool).toBe(tool);

          const box = await canvasBox(page, variant);
          await drag(page, { x: box.x + 80, y: box.y + 80 }, { x: box.x + 240, y: box.y + 170 });

          const nodes = Object.values((await snapshot(page)).document.nodes);
          expect(nodes).toHaveLength(1);
          const node = nodes[0]!;
          expect(node.type).toBe('polygon');
          expect(node.sides).toBe(sides);
          expect(node.width).toBeCloseTo(160, 0);
          expect(node.height).toBe(node.width);
        });
      }

      test(`redimensiona o hexágono mantendo 1:1 nas alças em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await selectShapeTool(page, variant, 'hexagon');
        await drag(page, { x: box.x + 100, y: box.y + 100 }, { x: box.x + 220, y: box.y + 220 });
        const created = Object.values((await snapshot(page)).document.nodes)[0]!;
        const id = created.id;
        await setTool(page, 'select');
        const read = async (): Promise<NodeData> => (await snapshot(page)).document.nodes[id]!;

        const handles: Array<{
          at: (n: NodeData) => { x: number; y: number };
          dx: number;
          dy: number;
        }> = [
          { at: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! }), dx: 40, dy: 10 },
          { at: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! / 2 }), dx: 20, dy: 0 },
          { at: (n) => ({ x: n.x! + n.width! / 2, y: n.y! + n.height! }), dx: 0, dy: -30 },
          { at: (n) => ({ x: n.x!, y: n.y! }), dx: -20, dy: -5 },
        ];

        for (const handle of handles) {
          const before = await read();
          const point = handle.at(before);
          await drag(
            page,
            { x: box.x + point.x, y: box.y + point.y },
            { x: box.x + point.x + handle.dx, y: box.y + point.y + handle.dy },
          );
          const after = await read();
          expect(after.type).toBe('polygon');
          expect(after.sides).toBe(6);
          expect(after.width).toBeCloseTo(after.height!, 4);
          expect(after.width).not.toBeCloseTo(before.width!, 1);
        }
      });

      test(`troca o octógono para outro polígono pelo painel em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        await createShape(page, {
          id: 'preset-convert',
          type: 'polygon',
          x: 120,
          y: 110,
          width: 140,
          height: 140,
          rotation: 0,
          sides: 8,
        });

        await openPropertiesPanel(page, variant);

        const input = variant.isVanilla
          ? page.locator('#input-polygon-sides')
          : page.locator('canvas-properties').locator('input[data-field="sides"]');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('8');
        await input.fill('3');
        await input.dispatchEvent('change');

        await expect
          .poll(async () => (await snapshot(page)).document.nodes['preset-convert']?.sides)
          .toBe(3);
        expect((await snapshot(page)).document.nodes['preset-convert']).toMatchObject({
          x: 120,
          y: 110,
          width: 140,
          height: 140,
        });
      });
    });
  }
});
