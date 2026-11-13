import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly revision: number;
        readonly session: {
          readonly selectedIds: readonly string[];
          readonly readOnly: boolean;
          readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
        };
        readonly document: {
          readonly nodes: Record<
            string,
            {
              readonly id: string;
              readonly type: string;
              readonly x?: number;
              readonly y?: number;
              readonly width?: number;
              readonly height?: number;
              readonly rotation?: number;
              readonly locked?: boolean;
            }
          >;
          readonly layers: readonly {
            readonly id: string;
            readonly name: string;
            readonly visible: boolean;
            readonly locked: boolean;
            readonly childIds: readonly string[];
          }[];
        };
      };
      readonly getPreview: () => unknown | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly setReadOnly: (readOnly: boolean) => void;
      readonly dispatch: (cmd: unknown) => { ok: boolean };
    };
    readonly interaction?: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
    };
  };
}

test.describe('Interação: Bloqueio e modo somente leitura (Tarefa 39 - INPUT-10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta select, seleção limpa e readOnly false
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setReadOnly(false);
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('modo readOnly impede criação de shape por ponteiro (INPUT-10)', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setReadOnly(true);
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    const initialRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });

    // Arrasto para tentar criar shape
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 350, { steps: 5 });

    const stateDuring = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(stateDuring.state).toBe('idle');
    expect(stateDuring.preview).toBeNull();

    await page.mouse.up();

    const afterSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
        readOnly: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.readOnly,
      };
    });

    expect(afterSnap.readOnly).toBe(true);
    expect(afterSnap.revision).toBe(initialRev);
  });

  test('modo readOnly impede movimentação e redimensionamento por ponteiro (INPUT-10)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect (x: 50, y: 50, width: 300, height: 200) e ativa readOnly
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
      g.__CANVASH_PLAYGROUND__?.section.setReadOnly(true);
    });

    const initialPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    // 1. Tenta arrastar no meio do shape
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 250, { steps: 5 });

    const stateMove = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(stateMove.state).not.toBe('moving');
    expect(stateMove.preview).toBeNull();
    await page.mouse.up();

    // 2. Tenta arrastar no handle SE (350, 250)
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 350, { steps: 5 });

    const stateResize = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(stateResize.state).not.toBe('resizing');
    expect(stateResize.preview).toBeNull();
    await page.mouse.up();

    // Verifica que nada foi alterado
    const afterPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(afterPos).toEqual(initialPos);
  });

  test('modo readOnly impede exclusão e nudge por atalhos de teclado (INPUT-10)', async ({
    page,
  }) => {
    await page.locator('#canvas-container').focus();

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
      g.__CANVASH_PLAYGROUND__?.section.setReadOnly(true);
    });

    const initialRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });

    // Pressiona Delete e Backspace
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');

    // Pressiona Setas
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    // Pressiona Undo
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyZ`);

    const afterSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        exists: node !== undefined,
        x: node?.x,
        y: node?.y,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(afterSnap.exists).toBe(true);
    expect(afterSnap.x).toBe(50);
    expect(afterSnap.y).toBe(50);
    expect(afterSnap.revision).toBe(initialRev);
  });

  test('modo readOnly mantém navegação por pan e seleção para inspeção (INPUT-10)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setReadOnly(true);
      g.__CANVASH_PLAYGROUND__?.section.setTool('hand');
    });

    const initialVp = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    // 1. Pan funciona
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
    await page.mouse.up();

    const afterPanVp = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(initialVp).toBeDefined();
    expect(afterPanVp).toBeDefined();
    if (!initialVp || !afterPanVp) return;

    expect(afterPanVp.x).toBe(initialVp.x + 100);
    expect(afterPanVp.y).toBe(initialVp.y + 50);

    // 2. Seleção por clique funciona para inspeção
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });

    // Clica no bg-rect em (80, 80) sem sobreposição
    await page.mouse.click(box.x + 80, box.y + 80);

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    expect(selectedIds).toEqual(['bg-rect']);
  });

  test('shape bloqueado não é movido nem excluído por atalhos ou ponteiro', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Bloqueia o shape bg-rect
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.update',
        id: 'bg-rect',
        patch: { locked: true },
      });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        locked: node?.locked,
        x: node?.x,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(initialRev.locked).toBe(true);

    // 1. Tenta mover com ponteiro
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // 2. Tenta deletar e mover com teclado
    await page.locator('#canvas-container').focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('ArrowRight');

    const afterTest = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        exists: node !== undefined,
        x: node?.x,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(afterTest.exists).toBe(true);
    expect(afterTest.x).toBe(initialRev.x);
    expect(afterTest.revision).toBe(initialRev.revision);
  });

  test('camada bloqueada protege todos os nós contidos contra mutação e exclusão', async ({
    page,
  }) => {
    // Bloqueia a camada que contém bg-rect ('layer-back')
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'layer.update',
        id: 'layer-back',
        patch: { locked: true },
      });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        exists: node !== undefined,
        x: node?.x,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    await page.locator('#canvas-container').focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('ArrowDown');

    const afterTest = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        exists: node !== undefined,
        x: node?.x,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(afterTest.exists).toBe(true);
    expect(afterTest.x).toBe(initialRev.x);
    expect(afterTest.revision).toBe(initialRev.revision);
  });
});
