import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly session: {
          readonly selectedIds: readonly string[];
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
    };
  };
}

test.describe('Interação: Seleção por click (Tarefa 31 - INPUT-03)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta para select e seleção vazia
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('click seleciona o shape superior elegível sob o ponteiro', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Na fixture RENDER-01, overlap-rect fica em x: 180, y: 120, width: 220, height: 160
    // Clica no centro (250, 180)
    await page.mouse.click(box.x + 250, box.y + 180);

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    expect(selectedIds).toEqual(['overlap-rect']);
  });

  test('Shift + click alterna e acumula múltiplos shapes na seleção', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 1. Clica no overlap-rect
    await page.mouse.click(box.x + 220, box.y + 180);

    let selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual(['overlap-rect']);

    // 2. Com Shift, clica no overlap-ellipse (x: 280, y: 70, width: 180, height: 120)
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 360, box.y + 100);
    await page.keyboard.up('Shift');

    selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual(['overlap-rect', 'overlap-ellipse']);

    // 3. Com Shift, clica novamente no overlap-rect para desmarcar
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 220, box.y + 180);
    await page.keyboard.up('Shift');

    selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual(['overlap-ellipse']);
  });

  test('click no vazio sem Shift limpa a seleção', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona overlap-rect
    await page.mouse.click(box.x + 220, box.y + 180);

    let selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual(['overlap-rect']);

    // Clica no vazio (longe de qualquer shape)
    await page.mouse.click(box.x + 700, box.y + 500);

    selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual([]);
  });

  test('threshold de arrasto de 3 CSS px evita transformar click em seleção espúria', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Inicia arrasto em overlap-rect mas move 10 CSS px antes de soltar
    const startX = box.x + 220;
    const startY = box.y + 180;
    const endX = startX + 10;
    const endY = startY + 10;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // Como foi arrasto (> 3 px) e não click, a seleção por click não atua
    expect(selectedIds).toEqual([]);
  });

  test('shape oculto ou em camada oculta não é selecionável (INPUT-03)', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Na fixture RENDER-01:
    // hidden-in-visible-layer: x: 80, y: 80, visible: false
    // item-in-hidden-layer: x: 60, y: 60, na camada layer-hidden (visible: false)
    // Clica exatamente na posição de item-in-hidden-layer
    await page.mouse.click(box.x + 90, box.y + 90);

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // Apenas nós elegíveis visíveis podem ser selecionados (aqui pega o bg-rect que está visível embaixo)
    expect(selectedIds).not.toContain('hidden-in-visible-layer');
    expect(selectedIds).not.toContain('item-in-hidden-layer');
  });
});
