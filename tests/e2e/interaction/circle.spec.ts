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
      undo: () => { ok: boolean };
      redo: () => { ok: boolean };
    };
  };
  __CANVASH_REACT__?: {
    section: {
      getSnapshot: () => CanvasSnapshotData;
      setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      setTool: (tool: string) => void;
      setSelection: (ids: readonly string[]) => void;
      dispatch: (cmd: unknown) => { ok: boolean };
      undo: () => { ok: boolean };
      redo: () => { ok: boolean };
    };
  };
  __CANVASH_VUE__?: {
    section: {
      getSnapshot: () => CanvasSnapshotData;
      setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      setTool: (tool: string) => void;
      setSelection: (ids: readonly string[]) => void;
      dispatch: (cmd: unknown) => { ok: boolean };
      undo: () => { ok: boolean };
      redo: () => { ok: boolean };
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
        undo: () => { ok: boolean };
        redo: () => { ok: boolean };
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

  // Limpa nós existentes e reseta viewport/ferramenta para ambiente determinístico
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

test.describe('Épico 01 - Feature 02: Figura Geométrica "Círculo" nos 4 Exemplos (Tarefa 100)', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria círculo 1:1 por arrasto assimétrico via botão da toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);

        // Ativa ferramenta circle pela UI
        if (variant.isVanilla) {
          await page.click('#btn-tool-circle');
        } else {
          await selectShapeTool(page, variant, 'circle');
        }

        const snapAfterTool = await getCanvasSnapshot(page);
        expect(snapAfterTool.session.activeTool).toBe('circle');

        const box = await getCanvasBox(page, variant);
        const startX = box.x + 80;
        const startY = box.y + 80;

        // Arrasta assimetricamente: dx = 140, dy = 85 -> size esperado = max(140, 85) = 140
        await page.mouse.move(startX, startY);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(startX + 140, startY + 85, { steps: 10 });
        await page.mouse.up({ button: 'left' });

        const finalSnap = await getCanvasSnapshot(page);
        const nodes = Object.values(finalSnap.document.nodes);
        expect(nodes).toHaveLength(1);
        const cir = nodes[0]!;
        expect(cir.type).toBe('circle');
        expect(cir.width).toBeCloseTo(140, 0);
        expect(cir.height).toBeCloseTo(140, 0);
        expect(cir.width).toBe(cir.height);
      });

      test(`redimensiona círculo mantendo proporção 1:1 compulsória nas 8 alças sem Shift em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);

        // Cria círculo inicial 100x100 em (150, 150) e seleciona
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
              id: 'cir-resize',
              type: 'circle',
              x: 150,
              y: 150,
              width: 100,
              height: 100,
              rotation: 0,
            },
          });
          section.setSelection(['cir-resize']);
        });

        // Testa as 8 alças (nw, n, ne, e, se, s, sw, w) sem Shift
        const handleOffsets: Array<{
          handle: string;
          getPoint: (n: NodeData) => { x: number; y: number };
          dx: number;
          dy: number;
        }> = [
          {
            handle: 'se',
            getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! }),
            dx: 40,
            dy: 10,
          },
          {
            handle: 'e',
            getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! + n.height! / 2 }),
            dx: 20,
            dy: 0,
          },
          {
            handle: 's',
            getPoint: (n) => ({ x: n.x! + n.width! / 2, y: n.y! + n.height! }),
            dx: 0,
            dy: -30,
          },
          {
            handle: 'nw',
            getPoint: (n) => ({ x: n.x!, y: n.y! }),
            dx: -20,
            dy: -5,
          },
          {
            handle: 'n',
            getPoint: (n) => ({ x: n.x! + n.width! / 2, y: n.y! }),
            dx: 0,
            dy: 20,
          },
          {
            handle: 'ne',
            getPoint: (n) => ({ x: n.x! + n.width!, y: n.y! }),
            dx: 25,
            dy: -10,
          },
          {
            handle: 'sw',
            getPoint: (n) => ({ x: n.x!, y: n.y! + n.height! }),
            dx: -15,
            dy: 30,
          },
          {
            handle: 'w',
            getPoint: (n) => ({ x: n.x!, y: n.y! + n.height! / 2 }),
            dx: 25,
            dy: 0,
          },
        ];

        for (const item of handleOffsets) {
          const snapBefore = await getCanvasSnapshot(page);
          const nodeBefore = snapBefore.document.nodes['cir-resize']!;
          const pt = item.getPoint(nodeBefore);

          await page.mouse.move(box.x + pt.x, box.y + pt.y);
          await page.mouse.down({ button: 'left' });
          await page.mouse.move(box.x + pt.x + item.dx, box.y + pt.y + item.dy, { steps: 5 });
          await page.mouse.up({ button: 'left' });

          const snapAfter = await getCanvasSnapshot(page);
          const nodeAfter = snapAfter.document.nodes['cir-resize']!;
          expect(nodeAfter.type).toBe('circle');
          expect(nodeAfter.width).toBeCloseTo(nodeAfter.height!, 4);
          expect(nodeAfter.width).not.toBeCloseTo(nodeBefore.width!, 1);
        }
      });

      test(`converte Elipse ⇄ Círculo pela UI aplicando regra de contenção min(W, H) em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);

        // Cria uma elipse 200x120 em (100, 100) -> centro (200, 160)
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
              id: 'conv-ellipse',
              type: 'ellipse',
              x: 100,
              y: 100,
              width: 200,
              height: 120,
              rotation: 0,
            },
          });
          section.setSelection(['conv-ellipse']);
        });

        // 1. Converte Elipse -> Círculo via botão da UI
        await openPropertiesPanel(page, variant);
        if (variant.isVanilla) {
          const btn = page.locator('#btn-convert-type');
          await expect(btn).toHaveAttribute('data-action', 'convert-to-circle');
          await btn.click();
        } else {
          const btn = page
            .locator('canvas-properties')
            .locator('button[data-action="convert-to-circle"]');
          await expect(btn).toBeVisible();
          await btn.click();
        }

        const snapCircle = await getCanvasSnapshot(page);
        const cirNode = snapCircle.document.nodes['conv-ellipse']!;
        expect(cirNode.type).toBe('circle');
        // min(200, 120) = 120; centro (200, 160) -> x = 200 - 60 = 140, y = 160 - 60 = 100
        expect(cirNode.width).toBe(120);
        expect(cirNode.height).toBe(120);
        expect(cirNode.x).toBe(140);
        expect(cirNode.y).toBe(100);

        // 2. Converte Círculo -> Elipse via botão da UI
        await openPropertiesPanel(page, variant);
        if (variant.isVanilla) {
          const btn = page.locator('#btn-convert-type');
          await expect(btn).toHaveAttribute('data-action', 'convert-to-ellipse');
          await btn.click();
        } else {
          const btn = page
            .locator('canvas-properties')
            .locator('button[data-action="convert-to-ellipse"]');
          await expect(btn).toBeVisible();
          await btn.click();
        }

        const snapEllipseAgain = await getCanvasSnapshot(page);
        const ellipseNode = snapEllipseAgain.document.nodes['conv-ellipse']!;
        expect(ellipseNode.type).toBe('ellipse');
        expect(ellipseNode.width).toBe(120);
        expect(ellipseNode.height).toBe(120);
      });
    });
  }
});
