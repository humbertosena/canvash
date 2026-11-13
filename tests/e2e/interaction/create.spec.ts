import { expect, test } from '@playwright/test';

interface NodeSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly start?: { x: number; y: number };
  readonly end?: { x: number; y: number };
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly document: {
          readonly nodes: Record<string, NodeSnapshot>;
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
    };
    readonly interaction?: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
    };
  };
}

test.describe('Interação: Criação de shapes por arrasto (Tarefa 30 - INPUT-02)', () => {
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

  test('criação de retângulo com centenas de eventos gera exatamente 1 commit no histórico (INPUT-02)', async ({
    page,
  }) => {
    await page.click('#btn-tool-rect');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: rectangle');

    const initialRevision = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    const initialCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return Object.keys(g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {})
        .length;
    });

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 100;
    const startY = box.y + 100;
    const endX = startX + 150;
    const endY = startY + 120;

    // Inicia arrasto
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });

    // Emite mais de 100 movimentos intermediários
    await page.mouse.move(endX, endY, { steps: 120 });

    // Durante o arrasto, o preview deve estar presente, mas a revisão do documento não pode mudar
    const intermediateState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return {
        hasPreview: Boolean(preview && preview.additions.length > 0),
        revision: snap?.revision ?? 0,
      };
    });

    expect(intermediateState.hasPreview).toBe(true);
    expect(intermediateState.revision).toBe(initialRevision);

    // Finaliza arrasto (pointerup)
    await page.mouse.up({ button: 'left' });

    // Após pointerup: preview é limpo, exatamente 1 shape foi criado e exatamente 1 revisão adicionada
    const finalState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__?.section;
      const snap = section?.getSnapshot();
      const nodes = Object.values(snap?.document.nodes ?? {});
      return {
        preview: section?.getPreview(),
        revision: snap?.revision ?? 0,
        nodeCount: nodes.length,
        selectedIds: snap?.session.selectedIds ?? [],
        canUndo: snap?.history.canUndo ?? false,
        createdNode: nodes.find(
          (n) =>
            n.type === 'rectangle' && Math.round(n.x ?? 0) === 100 && Math.round(n.y ?? 0) === 100,
        ),
      };
    });

    expect(finalState.preview).toBeNull();
    expect(finalState.nodeCount).toBe(initialCount + 1);
    expect(finalState.revision).toBe(initialRevision + 1);
    expect(finalState.canUndo).toBe(true);
    expect(finalState.createdNode).toBeDefined();
    expect(finalState.createdNode?.type).toBe('rectangle');
    expect(finalState.createdNode?.width).toBe(150);
    expect(finalState.createdNode?.height).toBe(120);
    expect(finalState.selectedIds).toEqual([finalState.createdNode?.id]);
  });

  test('criação de elipse com Shift trava proporções 1:1', async ({ page }) => {
    await page.click('#btn-tool-ellipse');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: ellipse');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 200;
    const startY = box.y + 200;
    const endX = startX + 140;
    const endY = startY + 80; // dx: 140, dy: 80 => com Shift deve travar em max(140, 80) = 140

    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up({ button: 'left' });
    await page.keyboard.up('Shift');

    const createdEllipse = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const nodes = Object.values(
        g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {},
      );
      return nodes.find(
        (n) => n.type === 'ellipse' && Math.round(n.x ?? 0) === 200 && Math.round(n.y ?? 0) === 200,
      );
    });

    expect(createdEllipse).toBeDefined();
    expect(createdEllipse?.width).toBe(140);
    expect(createdEllipse?.height).toBe(140);
  });

  test('criação de linha registra início e fim corretamente', async ({ page }) => {
    await page.click('#btn-tool-line');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: line');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 50;
    const startY = box.y + 60;
    const endX = startX + 100;
    const endY = startY + 80;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    const createdLine = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const nodes = Object.values(
        g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {},
      );
      return nodes.find(
        (n) =>
          n.type === 'line' &&
          Math.round(n.start?.x ?? 0) === 50 &&
          Math.round(n.start?.y ?? 0) === 60,
      );
    });

    expect(createdLine).toBeDefined();
    expect(Math.round(createdLine?.end?.x ?? 0)).toBe(150);
    expect(Math.round(createdLine?.end?.y ?? 0)).toBe(140);
  });

  test('pressionar Escape durante o arrasto descarta o preview e não comita nada', async ({
    page,
  }) => {
    await page.click('#btn-tool-rect');

    const initialCount = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return Object.keys(g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {})
        .length;
    });

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 300;
    const startY = box.y + 300;
    const endX = startX + 100;
    const endY = startY + 100;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 10 });

    // Cancela com Escape antes de soltar o mouse
    await page.keyboard.press('Escape');
    await page.mouse.up({ button: 'left' });

    const afterState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__?.section;
      return {
        preview: section?.getPreview(),
        nodeCount: Object.keys(section?.getSnapshot().document.nodes ?? {}).length,
      };
    });

    expect(afterState.preview).toBeNull();
    expect(afterState.nodeCount).toBe(initialCount);
  });
});
