import { expect, type Page } from '@playwright/test';
import { useClassicLayout } from './shell.js';

/** Forma mínima do nó que os specs das figuras leem pelo snapshot do canvas. */
export interface NodeData {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly sides?: number;
}

export interface CanvasSnapshotData {
  readonly revision: number;
  readonly document: {
    readonly layers: ReadonlyArray<{
      readonly id: string;
      readonly childIds: readonly string[];
      readonly visible: boolean;
      readonly locked: boolean;
    }>;
    readonly nodes: Record<string, NodeData>;
  };
  readonly session: {
    readonly activeTool: string;
    readonly selectedIds: readonly string[];
  };
}

interface TestCanvasSection {
  getSnapshot: () => CanvasSnapshotData;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setTool: (tool: string) => void;
  setSelection: (ids: readonly string[]) => void;
  dispatch: (command: unknown) => { ok: boolean };
  transact: (commands: readonly unknown[]) => { ok: boolean };
}

interface CanvasSectionWindow {
  __CANVASH_PLAYGROUND__?: { section: TestCanvasSection };
  __CANVASH_REACT__?: { section: TestCanvasSection };
  __CANVASH_VUE__?: { section: TestCanvasSection };
  __CANVASH_WC__?: { canvas: { section?: TestCanvasSection } };
}

export interface Variant {
  readonly name: 'Vanilla' | 'React' | 'Vue' | 'Web Components';
  readonly url: string;
  readonly isVanilla: boolean;
}

/**
 * Endereço de cada exemplo. Cada exemplo isolado tem servidor e porta próprios (5173 a 5176);
 * enquanto um ainda não foi extraído, a página continua no servidor do Vanilla.
 */
export const EXAMPLE_URLS = {
  vanilla: '/',
  /** O Vanilla no layout anterior (barras fixas, canvas de 800 × 600): o das jornadas de teste. */
  vanillaClassic: '/?layout=classic',
  react: 'http://127.0.0.1:5174/',
  vue: 'http://127.0.0.1:5175/',
  wc: 'http://127.0.0.1:5176/',
} as const;

/** Os quatro exemplos que toda figura nova precisa exercitar. */
export const VARIANTS: readonly Variant[] = [
  { name: 'Vanilla', url: EXAMPLE_URLS.vanilla, isVanilla: true },
  { name: 'React', url: EXAMPLE_URLS.react, isVanilla: false },
  { name: 'Vue', url: EXAMPLE_URLS.vue, isVanilla: false },
  { name: 'Web Components', url: EXAMPLE_URLS.wc, isVanilla: false },
];

/**
 * Abre o exemplo, espera o canvas e deixa o documento vazio com a ferramenta de seleção. Nos
 * exemplos com shell, devolve por padrão o layout clássico (toolbar clássica e painéis à direita:
 * ver `useClassicLayout`); `classic: false` mantém o layout de ilhas, para os specs do próprio
 * layout.
 */
export async function openVariant(
  page: Page,
  variant: Variant,
  options: { readonly classic?: boolean } = {},
): Promise<void> {
  await page.goto(
    variant.isVanilla && options.classic !== false ? EXAMPLE_URLS.vanillaClassic : variant.url,
  );
  if (variant.isVanilla) {
    await page.waitForSelector('#canvas-container canvas');
    await page.waitForFunction(() => {
      const w = globalThis as unknown as CanvasSectionWindow;
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
    if (options.classic !== false) await useClassicLayout(page);
  }

  await page.evaluate(() => {
    const w = globalThis as unknown as CanvasSectionWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) return;
    for (const id of Object.keys(section.getSnapshot().document.nodes)) {
      section.dispatch({ type: 'shape.remove', id });
    }
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    section.setTool('select');
    section.setSelection([]);
  });
}

export async function canvasBox(page: Page, variant: Variant) {
  const locator = variant.isVanilla
    ? page.locator('#canvas-container')
    : page.locator('canvas-surface');
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

export async function snapshot(page: Page): Promise<CanvasSnapshotData> {
  return page.evaluate(() => {
    const w = globalThis as unknown as CanvasSectionWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    return section.getSnapshot();
  });
}

/** Despacha `shape.create` na primeira camada e seleciona o nó criado. */
export async function createShape(
  page: Page,
  shape: Record<string, unknown> & { readonly id: string },
): Promise<void> {
  await page.evaluate((input) => {
    const w = globalThis as unknown as CanvasSectionWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) return;
    const layerId = section.getSnapshot().document.layers[0]?.id;
    section.dispatch({ type: 'shape.create', layerId, shape: input });
    section.setSelection([input.id]);
  }, shape);
}

/**
 * Cria um board na primeira camada, adota os filhos dados (`board.attach`) numa só transação e
 * seleciona o board. O nome não repete o do antigo criador de canvas, que o `check:names` proíbe.
 */
export async function createBoardNode(
  page: Page,
  board: Record<string, unknown> & { readonly id: string },
  childIds: readonly string[] = [],
): Promise<void> {
  await page.evaluate(
    ({ input, children }) => {
      const w = globalThis as unknown as CanvasSectionWindow;
      const section =
        w.__CANVASH_PLAYGROUND__?.section ??
        w.__CANVASH_REACT__?.section ??
        w.__CANVASH_VUE__?.section ??
        w.__CANVASH_WC__?.canvas.section;
      if (!section) return;
      const layerId = section.getSnapshot().document.layers[0]?.id;
      const commands: unknown[] = [
        { type: 'shape.create', layerId, shape: { type: 'board', ...input } },
      ];
      if (children.length > 0) {
        commands.push({ type: 'board.attach', boardId: input.id, ids: children });
      }
      const result = section.transact(commands);
      if (!result.ok) throw new Error(`createBoardNode recusado: ${JSON.stringify(result)}`);
      section.setSelection([input.id]);
    },
    { input: board, children: childIds },
  );
}

/** Arrasta com o mouse a partir de um ponto da tela do canvas. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up({ button: 'left' });
}

/** Troca a ferramenta ativa pela API do canvas, sem passar pela toolbar. */
export async function setTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((id) => {
    const w = globalThis as unknown as CanvasSectionWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setTool(id);
  }, tool);
}
