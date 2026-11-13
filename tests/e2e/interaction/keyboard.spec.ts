import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly revision: number;
        readonly session: {
          readonly selectedIds: readonly string[];
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
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly undo: () => { ok: boolean };
    };
  };
}

test.describe('Interação: Atalhos de Teclado e Isolamento de Foco (Tarefa 37 - INPUT-10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta select e seleção limpa
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('remove seleção com Delete ou Backspace com commit atômico e suporte a undo (INPUT-10)', async ({
    page,
  }) => {
    await page.locator('#canvas-container').focus();

    // Seleciona bg-rect
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const beforeSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });
    expect(beforeSnap?.document.nodes['bg-rect']).toBeDefined();

    // Pressiona Delete com foco no container
    await page.keyboard.press('Delete');

    const afterDelete = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return {
        revision: snap?.revision,
        hasNode: snap?.document.nodes['bg-rect'] !== undefined,
        selectedIds: snap?.session.selectedIds,
      };
    });

    expect(afterDelete.hasNode).toBe(false);
    expect(afterDelete.selectedIds).toEqual([]);
    expect(afterDelete.revision).toBe(beforeSnap!.revision + 1);

    // Desfaz via undo em 1 passo
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.undo();
    });

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return snap?.document.nodes['bg-rect'];
    });

    expect(afterUndo).toBeDefined();
    expect(afterUndo?.id).toBe('bg-rect');
  });

  test('move seleção com teclas direcionais (1 unidade) e Shift+setas (10 unidades) (INPUT-10)', async ({
    page,
  }) => {
    await page.locator('#canvas-container').focus();

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initial = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    });

    // 1. Move 1 px para a direita com ArrowRight
    await page.keyboard.press('ArrowRight');
    let current = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    });
    expect(current.x).toBe(initial.x + 1);
    expect(current.y).toBe(initial.y);

    // 2. Move 1 px para baixo com ArrowDown
    await page.keyboard.press('ArrowDown');
    current = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    });
    expect(current.x).toBe(initial.x + 1);
    expect(current.y).toBe(initial.y + 1);

    // 3. Move 10 px para a esquerda com Shift+ArrowLeft
    await page.keyboard.press('Shift+ArrowLeft');
    current = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    });
    expect(current.x).toBe(initial.x + 1 - 10);

    // 4. Move 10 px para cima com Shift+ArrowUp
    await page.keyboard.press('Shift+ArrowUp');
    current = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    });
    expect(current.y).toBe(initial.y + 1 - 10);
  });

  test('desfaz com Control/Meta+Z e refaz com Control/Meta+Shift+Z ou Control+Y (INPUT-10)', async ({
    page,
  }) => {
    await page.locator('#canvas-container').focus();

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect']?.x ?? 0;
    });

    // Move 1 px
    await page.keyboard.press('ArrowRight');

    const movedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect']?.x ?? 0;
    });
    expect(movedX).toBe(initialX + 1);

    // Undo via atalho Ctrl+Z (ou Meta+Z)
    await page.keyboard.press('ControlOrMeta+z');

    const undidX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect']?.x ?? 0;
    });
    expect(undidX).toBe(initialX);

    // Redo via atalho Ctrl+Shift+Z (ou Meta+Shift+Z)
    await page.keyboard.press('ControlOrMeta+Shift+z');

    const redidX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect']?.x ?? 0;
    });
    expect(redidX).toBe(movedX);
  });

  test('ignora atalhos de edição quando o foco está em input de texto externo (INPUT-10)', async ({
    page,
  }) => {
    // Insere input de texto externo fora do container do canvas
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: {
          createElement: (tag: string) => { id: string; type: string };
          body: { appendChild: (el: unknown) => void };
        };
      };
      const input = g.document.createElement('input');
      input.id = 'playwright-ext-input';
      input.type = 'text';
      g.document.body.appendChild(input);
    });

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    // Foca no input externo
    await page.locator('#playwright-ext-input').focus();
    await page.keyboard.type('Teste');

    // Pressiona Delete e setas com foco no input
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowRight');

    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    // O canvas não deve ter sido afetado pelo teclado no input
    expect(snap?.document.nodes['bg-rect']).toBeDefined();
    expect(snap?.document.nodes['bg-rect']?.x).toBe(50);
  });
});
