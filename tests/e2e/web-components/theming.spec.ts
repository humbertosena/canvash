/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { EXAMPLE_URLS, VARIANTS } from '../helpers/canvas.js';
import { openPropertiesPanel, showShellPanels, useClassicToolbar } from '../helpers/shell.js';

const wcVariant = VARIANTS.find((variant) => variant.name === 'Web Components')!;

test.describe('Web Components: Theming, Parts, Slots e i18n (WC-07 / Tarefa 61)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForSelector('canvas-toolbar');
    await showShellPanels(page);
    await openPropertiesPanel(page, wcVariant);
    await page.waitForSelector('canvas-layers');
    await page.waitForSelector('canvas-properties');
    await useClassicToolbar(page);
  });

  test('aplica tema via CSS Custom Properties sem acessar detalhes privados do Shadow DOM', async ({
    page,
  }) => {
    // 1. Injeta variáveis CSS no container host
    await page.addStyleTag({
      content: `
        :root {
          --canvash-toolbar-bg: rgb(240, 249, 255);
          --canvash-layers-bg: rgb(248, 250, 252);
          --canvash-properties-bg: rgb(254, 242, 242);
        }
      `,
    });

    // 2. Verifica que os elementos internos no Shadow DOM respeitam os tokens
    const toolbarBg = await page.evaluate(() => {
      const tb = document.querySelector('canvas-toolbar');
      const inner = tb?.shadowRoot?.querySelector('.toolbar-wrapper');
      return inner ? window.getComputedStyle(inner).backgroundColor : '';
    });
    expect(toolbarBg).toBe('rgb(240, 249, 255)');

    const layersBg = await page.evaluate(() => {
      const layers = document.querySelector('canvas-layers');
      return layers ? window.getComputedStyle(layers).backgroundColor : '';
    });
    expect(layersBg).toBe('rgb(248, 250, 252)');

    const propertiesBg = await page.evaluate(() => {
      const props = document.querySelector('canvas-properties');
      return props ? window.getComputedStyle(props).backgroundColor : '';
    });
    expect(propertiesBg).toBe('rgb(254, 242, 242)');
  });

  test('estiliza elementos internos via pseudo-classe ::part()', async ({ page }) => {
    // 1. Injeta regra com ::part() na página host
    await page.addStyleTag({
      content: `
        canvas-toolbar::part(tool-button) {
          border-radius: 14px;
        }
        canvas-layers::part(layers-header) {
          font-size: 19px;
        }
      `,
    });

    // 2. Verifica se a propriedade computada foi aplicada nos nós com part correspondente
    const toolBtnRadius = await page.evaluate(() => {
      const tb = document.querySelector('canvas-toolbar');
      const btn = tb?.shadowRoot?.querySelector('[part~="tool-button"]');
      return btn ? window.getComputedStyle(btn).borderRadius : '';
    });
    expect(toolBtnRadius).toBe('14px');

    const headerFontSize = await page.evaluate(() => {
      const layers = document.querySelector('canvas-layers');
      const header = layers?.shadowRoot?.querySelector('[part="layers-header"]');
      return header ? window.getComputedStyle(header).fontSize : '';
    });
    expect(headerFontSize).toBe('19px');
  });

  test('renderiza slots customizados em canvas-toolbar e canvas-layers', async ({ page }) => {
    // 1. Injeta elementos nos slots da toolbar
    await page.evaluate(() => {
      const tb = document.querySelector('canvas-toolbar');
      if (tb) {
        const extraBtn = document.createElement('button');
        extraBtn.id = 'extra-slot-btn';
        extraBtn.slot = 'end';
        extraBtn.textContent = 'Custom Action';
        tb.appendChild(extraBtn);
      }
    });

    const extraBtn = page.locator('#extra-slot-btn');
    await expect(extraBtn).toBeVisible();
    await expect(extraBtn).toHaveText('Custom Action');
  });

  test('suporta internacionalização localizável (i18n) por instância do componente', async ({
    page,
  }) => {
    const toolbar = page.locator('canvas-toolbar');
    const selectBtn = toolbar.locator('button[data-tool="select"]');

    // Inicialmente em português
    await expect(selectBtn).toHaveAttribute('aria-label', 'Selecionar (V)');

    // Altera mensagens especificamente na instância da toolbar
    await page.evaluate(() => {
      const tb = document.querySelector('canvas-toolbar') as unknown as {
        messages: { select: string; undo: string };
      };
      if (tb) {
        tb.messages = {
          select: 'Select Tool (V)',
          undo: 'Revert',
        };
      }
    });

    // Rótulo acessível atualizado reativamente sem remontar o DOM
    await expect(selectBtn).toHaveAttribute('aria-label', 'Select Tool (V)');

    const undoBtn = toolbar.locator('button[data-action="undo"]');
    await expect(undoBtn).toHaveAttribute('aria-label', 'Revert');
  });

  test('permite customizar mensagens no painel de camadas e propriedades', async ({ page }) => {
    const layers = page.locator('canvas-layers');
    const properties = page.locator('canvas-properties');

    // Inicialmente textos em português
    await expect(layers.locator('.layers-header')).toContainText('Camadas');
    await expect(properties.locator('.empty-message')).toContainText('Nenhum objeto selecionado');

    // Atualiza mensagens nas instâncias
    await page.evaluate(() => {
      const ly = document.querySelector('canvas-layers') as unknown as {
        messages: { title: string; empty: string };
      };
      if (ly) {
        ly.messages = {
          title: 'Layer Tree',
          empty: 'No layers available',
        };
      }

      const prop = document.querySelector('canvas-properties') as unknown as {
        messages: { title: string; noSelection: string };
      };
      if (prop) {
        prop.messages = {
          title: 'Inspector',
          noSelection: 'Nothing selected yet',
        };
      }
    });

    await expect(layers.locator('.layers-header')).toContainText('Layer Tree');
    await expect(properties.locator('.empty-message')).toContainText('Nothing selected yet');
  });
});
