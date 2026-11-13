/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';

interface CapturedEvent {
  type: string;
  bubbles: boolean;
  composed: boolean;
  cancelable: boolean;
  targetTagName: string;
  detail: Record<string, unknown>;
  isSnapshotFrozen: boolean;
}

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: {
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
        undo: () => { ok: boolean };
        setTool: (tool: string) => { ok: boolean };
        setSelection: (ids: readonly string[]) => { ok: boolean };
        setViewport: (vp: { x: number; y: number; zoom: number }) => { ok: boolean };
      };
      fitToContent: (opts?: { padding?: number }) => void;
    };
  };
}

test.describe('Web Components: Eventos DOM Tipados (Tarefa 55 - WC-03)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section !== undefined;
    });
  });

  test('eventos atravessam o Shadow DOM com bubbles: true, composed: true e cancelable: false (WC-03)', async ({
    page,
  }) => {
    // Configura listeners em três níveis: no próprio canvas, no container pai (main) e no document
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __capturedEventsCanvas: CapturedEvent[];
        __capturedEventsMain: CapturedEvent[];
        __capturedEventsDoc: CapturedEvent[];
      };
      g.__capturedEventsCanvas = [];
      g.__capturedEventsMain = [];
      g.__capturedEventsDoc = [];

      const canvas = document.querySelector('canvas-surface')!;
      const main = document.querySelector('main')!;

      const record = (targetList: CapturedEvent[]) => (e: Event) => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        const snapshot = ce.detail?.snapshot as object | undefined;
        targetList.push({
          type: e.type,
          bubbles: e.bubbles,
          composed: e.composed,
          cancelable: e.cancelable,
          targetTagName: (e.target as HTMLElement).tagName.toLowerCase(),
          detail: ce.detail,
          isSnapshotFrozen: snapshot ? Object.isFrozen(snapshot) : false,
        });
      };

      for (const eventName of [
        'document-change',
        'selection-change',
        'viewport-change',
        'tool-change',
      ]) {
        canvas.addEventListener(eventName, record(g.__capturedEventsCanvas));
        main.addEventListener(eventName, record(g.__capturedEventsMain));
        document.addEventListener(eventName, record(g.__capturedEventsDoc));
      }
    });

    // 1. Dispara alteração de documento
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.dispatch({
        type: 'shape.create',
        shape: {
          id: 'test-shape-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 80,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
    });

    // Confere que todos os 3 níveis receberam document-change
    const received = await page.evaluate(() => {
      const g = globalThis as unknown as {
        __capturedEventsCanvas: CapturedEvent[];
        __capturedEventsMain: CapturedEvent[];
        __capturedEventsDoc: CapturedEvent[];
      };
      return {
        canvas: g.__capturedEventsCanvas.find((e) => e.type === 'document-change'),
        main: g.__capturedEventsMain.find((e) => e.type === 'document-change'),
        doc: g.__capturedEventsDoc.find((e) => e.type === 'document-change'),
      };
    });

    expect(received.canvas).toBeDefined();
    expect(received.main).toBeDefined();
    expect(received.doc).toBeDefined();

    // Valida propriedades fundamentais de travessia e não-cancelabilidade
    for (const ev of [received.canvas, received.main, received.doc]) {
      expect(ev?.bubbles).toBe(true);
      expect(ev?.composed).toBe(true);
      expect(ev?.cancelable).toBe(false);
      expect(ev?.targetTagName).toBe('canvas-surface');
      expect(ev?.isSnapshotFrozen).toBe(true);
    }
  });

  test('document-change traz revisão incremental, origem correta e affectedIds (WC-03)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as { __docEvents: CapturedEvent[] };
      g.__docEvents = [];
      document.addEventListener('document-change', (e) => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        const snapshot = ce.detail?.snapshot as object | undefined;
        g.__docEvents.push({
          type: e.type,
          bubbles: e.bubbles,
          composed: e.composed,
          cancelable: e.cancelable,
          targetTagName: (e.target as HTMLElement).tagName.toLowerCase(),
          detail: ce.detail,
          isSnapshotFrozen: snapshot ? Object.isFrozen(snapshot) : false,
        });
      });
    });

    // 1. Cria forma
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.dispatch({
        type: 'shape.create',
        shape: {
          id: 'rect-alpha',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#22c55e', stroke: '#15803d', strokeWidth: 2, opacity: 1 },
        },
      });
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __docEvents: CapturedEvent[] };
      return g.__docEvents.length === 1;
    });

    const event1 = await page.evaluate(() => {
      const g = globalThis as unknown as { __docEvents: CapturedEvent[] };
      return g.__docEvents[0];
    });

    expect(event1?.detail.revision).toBe(1);
    expect(event1?.detail.origin).toBe('local');
    expect((event1?.detail.affectedIds as string[]) ?? []).toContain('rect-alpha');
    expect(event1?.isSnapshotFrozen).toBe(true);

    // 2. Desfaz (undo)
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.undo();
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __docEvents: CapturedEvent[] };
      return g.__docEvents.length === 2;
    });

    const event2 = await page.evaluate(() => {
      const g = globalThis as unknown as { __docEvents: CapturedEvent[] };
      return g.__docEvents[1];
    });

    expect(event2?.detail.revision).toBe(2);
    expect(event2?.detail.origin).toBe('history');
    expect(event2?.isSnapshotFrozen).toBe(true);
  });

  test('document-change é rigorosamente suprimido durante gestos de preview (WC-03)', async ({
    page,
  }) => {
    // Configura contagem de document-change
    await page.evaluate(() => {
      const g = globalThis as unknown as { __docChangeCount: number };
      g.__docChangeCount = 0;
      document.addEventListener('document-change', () => {
        g.__docChangeCount++;
      });
    });

    // Seleciona a ferramenta 'rectangle'
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setTool('rectangle');
    });

    const canvasBox = await page.locator('canvas-surface').boundingBox();
    expect(canvasBox).not.toBeNull();

    const startX = canvasBox!.x + 100;
    const startY = canvasBox!.y + 100;

    // Inicia o gesto de arraste (preview)
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Realiza múltiplos movimentos simulando preview contínuo
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX + i * 20, startY + i * 20);
      await page.waitForTimeout(20);
    }

    // Verifica que durante todo o preview ativo, NENHUM evento document-change foi emitido
    const countDuringDrag = await page.evaluate(() => {
      const g = globalThis as unknown as { __docChangeCount: number };
      return g.__docChangeCount;
    });
    expect(countDuringDrag).toBe(0);

    // Conclui o gesto (pointerup / commit)
    await page.mouse.up();

    // Após o commit, exatamente 1 evento document-change deve ter sido emitido
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const g = globalThis as unknown as { __docChangeCount: number };
          return g.__docChangeCount;
        });
      })
      .toBe(1);

    // Confere que o novo nó foi persistido no snapshot do documento
    const nodeCount = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      return Object.keys(nodes).length;
    });
    expect(nodeCount).toBeGreaterThanOrEqual(1);
  });

  test('selection-change reflete transições com selectedIds e contagem precisa (WC-03)', async ({
    page,
  }) => {
    // Cria 2 formas
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (!section) return;
      const r1 = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shape-1',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
      const r2 = section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shape-2',
          type: 'rectangle',
          x: 100,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
      if (!r1.ok || !r2.ok) {
        throw new Error('Failed to create test shapes');
      }
    });

    await page.evaluate(() => {
      const g = globalThis as unknown as { __selectionHistory: Array<readonly string[]> };
      g.__selectionHistory = [];
      document.addEventListener('selection-change', (e) => {
        const ce = e as CustomEvent<{ selectedIds: readonly string[] }>;
        g.__selectionHistory.push(ce.detail.selectedIds);
      });
    });

    // 1. Seleciona shape-1
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setSelection(['shape-1']);
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __selectionHistory: Array<readonly string[]> };
      return g.__selectionHistory.length === 1;
    });

    // 2. Seleciona shape-1 e shape-2
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setSelection(['shape-1', 'shape-2']);
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __selectionHistory: Array<readonly string[]> };
      return g.__selectionHistory.length === 2;
    });

    // 3. Limpa seleção
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setSelection([]);
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __selectionHistory: Array<readonly string[]> };
      return g.__selectionHistory.length === 3;
    });

    const history = await page.evaluate(() => {
      const g = globalThis as unknown as { __selectionHistory: Array<readonly string[]> };
      return g.__selectionHistory;
    });

    expect(history[0]).toEqual(['shape-1']);
    expect(history[1]).toEqual(['shape-1', 'shape-2']);
    expect(history[2]).toEqual([]);
  });

  test('viewport-change e tool-change emitem eventos tipados através do Shadow DOM (WC-03)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        __lastViewport: unknown;
        __lastTool: string | null;
      };
      g.__lastViewport = null;
      g.__lastTool = null;

      document.addEventListener('viewport-change', (e) => {
        const ce = e as CustomEvent<{ viewport: unknown }>;
        g.__lastViewport = ce.detail.viewport;
      });

      document.addEventListener('tool-change', (e) => {
        const ce = e as CustomEvent<{ activeTool: string }>;
        g.__lastTool = ce.detail.activeTool;
      });
    });

    // Muda ferramenta ativa com setTool
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setTool('ellipse');
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as { __lastTool: string | null };
      return g.__lastTool === 'ellipse';
    });

    // Altera viewport com setViewport
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setViewport({ x: 120, y: 80, zoom: 2 });
    });

    await page.waitForFunction(() => {
      const g = globalThis as unknown as {
        __lastViewport: { x: number; y: number; zoom: number } | null;
      };
      return (
        g.__lastViewport?.zoom === 2 && g.__lastViewport?.x === 120 && g.__lastViewport?.y === 80
      );
    });

    const finalState = await page.evaluate(() => {
      const g = globalThis as unknown as {
        __lastViewport: unknown;
        __lastTool: string | null;
      };
      return { viewport: g.__lastViewport, tool: g.__lastTool };
    });

    expect(finalState.tool).toBe('ellipse');
    expect(finalState.viewport).toEqual({ x: 120, y: 80, zoom: 2 });
  });
});
