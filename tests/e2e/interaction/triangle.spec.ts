import { expect, test, type Page } from '@playwright/test';
import { selectShapeTool } from '../helpers/toolbar.js';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { openPropertiesPanel, useClassicLayout } from '../helpers/shell.js';

interface NodeData {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly variant?: string;
  readonly apex?: number;
}

interface CanvasSnapshotData {
  readonly revision: number;
  readonly document: {
    readonly nodes: Record<string, NodeData>;
  };
  readonly session: {
    readonly activeTool: string;
    readonly selectedIds: readonly string[];
  };
}

interface AnyPlaygroundWindow {
  __CANVASH_PLAYGROUND__?: {
    section: {
      getSnapshot: () => CanvasSnapshotData;
      setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      setTool: (tool: string) => void;
      setSelection: (ids: readonly string[]) => void;
      dispatch: (cmd: unknown) => { ok: boolean };
    };
  };
  __CANVASH_REACT__?: {
    section: {
      getSnapshot: () => CanvasSnapshotData;
      setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      setTool: (tool: string) => void;
      setSelection: (ids: readonly string[]) => void;
      dispatch: (cmd: unknown) => { ok: boolean };
    };
  };
  __CANVASH_VUE__?: {
    section: {
      getSnapshot: () => CanvasSnapshotData;
      setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      setTool: (tool: string) => void;
      setSelection: (ids: readonly string[]) => void;
      dispatch: (cmd: unknown) => { ok: boolean };
    };
  };
  __CANVASH_WC__?: {
    canvas: {
      section?: {
        getSnapshot: () => CanvasSnapshotData;
        setViewport: (vp: { x: number; y: number; zoom: number }) => void;
        setTool: (tool: string) => void;
        setSelection: (ids: readonly string[]) => void;
        dispatch: (cmd: unknown) => { ok: boolean };
      };
    };
  };
}

interface VariantConfig {
  readonly name: 'Vanilla' | 'React' | 'Vue' | 'Web Components';
  readonly url: string;
  readonly isVanilla: boolean;
}

const VARIANTS: readonly VariantConfig[] = [
  { name: 'Vanilla', url: EXAMPLE_URLS.vanillaClassic, isVanilla: true },
  { name: 'React', url: EXAMPLE_URLS.react, isVanilla: false },
  { name: 'Vue', url: EXAMPLE_URLS.vue, isVanilla: false },
  { name: 'Web Components', url: EXAMPLE_URLS.wc, isVanilla: false },
];

async function waitForVariantReady(page: Page, variant: VariantConfig): Promise<void> {
  await page.goto(variant.url);
  if (variant.isVanilla) {
    await page.waitForSelector('#canvas-container canvas');
    await page.waitForFunction(() => {
      const w = globalThis as unknown as AnyPlaygroundWindow;
      return w.__CANVASH_PLAYGROUND__?.section !== undefined;
    });
  } else {
    await page.waitForSelector('canvas-surface');
    await page.waitForFunction(() => {
      const el = document.querySelector('canvas-surface') as HTMLElement & {
        section?: unknown;
        shadowRoot?: ShadowRoot | null;
      };
      return (
        el !== null &&
        el.section !== undefined &&
        el.shadowRoot !== null &&
        el.shadowRoot.querySelector('canvas') !== null
      );
    });
  }

  await page.evaluate(() => {
    const w = globalThis as unknown as AnyPlaygroundWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) return;
    const snap = section.getSnapshot();
    for (const id of Object.keys(snap.document.nodes)) {
      section.dispatch({ type: 'shape.remove', id });
    }
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    section.setTool('select');
    section.setSelection([]);
  });
  await useClassicLayout(page);
}

async function getCanvasBox(page: Page, variant: VariantConfig) {
  const locator = variant.isVanilla
    ? page.locator('#canvas-container')
    : page.locator('canvas-surface');
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function getCanvasSnapshot(page: Page): Promise<CanvasSnapshotData> {
  return page.evaluate(() => {
    const w = globalThis as unknown as AnyPlaygroundWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    return section.getSnapshot();
  });
}

async function createTriangle(
  page: Page,
  shape: { id: string; x: number; y: number; width: number; variant: string; height?: number },
): Promise<void> {
  await page.evaluate((s) => {
    const w = globalThis as unknown as AnyPlaygroundWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) return;
    const layerId = (section.getSnapshot().document as unknown as { layers: Array<{ id: string }> })
      .layers[0]?.id;
    section.dispatch({
      type: 'shape.create',
      layerId,
      shape: {
        id: s.id,
        type: 'triangle',
        x: s.x,
        y: s.y,
        width: s.width,
        // O equilátero exige H = W·√3/2; calculado aqui para não depender de arredondamento.
        height: s.height ?? (s.width * Math.sqrt(3)) / 2,
        rotation: 0,
        variant: s.variant,
      },
    });
    section.setSelection([s.id]);
  }, shape);
}

async function chooseVariant(page: Page, variant: VariantConfig, value: string): Promise<void> {
  await openPropertiesPanel(page, variant);
  const select = variant.isVanilla
    ? page.locator('#select-triangle-variant')
    : page.locator('canvas-properties').locator('select[data-field="variant"]');
  await expect(select).toBeVisible();
  await select.selectOption(value);
}

async function setApex(page: Page, variant: VariantConfig, value: string): Promise<void> {
  await openPropertiesPanel(page, variant);
  const input = variant.isVanilla
    ? page.locator('#input-triangle-apex')
    : page.locator('canvas-properties').locator('input[data-field="apex"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.dispatchEvent('change');
}

test.describe('Épico 01 - Feature 04: Figura Geométrica "Triângulo" nos 4 Exemplos (Tarefa 106)', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria triângulo isósceles por arrasto via botão da toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);

        if (variant.isVanilla) {
          await page.click('#btn-tool-triangle');
        } else {
          await selectShapeTool(page, variant, 'triangle');
        }

        const snapAfterTool = await getCanvasSnapshot(page);
        expect(snapAfterTool.session.activeTool).toBe('triangle');

        const box = await getCanvasBox(page, variant);
        const startX = box.x + 80;
        const startY = box.y + 80;

        await page.mouse.move(startX, startY);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(startX + 160, startY + 90, { steps: 10 });
        await page.mouse.up({ button: 'left' });

        const finalSnap = await getCanvasSnapshot(page);
        const nodes = Object.values(finalSnap.document.nodes);
        expect(nodes).toHaveLength(1);
        const t = nodes[0]!;
        expect(t.type).toBe('triangle');
        expect(t.variant).toBe('isosceles');
        expect(t.apex).toBe(0.5);
        expect(t.width).toBeCloseTo(160, 0);
        expect(t.height).toBeCloseTo(90, 0);
      });

      test(`converte entre as 4 variantes e edita o ápice do escaleno pelo painel em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        // Caixa 200x120 em (100, 100): centro (200, 160)
        await createTriangle(page, {
          id: 'tri-conv',
          x: 100,
          y: 100,
          width: 200,
          height: 120,
          variant: 'isosceles',
        });
        const node = async (): Promise<NodeData> =>
          (await getCanvasSnapshot(page)).document.nodes['tri-conv']!;

        await chooseVariant(page, variant, 'right');
        expect(await node()).toMatchObject({
          variant: 'right',
          apex: 0,
          x: 100,
          y: 100,
          width: 200,
          height: 120,
        });

        // De apex 0 (coincide com o retângulo) para escaleno: vira 0,3
        await chooseVariant(page, variant, 'scalene');
        expect(await node()).toMatchObject({ variant: 'scalene', apex: 0.3, width: 200 });

        await setApex(page, variant, '0.75');
        await expect.poll(async () => (await node()).apex).toBe(0.75);

        // H = 120 < W·√3/2 ≈ 173,2: H' = 120 e W' = 2·120/√3, no mesmo centro
        await chooseVariant(page, variant, 'equilateral');
        const eq = await node();
        const expectedWidth = 240 / Math.sqrt(3);
        expect(eq.variant).toBe('equilateral');
        expect(eq.apex).toBe(0.5);
        expect(eq.height).toBeCloseTo(120, 6);
        expect(eq.width).toBeCloseTo(expectedWidth, 6);
        expect(eq.x).toBeCloseTo(200 - expectedWidth / 2, 6);
        expect(eq.y).toBeCloseTo(100, 6);

        await chooseVariant(page, variant, 'isosceles');
        const iso = await node();
        expect(iso.variant).toBe('isosceles');
        expect(iso.apex).toBe(0.5);
        expect(iso.width).toBeCloseTo(expectedWidth, 6);
        expect(iso.height).toBeCloseTo(120, 6);
      });

      test(`redimensiona equilátero com proporção travada em √3/2 sem Shift em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createTriangle(page, {
          id: 'tri-eq',
          x: 150,
          y: 150,
          width: 120,
          variant: 'equilateral',
        });

        const handles: Array<{
          getPoint: (n: NodeData) => { x: number; y: number };
          dx: number;
          dy: number;
        }> = [
          { getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! }), dx: 40, dy: 10 },
          { getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! / 2 }), dx: 30, dy: 0 },
          { getPoint: (n) => ({ x: n.x! + n.width! / 2, y: n.y! + n.height! }), dx: 0, dy: -30 },
          { getPoint: (n) => ({ x: n.x!, y: n.y! }), dx: -20, dy: -5 },
        ];

        for (const item of handles) {
          const nodeBefore = (await getCanvasSnapshot(page)).document.nodes['tri-eq']!;
          const pt = item.getPoint(nodeBefore);

          await page.mouse.move(box.x + pt.x, box.y + pt.y);
          await page.mouse.down({ button: 'left' });
          await page.mouse.move(box.x + pt.x + item.dx, box.y + pt.y + item.dy, { steps: 5 });
          await page.mouse.up({ button: 'left' });

          const nodeAfter = (await getCanvasSnapshot(page)).document.nodes['tri-eq']!;
          expect(nodeAfter.type).toBe('triangle');
          expect(nodeAfter.variant).toBe('equilateral');
          expect(nodeAfter.height! / nodeAfter.width!).toBeCloseTo(Math.sqrt(3) / 2, 6);
          expect(nodeAfter.width).not.toBeCloseTo(nodeBefore.width!, 1);
        }
      });

      test(`redimensiona isósceles livremente e clique no canto vazio da caixa não seleciona em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createTriangle(page, {
          id: 'tri-free',
          x: 100,
          y: 100,
          width: 160,
          height: 100,
          variant: 'isosceles',
        });

        // Alça leste em (260, 150): +40 px só na largura
        await page.mouse.move(box.x + 260, box.y + 150);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(box.x + 300, box.y + 150, { steps: 5 });
        await page.mouse.up({ button: 'left' });

        const resized = (await getCanvasSnapshot(page)).document.nodes['tri-free']!;
        expect(resized.width).toBeCloseTo(200, 0);
        expect(resized.height).toBeCloseTo(100, 0);

        await page.evaluate(() => {
          const w = globalThis as unknown as AnyPlaygroundWindow;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          section?.setSelection([]);
        });

        // Canto superior esquerdo da caixa (105, 105) fica fora do triângulo
        await page.mouse.click(box.x + 105, box.y + 105);
        expect((await getCanvasSnapshot(page)).session.selectedIds).toEqual([]);

        // Perto da base, no centro (200, 190), fica dentro
        await page.mouse.click(box.x + 200, box.y + 190);
        expect((await getCanvasSnapshot(page)).session.selectedIds).toEqual(['tri-free']);
      });
    });
  }
});
