/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground, showShellPanels } from '../helpers/shell.js';

interface TestCanvasSection {
  getSnapshot: () => {
    document: {
      nodes: Record<string, { id: string; type: string; visible: boolean; locked: boolean }>;
      layers: Array<{
        id: string;
        name: string;
        visible: boolean;
        locked: boolean;
        childIds: readonly string[];
      }>;
    };
    session: {
      selectedIds: readonly string[];
      activeTool: string;
    };
  };
  dispatch: (cmd: unknown) => { ok: boolean };
  setSelection: (ids: readonly string[]) => { ok: boolean };
}

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: TestCanvasSection;
    };
    layers?: {
      section?: TestCanvasSection;
    };
    createCanvasSection: () => TestCanvasSection;
  };
}

test.describe('Web Components: <canvas-layers> (Tarefa 58)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await showShellPanels(page);
    await page.waitForSelector('canvas-layers');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.layers?.section !== undefined;
    });
  });

  test('lista camadas e objetos sincronizados reativamente com o canvas', async ({ page }) => {
    const layersPanel = page.locator('canvas-layers');

    // Confere que a camada padrão é exibida
    const defaultLayer = layersPanel.locator('.layer-group');
    await expect(defaultLayer).toHaveCount(1);
    await expect(defaultLayer.locator('.layer-title')).toHaveText('Layer 1');

    // Inicialmente sem objetos na camada
    await expect(defaultLayer.locator('.empty-message')).toHaveText('Vazia');

    // Adiciona retângulo pelo botão do exemplo
    await clickInPlayground(page, '#btn-add-rect');

    // Agora o objeto aparece listado dentro da camada
    const nodeItem = defaultLayer.locator('.node-item');
    await expect(nodeItem).toHaveCount(1);
    await expect(nodeItem.locator('.node-label')).toContainText('rectangle');
  });

  test('seleciona objetos ao clicar nos itens da lista e atualiza aria-current e data-selected', async ({
    page,
  }) => {
    await clickInPlayground(page, '#btn-add-rect');

    const layersPanel = page.locator('canvas-layers');
    const nodeItem = layersPanel.locator('.node-item').first();

    // Inicialmente não selecionado
    await expect(nodeItem).toHaveAttribute('data-selected', 'false');

    // Clica no rótulo do item para selecionar
    await nodeItem.locator('.node-label').click();

    // Verifica que o item reflete data-selected="true" e aria-current="true"
    await expect(nodeItem).toHaveAttribute('data-selected', 'true');
    await expect(nodeItem).toHaveAttribute('aria-current', 'true');

    // Confere seleção no canvas
    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.selectedIds ?? [];
    });
    expect(selectedIds.length).toBe(1);
  });

  test('alterna visibilidade e bloqueio de nós através dos botões da lista', async ({ page }) => {
    await clickInPlayground(page, '#btn-add-rect');

    const layersPanel = page.locator('canvas-layers');
    const nodeItem = layersPanel.locator('.node-item').first();
    const visBtn = nodeItem.locator('button[data-action="node-visible"]');
    const lockBtn = nodeItem.locator('button[data-action="node-lock"]');

    // 1. Oculta objeto
    await expect(visBtn).toHaveText('👁');
    await visBtn.click();
    await expect(visBtn).toHaveText('∅');

    const isNodeHidden = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      const firstNode = Object.values(nodes)[0];
      return firstNode?.visible === false;
    });
    expect(isNodeHidden).toBe(true);

    // 2. Bloqueia objeto
    await expect(lockBtn).toHaveText('🔓');
    await lockBtn.click();
    await expect(lockBtn).toHaveText('🔒');

    const isNodeLocked = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      const firstNode = Object.values(nodes)[0];
      return firstNode?.locked === true;
    });
    expect(isNodeLocked).toBe(true);
  });

  test('reordena nós dentro da camada', async ({ page }) => {
    // Cria 2 formas
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (!section) return;
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'item-bottom',
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
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'item-top',
          type: 'rectangle',
          x: 80,
          y: 10,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
    });

    const layersPanel = page.locator('canvas-layers');
    // Em visual list (de cima para baixo), item-top é o primeiro elemento visível
    const topNodeItem = layersPanel.locator('.node-item[data-node-id="item-top"]');
    const sendBackBtn = topNodeItem.locator('button[data-action="node-down"]');

    await sendBackBtn.click();

    // Confere que no documento a ordem foi invertida
    const childIds = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const layer = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.layers[0];
      return layer?.childIds ?? [];
    });
    expect(childIds).toEqual(['item-top', 'item-bottom']);
  });

  test('alterna visibilidade e bloqueio da camada inteira', async ({ page }) => {
    const layersPanel = page.locator('canvas-layers');
    const layerHeader = layersPanel.locator('.layer-header');
    const layerVisBtn = layerHeader.locator('button[data-action="layer-visible"]');
    const layerLockBtn = layerHeader.locator('button[data-action="layer-lock"]');

    // 1. Oculta camada
    await expect(layerVisBtn).toHaveText('👁');
    await layerVisBtn.click();
    await expect(layerVisBtn).toHaveText('∅');

    const isLayerHidden = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const layer = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.layers[0];
      return layer?.visible === false;
    });
    expect(isLayerHidden).toBe(true);

    // 2. Bloqueia camada
    await expect(layerLockBtn).toHaveText('🔓');
    await layerLockBtn.click();
    await expect(layerLockBtn).toHaveText('🔒');

    const isLayerLocked = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const layer = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.layers[0];
      return layer?.locked === true;
    });
    expect(isLayerLocked).toBe(true);
  });
});
