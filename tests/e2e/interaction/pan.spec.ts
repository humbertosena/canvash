import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly session: {
          readonly viewport: {
            readonly x: number;
            readonly y: number;
            readonly zoom: number;
          };
          readonly activeTool: string;
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
    };
    readonly interaction: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
    };
  };
}

interface BrowserElement {
  readonly style: {
    readonly touchAction: string;
    readonly cursor: string;
  };
}

interface BrowserGlobal {
  readonly document: {
    readonly querySelector: (selectors: string) => BrowserElement | null;
  };
}

test.describe('Interação: Pan por ponteiro (Tarefa 28)', () => {
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

  test('aplica touch-action: none exclusivamente à superfície interativa', async ({ page }) => {
    const touchAction = await page.evaluate(() => {
      const g = globalThis as unknown as BrowserGlobal;
      const el = g.document.querySelector('#canvas-container');
      return el?.style.touchAction ?? '';
    });

    expect(touchAction).toBe('none');
  });

  test('ferramenta mão faz pan por setViewport com arraste do ponteiro', async ({ page }) => {
    // 1. Ativa ferramenta mão
    await page.click('#btn-tool-hand');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: hand');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 200;
    const startY = box.y + 200;
    const endX = startX + 60;
    const endY = startY + 40;

    // 2. Arrasta com botão primário
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    // 3. Verifica viewport atualizado
    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: 60, y: 40, zoom: 1 });
    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=60, y=40, zoom=1.00');
  });

  test('botão central (middle click) faz pan mesmo com ferramenta select ativa', async ({
    page,
    browserName,
  }) => {
    await page.click('#btn-tool-select');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: select');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 300;
    const startY = box.y + 300;
    const endX = startX - 50;
    const endY = startY - 30;

    if (browserName === 'webkit') {
      // O protocolo headless do WebKit no Playwright envia middle click para o root (HTML);
      // despachamos o PointerEvent nativo equivalente no elemento para validação robusta.
      const el = page.locator('#canvas-container');
      await el.dispatchEvent('pointerdown', {
        button: 1,
        buttons: 4,
        pointerId: 2,
        pointerType: 'mouse',
        clientX: startX,
        clientY: startY,
        bubbles: true,
        cancelable: true,
      });
      await el.dispatchEvent('pointermove', {
        button: 1,
        buttons: 4,
        pointerId: 2,
        pointerType: 'mouse',
        clientX: endX,
        clientY: endY,
        bubbles: true,
      });
      await el.dispatchEvent('pointerup', {
        button: 1,
        buttons: 0,
        pointerId: 2,
        pointerType: 'mouse',
        clientX: endX,
        clientY: endY,
        bubbles: true,
      });
    } else {
      // Arrasta com botão central (middle)
      await page.mouse.move(startX, startY);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(endX, endY, { steps: 5 });
      await page.mouse.up({ button: 'middle' });
    }

    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: -50, y: -30, zoom: 1 });
    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=-50, y=-30, zoom=1.00');
  });

  test('Space + arrastar faz pan mantendo ferramenta select', async ({ page }) => {
    await page.click('#btn-tool-select');
    await expect(page.locator('#tool-info')).toHaveText('Ferramenta: select');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 250;
    const startY = box.y + 250;
    const endX = startX + 80;
    const endY = startY + 50;

    // Segura Space e arrasta com botão esquerdo
    await page.keyboard.down('Space');
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up({ button: 'left' });
    await page.keyboard.up('Space');

    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: 80, y: 50, zoom: 1 });
    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=80, y=50, zoom=1.00');
  });

  test('Escape cancela o gesto de pan durante o arrasto e restaura o enquadramento', async ({
    page,
  }) => {
    await page.click('#btn-tool-hand');

    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + 200;
    const startY = box.y + 200;
    const midX = startX + 150;
    const midY = startY + 100;

    // Inicia pan e move
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(midX, midY, { steps: 5 });

    // Cancela com Escape durante o gesto
    await page.keyboard.press('Escape');

    // Solta o ponteiro
    await page.mouse.up({ button: 'left' });

    // O viewport DEVE voltar a (0, 0, 1)
    const viewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    await expect(page.locator('#viewport-info')).toHaveText('Viewport: x=0, y=0, zoom=1.00');
  });

  test('destroy() no handle restaura o touch-action original', async ({ page }) => {
    const previousTouchAction = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.interaction.destroy();

      const bg = globalThis as unknown as BrowserGlobal;
      const el = bg.document.querySelector('#canvas-container');
      return el?.style.touchAction ?? '';
    });

    expect(previousTouchAction).toBe('');
  });
});
