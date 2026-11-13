import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { openPropertiesPanel, useClassicLayout } from '../helpers/shell.js';
import { selectDrawTool } from '../helpers/toolbar.js';

interface NodeData {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly start?: { readonly x: number; readonly y: number };
  readonly end?: { readonly x: number; readonly y: number };
  readonly control1?: { readonly x: number; readonly y: number };
  readonly control2?: { readonly x: number; readonly y: number };
  readonly symmetric?: boolean;
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

async function createCurve(page: Page): Promise<void> {
  // Arco padrão de (100, 200) a (220, 200): controles em (140, 170) e (180, 170), topo em y 177,5
  await page.evaluate(() => {
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
        id: 'bz',
        type: 'bezier',
        start: { x: 100, y: 200 },
        end: { x: 220, y: 200 },
        style: { stroke: '#7c3aed', strokeWidth: 3 },
      },
    });
    section.setSelection(['bz']);
  });
}

async function curve(page: Page): Promise<NodeData> {
  return (await getCanvasSnapshot(page)).document.nodes['bz']!;
}

async function drag(
  page: Page,
  box: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
  await page.mouse.up({ button: 'left' });
}

test.describe('Épico 01 - Feature 06: Curva Bézier nos 4 Exemplos (Tarefa 113)', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`cria a curva simétrica em arco por arrasto via toolbar em ${variant.name}`, async ({
        page,
      }) => {
        await waitForVariantReady(page, variant);
        if (variant.isVanilla) {
          await page.click('#btn-tool-bezier');
        } else {
          await selectDrawTool(page, variant, 'bezier');
        }
        expect((await getCanvasSnapshot(page)).session.activeTool).toBe('bezier');

        const box = await getCanvasBox(page, variant);
        await drag(page, box, { x: 80, y: 160 }, { x: 260, y: 160 });

        const nodes = Object.values((await getCanvasSnapshot(page)).document.nodes);
        expect(nodes).toHaveLength(1);
        const created = nodes[0]!;
        expect(created.type).toBe('bezier');
        expect(created.symmetric).toBe(true);
        const chord = created.end!.x - created.start!.x;
        expect(chord).toBeCloseTo(180, 0);
        // Controles a 1/3 e 2/3 da corda, 1/4 dela acima da corda
        expect(created.control1!.x - created.start!.x).toBeCloseTo(chord / 3, 3);
        expect(created.start!.y - created.control1!.y).toBeCloseTo(chord / 4, 3);
        expect(created.control2!.y).toBeCloseTo(created.control1!.y, 6);
      });

      test(`arrastar um controle espelha o outro em ${variant.name}`, async ({ page }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createCurve(page);

        await drag(page, box, { x: 140, y: 170 }, { x: 130, y: 120 });

        const node = await curve(page);
        expect(node.control1!.x).toBeCloseTo(130, 0);
        expect(node.control1!.y).toBeCloseTo(120, 0);
        expect(node.control2!.x).toBeCloseTo(190, 0);
        expect(node.control2!.y).toBeCloseTo(120, 0);
        expect(node.start).toEqual({ x: 100, y: 200 });
      });

      test(`a alça da caixa escala a curva por igual em ${variant.name}`, async ({ page }) => {
        await waitForVariantReady(page, variant);
        const box = await getCanvasBox(page, variant);
        await createCurve(page);

        // Alça n no topo da caixa (160, 177,5): subir 22,5 dobra a altura e a largura
        await drag(page, box, { x: 160, y: 177.5 }, { x: 160, y: 155 });

        const node = await curve(page);
        expect(node.end!.x - node.start!.x).toBeCloseTo(240, 0);
        expect(node.start!.y).toBeCloseTo(200, 0);
        expect((node.start!.x + node.end!.x) / 2).toBeCloseTo(160, 0);
        expect(node.start!.y - node.control1!.y).toBeCloseTo(60, 0);
      });

      test(`o painel desliga e religa a simetria em ${variant.name}`, async ({ page }) => {
        await waitForVariantReady(page, variant);
        await createCurve(page);
        await openPropertiesPanel(page, variant);

        const checkbox = variant.isVanilla
          ? page.locator('#input-bezier-symmetric')
          : page.locator('canvas-properties').locator('input[data-field="symmetric"]');

        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();
        await expect.poll(async () => (await curve(page)).symmetric).toBe(false);

        await page.evaluate(() => {
          const w = globalThis as unknown as AnyPlaygroundWindow;
          const section =
            w.__CANVASH_PLAYGROUND__?.section ??
            w.__CANVASH_REACT__?.section ??
            w.__CANVASH_VUE__?.section ??
            w.__CANVASH_WC__?.canvas.section;
          section?.dispatch({
            type: 'shape.update',
            id: 'bz',
            patch: { control2: { x: 230, y: 120 } },
          });
        });
        expect((await curve(page)).control2).toEqual({ x: 230, y: 120 });

        await checkbox.check();
        await expect.poll(async () => (await curve(page)).symmetric).toBe(true);
        // Religar re-espelha control2 a partir de control1 (140, 170)
        const node = await curve(page);
        expect(node.control2!.x).toBeCloseTo(180, 6);
        expect(node.control2!.y).toBeCloseTo(170, 6);
      });
    });
  }
});
