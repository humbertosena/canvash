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
              readonly childIds?: readonly string[];
              readonly locked?: boolean;
            }
          >;
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly dispatch: (cmd: unknown) => { ok: boolean };
    };
  };
}

test.describe('Interação: Grupos e Agrupamento (Tarefa 49 - INPUT-08)', () => {
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

  test('agrupa seleção com Mod+G e seleciona o grupo criado (INPUT-08)', async ({ page }) => {
    await page.locator('#canvas-container').focus();

    // Seleciona overlap-rect e overlap-ellipse (ambos pertencem à layer-middle)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect', 'overlap-ellipse']);
    });

    // Pressiona Mod+G (ControlOrMeta+g)
    await page.keyboard.press('ControlOrMeta+g');

    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    expect(snap?.session.selectedIds.length).toBe(1);
    const groupId = snap?.session.selectedIds[0];
    expect(groupId).toBeDefined();
    const groupNode = snap?.document.nodes[groupId!];
    expect(groupNode?.type).toBe('group');
    expect(groupNode?.childIds).toEqual(['overlap-rect', 'overlap-ellipse']);
  });

  test('desagrupa seleção com Mod+Shift+G e seleciona os nós filhos (INPUT-08)', async ({
    page,
  }) => {
    await page.locator('#canvas-container').focus();

    // Cria e seleciona um grupo
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'group.create',
        id: 'test-group',
        childIds: ['overlap-rect', 'overlap-ellipse'],
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['test-group']);
    });

    await page.keyboard.press('ControlOrMeta+Shift+g');

    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    // O grupo deve ter sido removido e os nós originais selecionados
    expect(snap?.document.nodes['test-group']).toBeUndefined();
    expect(snap?.session.selectedIds).toEqual(['overlap-rect', 'overlap-ellipse']);
  });

  test('clicar em um membro seleciona o grupo como uma unidade (INPUT-08)', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Cria um grupo com overlap-rect e overlap-ellipse
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'group.create',
        id: 'unit-group',
        childIds: ['overlap-rect', 'overlap-ellipse'],
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });

    // Clica sobre overlap-rect (x: 250, y: 180)
    await page.mouse.click(box.x + 250, box.y + 180);

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // Deve selecionar o grupo 'unit-group', e NÃO o membro individual 'overlap-rect'
    expect(selectedIds).toEqual(['unit-group']);
  });

  test('arrastar um membro do grupo move o grupo inteiro mantendo posições relativas (INPUT-08)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Cria um grupo e já o seleciona
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'group.create',
        id: 'move-group',
        childIds: ['overlap-rect', 'overlap-ellipse'],
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['move-group']);
    });

    const beforeSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const nodes = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes;
      return {
        rX: nodes?.['overlap-rect']?.x,
        rY: nodes?.['overlap-rect']?.y,
        cX: nodes?.['overlap-ellipse']?.x,
        cY: nodes?.['overlap-ellipse']?.y,
      };
    });

    // Clica sobre overlap-rect e arrasta +50px no X e +30px no Y
    const startX = box.x + 250;
    const startY = box.y + 180;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY + 30, { steps: 5 });
    await page.mouse.up();

    const afterSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const nodes = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes;
      return {
        rX: nodes?.['overlap-rect']?.x,
        rY: nodes?.['overlap-rect']?.y,
        cX: nodes?.['overlap-ellipse']?.x,
        cY: nodes?.['overlap-ellipse']?.y,
      };
    });

    expect(afterSnap.rX).toBe(beforeSnap.rX! + 50);
    expect(afterSnap.rY).toBe(beforeSnap.rY! + 30);
    expect(afterSnap.cX).toBe(beforeSnap.cX! + 50);
    expect(afterSnap.cY).toBe(beforeSnap.cY! + 30);
  });
});
