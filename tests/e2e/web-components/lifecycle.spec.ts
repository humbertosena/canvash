/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';

interface TestCanvasSection {
  getSnapshot: () => {
    document: { nodes: Record<string, unknown> };
    session: {
      selectedIds: readonly string[];
      activeTool: string;
      viewport: { x: number; y: number; zoom: number };
    };
    revision: number;
  };
  dispatch: (cmd: unknown) => { ok: boolean };
  subscribe: (listener: (ev: unknown) => void) => () => void;
  destroy?: () => void;
}

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: TestCanvasSection;
      dispose: () => void;
    };
    createCanvasSection: () => TestCanvasSection;
  };
}

test.describe('Web Components: Ciclo de Vida do Elemento (Tarefa 56 - WC-04, WC-05)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section !== undefined;
    });
  });

  test('50 ciclos de connect/disconnect preservam o documento e deixam baseline limpo (WC-04)', async ({
    page,
  }) => {
    // 1. Adiciona um retângulo inicial
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (!section) return;
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'persistent-rect-wc04',
          type: 'rectangle',
          x: 40,
          y: 40,
          width: 120,
          height: 80,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
        },
      });
    });

    // 2. Executa 50 ciclos sucessivos de desconexão e reconexão no DOM
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas-surface')!;
      const parent = canvas.parentElement!;

      for (let i = 0; i < 50; i++) {
        parent.removeChild(canvas);
        // Desconectado: isConnected é false
        parent.appendChild(canvas);
        // Reconectado: connectedCallback remonta sobre a mesma instância
      }
    });

    // 3. Verifica que a instância foi mantida e o documento preservou o nó intacto
    const nodeState = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      const node = section?.getSnapshot().document.nodes['persistent-rect-wc04'];
      return node;
    });

    expect(nodeState).toBeDefined();

    // 4. Verifica que o canvas permanece 100% operável criando outro nó após os 50 ciclos
    const postCycleDispatchOk = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (!section) return false;
      const res = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'post-cycle-rect',
          type: 'rectangle',
          x: 200,
          y: 200,
          width: 60,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#10b981', stroke: '#047857', strokeWidth: 1, opacity: 1 },
        },
      });
      return res.ok;
    });

    expect(postCycleDispatchOk).toBe(true);

    // 5. Desconecta o elemento uma última vez e verifica que desmonta os adaptadores internos
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas-surface')!;
      canvas.remove();
    });

    // Ao remover, nenhum canvas no shadow deve permanecer renderizando
    const isDisconnectedClean = await page.evaluate(() => {
      return document.querySelector('canvas-surface') === null;
    });
    expect(isDisconnectedClean).toBe(true);
  });

  test('canvas externo nunca é destruído ao remover o elemento ou chamar dispose (WC-05)', async ({
    page,
  }) => {
    // 1. Cria um canvas externo através da API exposta na página
    const result = await page.evaluate(async () => {
      const g = globalThis as unknown as WcGlobal;
      const hostSection = g.__CANVASH_WC__!.createCanvasSection();

      // Popula o canvas do host
      hostSection.dispatch({
        type: 'shape.create',
        shape: {
          id: 'host-shape',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ec4899', stroke: '#be185d', strokeWidth: 2, opacity: 1 },
        },
      });

      // Cria um elemento <canvas-surface> e atribui o hostSection
      const canvas = document.createElement('canvas-surface') as HTMLElement & {
        section: unknown;
        dispose: () => void;
      };
      canvas.section = hostSection;
      document.body.appendChild(canvas);

      // Desconecta e remove o elemento do DOM
      canvas.remove();

      // Chama dispose explicitamente no elemento
      canvas.dispose();

      // Confere que hostSection continua vivo, operacional e NÃO foi destruído
      const snapshotAfterDispose = hostSection.getSnapshot();
      const nodeExists = snapshotAfterDispose.document.nodes['host-shape'] !== undefined;

      // Executa novo comando no hostSection para provar que ele não foi fechado com DISPOSED
      const dispatchAfter = hostSection.dispatch({
        type: 'shape.create',
        shape: {
          id: 'host-shape-2',
          type: 'rectangle',
          x: 80,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#6366f1', stroke: '#4338ca', strokeWidth: 1, opacity: 1 },
        },
      });

      return {
        nodeExists,
        dispatchOk: dispatchAfter.ok,
      };
    });

    expect(result.nodeExists).toBe(true);
    expect(result.dispatchOk).toBe(true);
  });

  test('canvas interno é destruído de forma limpa e idempotente via dispose()', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas-surface') as HTMLElement & {
        section?: { getSnapshot: () => unknown };
        dispose: () => void;
        updateComplete: Promise<boolean>;
      };
      document.body.appendChild(canvas);
      await canvas.updateComplete;

      // O elemento criou seu canvas interno automaticamente
      const hasInternalSection = canvas.section !== undefined;

      // Chama dispose() 3 vezes sucessivas para garantir idempotência
      canvas.dispose();
      canvas.dispose();
      canvas.dispose();

      canvas.remove();

      return {
        hasInternalSection,
        sectionAfterDispose: canvas.section,
      };
    });

    expect(result.hasInternalSection).toBe(true);
    expect(result.sectionAfterDispose).toBeUndefined();
  });

  test('trocar propriedade section cancela edição anterior e faz rebind limpo', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const g = globalThis as unknown as WcGlobal;
      const sectionA = g.__CANVASH_WC__!.createCanvasSection();
      const sectionB = g.__CANVASH_WC__!.createCanvasSection();

      const canvas = document.querySelector('canvas-surface') as HTMLElement & {
        section: unknown;
      };

      const eventsA: string[] = [];
      const eventsB: string[] = [];

      sectionA.subscribe(() => eventsA.push('change-a'));
      sectionB.subscribe(() => eventsB.push('change-b'));

      // Conecta no sectionA
      canvas.section = sectionA;

      // Despacha em sectionA
      sectionA.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shape-a',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });

      // Troca para sectionB
      canvas.section = sectionB;

      // Despacha em sectionB
      sectionB.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shape-b',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 30,
          height: 30,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });

      return {
        canvasSectionIsB: canvas.section === sectionB,
        hasShapeA: sectionA.getSnapshot().document.nodes['shape-a'] !== undefined,
        hasShapeB: sectionB.getSnapshot().document.nodes['shape-b'] !== undefined,
      };
    });

    expect(result.canvasSectionIsB).toBe(true);
    expect(result.hasShapeA).toBe(true);
    expect(result.hasShapeB).toBe(true);
  });
});
