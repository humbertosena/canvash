import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground } from '../helpers/shell.js';

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: {
        getSnapshot: () => {
          document: { nodes: Record<string, unknown> };
          session: {
            selectedIds: readonly string[];
            readOnly: boolean;
            viewport: { zoom: number };
          };
        };
        dispatch: (cmd: unknown) => { ok: boolean };
      };
      readOnly: boolean;
      grid: boolean;
      focus: () => void;
      fitToContent: (opts?: { padding?: number }) => void;
    };
    events: Array<{ type: string; detail: unknown }>;
  };
}

test.describe('Web Components: <canvas-surface> (Tarefa 54 - WC-01)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
  });

  test('monta o editor sem React nem Vue e emite canvas-ready expondo a instância (WC-01)', async ({
    page,
  }) => {
    // 1. Aguarda o evento canvas-ready ter sido disparado
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.events.some((e) => e.type === 'canvas-ready');
    });

    // 2. Confere que a instância do canvas está disponível na propriedade do elemento
    const isReady = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      return section !== undefined && typeof section.getSnapshot === 'function';
    });
    expect(isReady).toBe(true);

    // 3. Verifica que o Shadow DOM foi criado e contém o canvas interno montado
    const hasCanvasInShadow = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document?: {
          querySelector: (sel: string) => {
            shadowRoot?: { querySelector: (sel: string) => unknown };
          } | null;
        };
      };
      const el = g.document?.querySelector('canvas-surface');
      const shadow = el?.shadowRoot;
      const internalCanvas = shadow?.querySelector('canvas');
      return internalCanvas !== null && internalCanvas !== undefined;
    });
    expect(hasCanvasInShadow).toBe(true);
  });

  test('edita o documento e despacha eventos no host nativo (WC-01)', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section !== undefined;
    });

    // Clica no botão para adicionar um retângulo via script do exemplo
    await clickInPlayground(page, '#btn-add-rect');

    // Confere que o evento document-change foi emitido para o host
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.events.some((e) => e.type === 'document-change');
    });

    // Confere que o nó foi criado no documento
    const nodeCount = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      return Object.keys(nodes).length;
    });
    expect(nodeCount).toBeGreaterThanOrEqual(1);
  });

  test('suporta alternância do atributo readonly e recusa comandos de escrita', async ({
    page,
  }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section !== undefined;
    });

    // Ativa readonly via botão
    await clickInPlayground(page, '#btn-toggle-readonly');

    const isReadOnly = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.readOnly;
    });
    expect(isReadOnly).toBe(true);

    // Tentar despachar comando de escrita deve falhar por estar readonly
    const dispatchResult = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.dispatch({
        type: 'shape.create',
        shape: {
          id: 'blocked-rect',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#f00', stroke: '#000', strokeWidth: 1, opacity: 1 },
        },
      });
    });
    expect(dispatchResult?.ok).toBe(false);
  });

  test('suporta fitToContent e ajuste de viewport', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section !== undefined;
    });

    // Adiciona retângulo para garantir que há conteúdo
    await clickInPlayground(page, '#btn-add-rect');

    // Clica em fitToContent
    await clickInPlayground(page, '#btn-fit');

    // Confere que o zoom e viewport foram ajustados
    const zoom = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.viewport.zoom;
    });
    expect(zoom).toBeDefined();
    expect(zoom).toBeGreaterThan(0);
  });

  test('método focus() transfere o foco para o componente', async ({ page }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.focus();
    });

    const isFocused = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document?: {
          activeElement?: unknown;
          querySelector: (sel: string) => unknown;
        };
      };
      const el = g.document?.querySelector('canvas-surface');
      return g.document?.activeElement === el;
    });
    expect(isFocused).toBe(true);
  });
});
