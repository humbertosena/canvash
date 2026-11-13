/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { EXAMPLE_URLS, VARIANTS } from '../helpers/canvas.js';
import { clickInPlayground, openPropertiesPanel, showShellPanels } from '../helpers/shell.js';

const wcVariant = VARIANTS.find((variant) => variant.name === 'Web Components')!;

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: {
        getSnapshot(): {
          document: {
            nodes: Record<
              string,
              {
                id: string;
                type: string;
                x?: number;
                y?: number;
                width?: number;
                height?: number;
                style: {
                  fill?: string | null;
                  stroke?: string | null;
                  strokeWidth?: number;
                  opacity?: number;
                };
              }
            >;
          };
          session: {
            selectedIds: readonly string[];
            readOnly: boolean;
          };
        };
        dispatch(cmd: unknown): { ok: boolean };
        setSelection(ids: readonly string[]): void;
      };
    };
    properties?: {
      section?: unknown;
    };
  };
}

test.describe('Web Components: <canvas-properties> (Tarefa 59)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await showShellPanels(page);
    await page.waitForSelector('canvas-properties', { state: 'attached' });
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.properties?.section !== undefined;
    });
  });

  test('exibe mensagem de estado vazio quando nenhum objeto está selecionado', async ({ page }) => {
    await openPropertiesPanel(page, wcVariant);
    const propsPanel = page.locator('canvas-properties');
    await expect(propsPanel).toBeVisible();

    const emptyMsg = propsPanel.locator('.empty-message');
    await expect(emptyMsg).toBeVisible();
    await expect(emptyMsg).toContainText('Nenhum objeto selecionado');
  });

  test('exibe e altera propriedades de uma forma selecionada', async ({ page }) => {
    // 1. Cria retângulo pelo botão da interface
    await clickInPlayground(page, '#btn-add-rect');

    // 2. Seleciona o retângulo clicando no seu item na árvore de camadas
    const layersPanel = page.locator('canvas-layers');
    const nodeLabel = layersPanel.locator('.node-item .node-label').first();
    await nodeLabel.click();

    // 3. O painel de propriedades deve exibir os campos preenchidos
    await openPropertiesPanel(page, wcVariant);
    const propsPanel = page.locator('canvas-properties');
    const inputW = propsPanel.locator('input[data-property="width"]');
    const inputH = propsPanel.locator('input[data-property="height"]');
    const inputFill = propsPanel.locator('input[data-property="fill"]');

    await expect(inputW).toBeVisible();
    await expect(inputW).toHaveValue('150');
    await expect(inputH).toHaveValue('100');
    await expect(inputFill).toHaveValue('#3b82f6');

    // 4. Altera a largura para 320
    await inputW.fill('320');
    await inputW.dispatchEvent('change');

    // Confere se o canvas foi atualizado
    const updatedWidth = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      const first = Object.values(nodes)[0];
      return first?.width;
    });
    expect(updatedWidth).toBe(320);

    // 5. Altera a cor de preenchimento para verde (#10b981)
    await inputFill.fill('#10b981');
    await inputFill.dispatchEvent('input');

    const updatedFill = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      const first = Object.values(nodes)[0];
      return first?.style.fill;
    });
    expect(updatedFill).toBe('#10b981');
  });

  test('indica valores mistos em seleção múltipla heterogênea e aplica alteração em lote', async ({
    page,
  }) => {
    // Cria 2 retângulos com larguras diferentes
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (!section) return;

      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'multi-1',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 80,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#111111', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });

      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'multi-2',
          type: 'rectangle',
          x: 120,
          y: 10,
          width: 140,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#222222', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });

      section.setSelection(['multi-1', 'multi-2']);
    });

    await openPropertiesPanel(page, wcVariant);
    const propsPanel = page.locator('canvas-properties');
    const inputW = propsPanel.locator('input[data-property="width"]');
    const inputH = propsPanel.locator('input[data-property="height"]');

    // Altura é idêntica (60)
    await expect(inputH).toHaveValue('60');

    // Largura é mista (80 vs 140)
    await expect(inputW).toHaveAttribute('placeholder', 'Misto');
    await expect(inputW).toHaveValue('');

    // Altera largura em lote para 200
    await inputW.fill('200');
    await inputW.dispatchEvent('change');

    // Confere que ambas as formas receberam a nova largura de 200
    const widths = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const nodes = g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {};
      return [nodes['multi-1']?.width, nodes['multi-2']?.width];
    });
    expect(widths).toEqual([200, 200]);
  });

  test('desabilita todos os inputs quando o canvas estiver em modo read-only', async ({ page }) => {
    await clickInPlayground(page, '#btn-add-rect');

    // Seleciona o retângulo
    const layersPanel = page.locator('canvas-layers');
    await layersPanel.locator('.node-item .node-label').first().click();

    await openPropertiesPanel(page, wcVariant);
    const propsPanel = page.locator('canvas-properties');
    const inputW = propsPanel.locator('input[data-property="width"]');
    await expect(inputW).toBeEnabled();

    // Alterna para read-only
    await clickInPlayground(page, '#btn-toggle-readonly');

    // Agora o input deve estar desabilitado
    await expect(inputW).toBeDisabled();
  });
});
