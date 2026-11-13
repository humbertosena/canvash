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
  readonly sides?: number;
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

async function createPolygon(
  page: Page,
  shape: { id: string; x: number; y: number; size: number; sides: number },
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
        type: 'polygon',
        x: s.x,
        y: s.y,
        width: s.size,
        height: s.size,
        rotation: 0,
        sides: s.sides,
      },
    });
    section.setSelection([s.id]);
  }, shape);
}

async function setSides(page: Page, variant: VariantConfig, value: string): Promise<void> {
  await openPropertiesPanel(page, variant);
  const input = variant.isVanilla
    ? page.locator('#input-polygon-sides')
    : page.locator('canvas-properties').locator('input[data-field="sides"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.dispatchEvent('change');
}

test.describe('Épico 01 - Feature 05: Figura Geométrica "Polígono" nos 4 Exemplos (Tarefa 109)', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria polígono de 5 lados com caixa 1:1 por arrasto assimétrico via toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);

        if (variant.isVanilla) {
          await page.click('#btn-tool-polygon');
        } else {
          await selectShapeTool(page, variant, 'polygon');
        }
        expect((await getCanvasSnapshot(page)).session.activeTool).toBe('polygon');

        const box = await getCanvasBox(page, variant);
        const startX = box.x + 80;
        const startY = box.y + 80;
        await page.mouse.move(startX, startY);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(startX + 160, startY + 90, { steps: 10 });
        await page.mouse.up({ button: 'left' });

        const nodes = Object.values((await getCanvasSnapshot(page)).document.nodes);
        expect(nodes).toHaveLength(1);
        const pg = nodes[0]!;
        expect(pg.type).toBe('polygon');
        expect(pg.sides).toBe(5);
        expect(pg.width).toBeCloseTo(160, 0);
        expect(pg.height).toBe(pg.width);
      });

      test(`redimensiona polígono mantendo 1:1 nas alças sem Shift em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createPolygon(page, { id: 'pg-resize', x: 150, y: 150, size: 100, sides: 6 });

        const handles: Array<{
          getPoint: (n: NodeData) => { x: number; y: number };
          dx: number;
          dy: number;
        }> = [
          { getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! }), dx: 40, dy: 10 },
          { getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! / 2 }), dx: 20, dy: 0 },
          { getPoint: (n) => ({ x: n.x! + n.width! / 2, y: n.y! + n.height! }), dx: 0, dy: -30 },
          { getPoint: (n) => ({ x: n.x!, y: n.y! }), dx: -20, dy: -5 },
        ];

        for (const item of handles) {
          const nodeBefore = (await getCanvasSnapshot(page)).document.nodes['pg-resize']!;
          const pt = item.getPoint(nodeBefore);
          await page.mouse.move(box.x + pt.x, box.y + pt.y);
          await page.mouse.down({ button: 'left' });
          await page.mouse.move(box.x + pt.x + item.dx, box.y + pt.y + item.dy, { steps: 5 });
          await page.mouse.up({ button: 'left' });

          const nodeAfter = (await getCanvasSnapshot(page)).document.nodes['pg-resize']!;
          expect(nodeAfter.type).toBe('polygon');
          expect(nodeAfter.sides).toBe(6);
          expect(nodeAfter.width).toBeCloseTo(nodeAfter.height!, 4);
          expect(nodeAfter.width).not.toBeCloseTo(nodeBefore.width!, 1);
        }
      });

      test(`troca o número de lados pelo painel mantendo centro e tamanho em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        await createPolygon(page, { id: 'pg-sides', x: 120, y: 110, size: 140, sides: 5 });
        const node = async (): Promise<NodeData> =>
          (await getCanvasSnapshot(page)).document.nodes['pg-sides']!;

        await setSides(page, variant, '8');
        await expect.poll(async () => (await node()).sides).toBe(8);
        expect(await node()).toMatchObject({ x: 120, y: 110, width: 140, height: 140 });

        await setSides(page, variant, '3');
        await expect.poll(async () => (await node()).sides).toBe(3);
        expect(await node()).toMatchObject({ x: 120, y: 110, width: 140, height: 140 });
      });

      test(`clique no canto vazio da caixa não seleciona e no centro seleciona em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createPolygon(page, { id: 'pg-hit', x: 100, y: 100, size: 120, sides: 5 });
        await page.evaluate(() => {
          const w = globalThis as unknown as AnyPlaygroundWindow;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          section?.setSelection([]);
        });

        // Canto inferior esquerdo da caixa (105, 215): abaixo e à esquerda da base do pentágono
        await page.mouse.click(box.x + 105, box.y + 215);
        expect((await getCanvasSnapshot(page)).session.selectedIds).toEqual([]);

        await page.mouse.click(box.x + 160, box.y + 160);
        expect((await getCanvasSnapshot(page)).session.selectedIds).toEqual(['pg-hit']);
      });
    });
  }
});
