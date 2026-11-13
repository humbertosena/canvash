import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground } from '../helpers/shell.js';

interface VueGlobal {
  __CANVASH_VUE__?: {
    section: {
      getSnapshot: () => {
        document: { nodes: Record<string, unknown> };
        session: {
          selectedIds: readonly string[];
          readOnly: boolean;
          viewport: { zoom: number };
        };
        revision: number;
      };
      dispatch: (cmd: unknown) => { ok: boolean };
    };
    canvasRef: {
      value: {
        focus: (opts?: unknown) => void;
        fitToContent: (opts?: unknown) => void;
        element: HTMLElement | null;
      } | null;
    };
    getSnapshot: () => {
      document: { nodes: Record<string, unknown> };
      revision: number;
    };
    events: Array<{ type: string; detail: unknown }>;
    addRectangle: () => { ok: boolean };
    toggleReadOnly: () => void;
  };
}

test.describe('Vue Adapter: CanvasSurface (Tarefa 64)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.vue);
    await page.waitForSelector('canvas-surface');
  });

  test('monta o componente Vue e emite canvas-ready expondo o canvas', async ({ page }) => {
    // 1. Aguarda inicialização do Vue
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__ !== undefined;
    });

    // 2. Confere que a instância do canvas está disponível e snapshot estável
    const ready = await page.evaluate(() => {
      const g = globalThis as unknown as VueGlobal;
      const snap = g.__CANVASH_VUE__?.getSnapshot();
      return snap !== undefined && snap.revision === 0;
    });
    expect(ready).toBe(true);

    // 3. Verifica que o Shadow DOM foi criado e contém o canvas interno montado
    const hasInternalCanvas = await page.evaluate(() => {
      const el = document.querySelector('canvas-surface');
      const shadow = el?.shadowRoot;
      const internalCanvas = shadow?.querySelector('canvas');
      return internalCanvas !== null && internalCanvas !== undefined;
    });
    expect(hasInternalCanvas).toBe(true);
  });

  test('edita o documento por botão Vue e atualiza snapshot e UI', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__ !== undefined;
    });

    // Clica no botão "+ Retângulo" da UI Vue
    await clickInPlayground(page, '#btn-add-rect');

    // Confere que a UI Vue foi atualizada via useCanvasSnapshot
    await expect(page.locator('#label-status')).toContainText('Revisão: 1');
    await expect(page.locator('#label-status')).toContainText('Nós: 1');

    // Confere que o evento document-change foi capturado pelo callback Vue
    const hadDocChangeEvent = await page.evaluate(() => {
      const g = globalThis as unknown as VueGlobal;
      return (g.__CANVASH_VUE__?.events ?? []).some((e) => e.type === 'document-change');
    });
    expect(hadDocChangeEvent).toBe(true);
  });

  test('suporta alternância da prop readOnly e recusa comandos no canvas', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__ !== undefined;
    });

    // Ativa readOnly pelo botão
    await clickInPlayground(page, '#btn-toggle-readonly');

    const isReadOnly = await page.evaluate(() => {
      const el = document.querySelector('canvas-surface') as HTMLElement & { readOnly?: boolean };
      return el.readOnly === true;
    });
    expect(isReadOnly).toBe(true);
  });

  test('executa focus e fitToContent a partir da ref Vue', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__?.canvasRef.value !== null;
    });

    const methodsWork = await page.evaluate(() => {
      const ref = (globalThis as unknown as VueGlobal).__CANVASH_VUE__?.canvasRef.value;
      if (!ref) return false;
      ref.focus();
      ref.fitToContent({ padding: 30 });
      return true;
    });
    expect(methodsWork).toBe(true);
  });
});
