import { expect, test } from '@playwright/test';

interface ArrowNodeSnapshot {
  readonly id: string;
  readonly type: string;
  readonly start?: { targetId?: string; anchor?: { x: number; y: number }; x?: number; y: number };
  readonly end?: { targetId?: string; anchor?: { x: number; y: number }; x?: number; y: number };
  readonly startMarker?: string;
  readonly endMarker?: string;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly document: {
          readonly nodes: Record<string, ArrowNodeSnapshot>;
        };
        readonly session: {
          readonly viewport: {
            readonly x: number;
            readonly y: number;
            readonly zoom: number;
          };
          readonly activeTool: string;
          readonly selectedIds: readonly string[];
        };
        readonly history: {
          readonly canUndo: boolean;
          readonly canRedo: boolean;
        };
        readonly revision: number;
      };
      readonly getPreview: () => {
        readonly additions: readonly unknown[];
      } | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly dispatch: (cmd: unknown) => { ok: boolean };
      readonly undo: () => { ok: boolean };
      readonly redo: () => { ok: boolean };
    };
    readonly interaction?: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
    };
  };
}

test.describe('Interação: Ferramenta de Setas e Âncoras Dinâmicas (Tarefa 47 - INPUT-07)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1) e ferramenta para select
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
    });
  });

  test('cria seta livre por arrasto e seleciona o nó criado', async ({ page }) => {
    await page.click('#btn-tool-arrow');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: arrow');

    const initialRevision = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();

    // Arrasta no espaço livre (500, 300) -> (650, 400)
    const startX = box!.x + 500;
    const startY = box!.y + 300;
    const endX = box!.x + 650;
    const endY = box!.y + 400;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Move intermediário para emitir preview
    await page.mouse.move(startX + 50, startY + 30);

    const hasPreview = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return (g.__CANVASH_PLAYGROUND__?.section.getPreview()?.additions?.length ?? 0) > 0;
    });
    expect(hasPreview).toBe(true);

    await page.mouse.move(endX, endY);
    await page.mouse.up();

    // Confirma que exatamente 1 revisão foi criada
    const finalRevision = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });
    expect(finalRevision).toBe(initialRevision + 1);

    // Confirma que o nó de seta foi criado e selecionado
    const arrow = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snapshot = g.__CANVASH_PLAYGROUND__!.section.getSnapshot();
      const selectedId = snapshot.session.selectedIds[0];
      return selectedId ? snapshot.document.nodes[selectedId] : null;
    });

    expect(arrow).not.toBeNull();
    expect(arrow?.type).toBe('arrow');
    expect(arrow?.start?.x).toBeCloseTo(500, 0);
    expect(arrow?.start?.y).toBeCloseTo(300, 0);
    expect(arrow?.end?.x).toBeCloseTo(650, 0);
    expect(arrow?.end?.y).toBeCloseTo(400, 0);
    expect(arrow?.startMarker).toBe('none');
    expect(arrow?.endMarker).toBe('arrow');
  });

  test('vincula seta a nó alvo existente e preserva vínculo com undo/redo (INPUT-07)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-back',
        shape: {
          id: 'test-box-a',
          type: 'rectangle',
          x: 100,
          y: 450,
          width: 120,
          height: 80,
          rotation: 0,
          style: { fill: '#336699', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-back',
        shape: {
          id: 'test-box-b',
          type: 'rectangle',
          x: 350,
          y: 450,
          width: 120,
          height: 80,
          rotation: 0,
          style: { fill: '#993366', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
    });

    await page.click('#btn-tool-arrow');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();

    // Centro de test-box-a: (160, 490); Centro de test-box-b: (410, 490)
    const startX = box!.x + 160;
    const startY = box!.y + 490;
    const endX = box!.x + 410;
    const endY = box!.y + 490;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    // Verifica que a seta criada está vinculada a ambos os alvos
    const createdArrow = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snapshot = g.__CANVASH_PLAYGROUND__!.section.getSnapshot();
      const selectedId = snapshot.session.selectedIds[0];
      return selectedId ? snapshot.document.nodes[selectedId] : null;
    });

    expect(createdArrow).not.toBeNull();
    expect(createdArrow?.type).toBe('arrow');
    expect(createdArrow?.start?.targetId).toBe('test-box-a');
    expect(createdArrow?.end?.targetId).toBe('test-box-b');

    // 1. Exclui o alvo 'test-box-a'
    const removeResult = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.section.dispatch({
        type: 'shape.remove',
        id: 'test-box-a',
      });
    });
    expect(removeResult.ok).toBe(true);

    // O start da seta deve ter sido convertido atômica e imediatamente para endpoint livre (INPUT-07)
    const arrowAfterDelete = await page.evaluate((arrowId) => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.section.getSnapshot().document.nodes[arrowId];
    }, createdArrow!.id);

    expect(arrowAfterDelete).toBeDefined();
    expect(arrowAfterDelete?.start?.targetId).toBeUndefined();
    expect(typeof arrowAfterDelete?.start?.x).toBe('number');
    expect(typeof arrowAfterDelete?.start?.y).toBe('number');
    // O end continua vinculado ao alvo b
    expect(arrowAfterDelete?.end?.targetId).toBe('test-box-b');

    // 2. Desfaz a exclusão (Undo)
    const undoResult = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.section.undo();
    });
    expect(undoResult.ok).toBe(true);

    // O alvo 'test-box-a' volta a existir e o vínculo é perfeitamente restaurado (INPUT-07)
    const arrowAfterUndo = await page.evaluate((arrowId) => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.section.getSnapshot().document.nodes[arrowId];
    }, createdArrow!.id);

    expect(arrowAfterUndo).toBeDefined();
    expect(arrowAfterUndo?.start?.targetId).toBe('test-box-a');
    expect(arrowAfterUndo?.end?.targetId).toBe('test-box-b');
  });

  test('cancela criação se o arrasto for inferior à tolerância mínima de 2px', async ({ page }) => {
    await page.click('#btn-tool-arrow');

    const initialCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return Object.keys(g.__CANVASH_PLAYGROUND__!.section.getSnapshot().document.nodes).length;
    });

    const box = await page.locator('#canvas-container').boundingBox();
    const startX = box!.x + 400;
    const startY = box!.y + 400;

    // Arrasta apenas 1 pixel
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 1, startY + 1);
    await page.mouse.up();

    const finalCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return Object.keys(g.__CANVASH_PLAYGROUND__!.section.getSnapshot().document.nodes).length;
    });

    expect(finalCount).toBe(initialCount);
  });
});
