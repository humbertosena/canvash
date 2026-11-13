import { expect, test, type Page } from '@playwright/test';
import { selectShapeTool } from '../helpers/toolbar.js';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { useClassicLayout } from '../helpers/shell.js';

interface NodeData {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
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

test.describe('Épico 01 - Feature 03: Figura Geométrica "Losango" nos 4 Exemplos (Tarefa 103)', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria losango por arrasto assimétrico via botão da toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);

        if (variant.isVanilla) {
          await page.click('#btn-tool-diamond');
        } else {
          await selectShapeTool(page, variant, 'diamond');
        }

        const snapAfterTool = await getCanvasSnapshot(page);
        expect(snapAfterTool.session.activeTool).toBe('diamond');

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
        const d = nodes[0]!;
        expect(d.type).toBe('diamond');
        expect(d.width).toBeCloseTo(160, 0);
        expect(d.height).toBeCloseTo(90, 0);
      });

      test(`redimensiona losango livremente sem Shift e clique no canto vazio da caixa não seleciona em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);

        // Cria losango 160x100 em (100, 100) e seleciona
        await page.evaluate(() => {
          const w = globalThis as unknown as AnyPlaygroundWindow;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          if (!section) return;
          const layerId = (
            section.getSnapshot().document as unknown as { layers: Array<{ id: string }> }
          ).layers[0]?.id;
          section.dispatch({
            type: 'shape.create',
            layerId,
            shape: {
              id: 'diamond-test',
              type: 'diamond',
              x: 100,
              y: 100,
              width: 160,
              height: 100,
              rotation: 0,
              style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 1 },
            },
          });
          section.setSelection(['diamond-test']);
        });

        // Redimensiona alça leste ('e') em +40px horizontalmente -> largura vai para 200, altura permanece 100
        await page.mouse.move(box.x + 260, box.y + 150);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(box.x + 300, box.y + 150, { steps: 5 });
        await page.mouse.up({ button: 'left' });

        const snapAfterResize = await getCanvasSnapshot(page);
        const nodeAfter = snapAfterResize.document.nodes['diamond-test']!;
        expect(nodeAfter.type).toBe('diamond');
        expect(nodeAfter.width).toBeCloseTo(200, 0);
        expect(nodeAfter.height).toBeCloseTo(100, 0);

        // Limpa seleção e clica no canto superior-esquerdo da caixa (105, 105), fora do losango
        await page.evaluate(() => {
          const w = globalThis as unknown as AnyPlaygroundWindow;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          section?.setSelection([]);
        });

        await page.mouse.click(box.x + 105, box.y + 105);
        const snapCornerClick = await getCanvasSnapshot(page);
        expect(snapCornerClick.session.selectedIds).toEqual([]);

        // Clica no centro do losango (200, 150) -> seleciona
        await page.mouse.click(box.x + 200, box.y + 150);
        const snapCenterClick = await getCanvasSnapshot(page);
        expect(snapCenterClick.session.selectedIds).toEqual(['diamond-test']);
      });
    });
  }
});
