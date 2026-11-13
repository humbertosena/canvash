/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  canvasBox,
  createBoardNode,
  createShape,
  EXAMPLE_URLS,
  openVariant,
  setTool,
  VARIANTS,
  type Variant,
} from '../helpers/canvas.js';
import {
  addRect,
  clickShare,
  copiedLinks,
  openCollabPage,
  openFromLink,
  selectIds,
  uniqueRoom,
  waitForSharing,
} from '../helpers/collab.js';
import {
  clickInPlayground,
  openPlayground,
  openPropertiesPanel,
  openShellMenu,
  showShellPanels,
  useClassicToolbar,
} from '../helpers/shell.js';

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: {
        getSnapshot(): {
          preview?: unknown;
          session: {
            selectedIds: readonly string[];
            activeTool: string;
            viewport: { zoom: number };
          };
        };
        dispatch(cmd: unknown): { ok: boolean };
        setSelection(ids: readonly string[]): void;
        setTool(tool: string): void;
        setPreview(preview: unknown): void;
      };
      announce(text: string): void;
      focus(): void;
    };
    toolbar?: {
      section?: unknown;
    };
    layers?: {
      section?: unknown;
    };
    properties?: {
      section?: unknown;
    };
  };
}

const wcVariant = VARIANTS.find((variant) => variant.name === 'Web Components')!;

test.describe('Web Components: Acessibilidade Completa (WC-06 / Tarefa 60)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForSelector('canvas-toolbar');
    await showShellPanels(page);
    await openPropertiesPanel(page, wcVariant);
    await page.waitForSelector('canvas-layers');
    await page.waitForSelector('canvas-properties');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return (
        g.__CANVASH_WC__?.toolbar?.section !== undefined &&
        g.__CANVASH_WC__?.layers?.section !== undefined &&
        g.__CANVASH_WC__?.properties?.section !== undefined
      );
    });
    await useClassicToolbar(page);
  });

  test('passa na auditoria automatizada do axe-core sem violações em nenhum componente', async ({
    page,
  }) => {
    // 1. Auditoria individual dos componentes
    const canvasAxe = await new AxeBuilder({ page }).include('canvas-surface').analyze();
    expect(canvasAxe.violations).toEqual([]);

    const toolbarAxe = await new AxeBuilder({ page }).include('canvas-toolbar').analyze();
    expect(toolbarAxe.violations).toEqual([]);

    const layersAxe = await new AxeBuilder({ page }).include('canvas-layers').analyze();
    expect(layersAxe.violations).toEqual([]);

    const propertiesAxe = await new AxeBuilder({ page }).include('canvas-properties').analyze();
    expect(propertiesAxe.violations).toEqual([]);

    // 2. Cria uma forma para testar o estado com conteúdo
    await clickInPlayground(page, '#btn-add-rect');
    await page.locator('canvas-layers').locator('.node-item .node-label').first().click();

    // 3. Auditoria geral da página completa
    const fullPageAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Filtra violações sérias ou críticas
    const criticalOrSerious = fullPageAxe.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalOrSerious).toEqual([]);
  });

  test('suporta navegação e ativação 100% por teclado com foco visível', async ({ page }) => {
    const toolbar = page.locator('canvas-toolbar');
    const btnSelect = toolbar.locator('button[data-tool="select"]');
    // Enter abre a ilha, que também tem um item `rectangle`: o botão do grupo é o primeiro.
    const btnRect = toolbar.locator('button[data-tool="rectangle"]').first();

    // Foca no primeiro botão da toolbar
    await btnSelect.focus();
    await expect(btnSelect).toBeFocused();

    // A mão fica entre a seleção e o retângulo
    await page.keyboard.press('Tab');
    await expect(toolbar.locator('button[data-tool="hand"]')).toBeFocused();

    // Avança para a ferramenta retângulo via Tab
    await page.keyboard.press('Tab');
    await expect(btnRect).toBeFocused();

    // Ativa retângulo com Enter
    await page.keyboard.press('Enter');
    await expect(btnRect).toHaveAttribute('aria-pressed', 'true');

    // Confere ferramenta ativa no canvas
    const activeTool = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.activeTool;
    });
    expect(activeTool).toBe('rectangle');
  });

  test('a ilha "Figuras" aberta passa no axe-core, com foco visível e nomes acessíveis', async ({
    page,
  }) => {
    const toolbar = page.locator('canvas-toolbar');
    const toggle = toolbar.locator('[data-action="open-shapes"]');

    // Fechado: botão principal e botão de abrir com nome, papel e estado.
    await expect(toolbar.locator('[part~="shapes-button"]')).toHaveAttribute(
      'aria-label',
      'Figuras: Retângulo',
    );
    await expect(toggle).toHaveAttribute('aria-haspopup', 'menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const closedAxe = await new AxeBuilder({ page })
      .include('canvas-toolbar')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(closedAxe.violations).toEqual([]);

    // Aberto: o menu tem papel, nome e itens com nome acessível e estado.
    await toggle.focus();
    await page.keyboard.press('ArrowDown');
    const menu = toolbar.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-label', 'Figuras');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const items = menu.locator('[role="menuitemradio"]');
    await expect(items).toHaveCount(14);
    for (let index = 0; index < 14; index++) {
      await expect(items.nth(index)).toHaveAttribute('aria-label', /\S/);
      await expect(items.nth(index)).toHaveAttribute('aria-checked', /^(true|false)$/);
    }

    // O item focado tem o anel de foco visível.
    const focused = toolbar.locator('[role="menuitemradio"]:focus');
    await expect(focused).toHaveCount(1);
    const outline = await focused.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThan(0);

    const openAxe = await new AxeBuilder({ page })
      .include('canvas-toolbar')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(openAxe.violations).toEqual([]);

    // A página inteira, com o menu aberto e uma figura marcada.
    await page.keyboard.press('ArrowRight');
    const fullAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      fullAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
  });

  test('emite anúncios em aria-live para eventos relevantes e suprime durante preview', async ({
    page,
  }) => {
    const canvas = page.locator('canvas-surface');
    const announcer = canvas.locator('[part="live-announcer"]');

    // 1. Cria retângulo e seleciona
    await clickInPlayground(page, '#btn-add-rect');
    const layers = page.locator('canvas-layers');
    const nodeItem = layers.locator('.node-item').first();
    await expect(nodeItem).toHaveAttribute('data-selected', 'false');
    await nodeItem.locator('.node-label').click();
    await expect(nodeItem).toHaveAttribute('data-selected', 'true');

    // Verifica que o live announcer emitiu o anúncio de seleção
    await expect(announcer).toContainText('Objeto rectangle');

    // 2. Limpa seleção
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setSelection([]);
    });
    await expect(announcer).toHaveText('Nenhum objeto selecionado');

    // 3. Alterna ferramenta
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.section?.setTool('ellipse');
    });
    await expect(announcer).toHaveText('Ferramenta ellipse ativada');

    // 4. Supressão estrita durante preview:
    // Enquanto o preview estiver ativo no canvas, o live announcer NÃO deve emitir
    const initialText = await announcer.textContent();
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const section = g.__CANVASH_WC__?.canvas.section;
      if (section) {
        section.setPreview({
          additions: [
            {
              id: 'preview-shape',
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 50,
              height: 50,
              rotation: 0,
              style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
            },
          ],
        });
      }
      g.__CANVASH_WC__?.canvas.announce('Tentativa de anúncio durante preview');
    });

    // O texto deve permanecer o mesmo de antes da tentativa de anúncio
    await expect(announcer).toHaveText(initialText || '');
  });

  test('restaura foco ao canvas via método focus()', async ({ page }) => {
    // Foca inicialmente no botão da toolbar
    await openPlayground(page);
    await page.locator('button#btn-fit').focus();
    await expect(page.locator('button#btn-fit')).toBeFocused();

    // Invoca focus() no canvas
    await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      g.__CANVASH_WC__?.canvas.focus();
    });

    // O container do canvas agora deve estar focado
    const canvasContainer = page.locator('canvas-surface').locator('.surface-container');
    await expect(canvasContainer).toBeFocused();
  });
});

for (const variant of VARIANTS) {
  test.describe(`Acessibilidade do shell de ilhas: ${variant.name}`, () => {
    test('passa no axe com o shell fechado, com o menu aberto e com o título em edição', async ({
      page,
    }) => {
      await openVariant(page, variant, { classic: false });
      const menuButton = page.locator(
        variant.isVanilla ? '#shell-menu-button' : 'canvas-section [part~="menu-button"]',
      );
      const title = page.locator(
        variant.isVanilla ? '#shell-title' : 'canvas-section [part~="title"]',
      );
      const audit = async () => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        return results.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
      };

      expect(await audit()).toEqual([]);

      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      expect(await audit()).toEqual([]);
      await page.keyboard.press('Escape');

      await title.click();
      await expect(
        page.locator(
          variant.isVanilla ? '#shell-title-input' : 'canvas-section [part~="title-input"]',
        ),
      ).toBeFocused();
      expect(await audit()).toEqual([]);
    });
  });
}

for (const variant of VARIANTS) {
  test.describe(`Acessibilidade das ilhas do topo: ${variant.name}`, () => {
    const islands = (page: Page) =>
      variant.isVanilla
        ? {
            menuItems: page.locator('#shell-menu [data-menu-item]'),
            exportButton: page.locator('#shell-export-button'),
            exportMenu: page.locator('#shell-export-menu'),
            title: page.locator('#shell-title'),
            titleInput: page.locator('#shell-title-input'),
          }
        : {
            menuItems: page.locator('canvas-section [part~="menu-item"]'),
            exportButton: page.locator('canvas-section [part~="export-button"]'),
            exportMenu: page.locator('canvas-section [part~="export-menu"]'),
            title: page.locator('canvas-section [part~="title"]'),
            titleInput: page.locator('canvas-section [part~="title-input"]'),
          };
    const audit = async (page: Page) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      return results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
    };

    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    test('US-T.12: o menu com os itens do host aberto passa no axe', async ({ page }) => {
      await openShellMenu(page);
      await expect(islands(page).menuItems.first()).toBeVisible();

      expect(await audit(page)).toEqual([]);
    });

    test('US-T.12: a ilha de exportação aberta passa no axe', async ({ page }) => {
      await islands(page).exportButton.click();
      await expect(islands(page).exportMenu).toBeVisible();

      expect(await audit(page)).toEqual([]);
    });

    test('US-T.12: o cartão do playground aberto passa no axe', async ({ page }) => {
      await openPlayground(page);
      await expect(page.locator('#playground-panel')).toBeVisible();

      expect(await audit(page)).toEqual([]);
    });

    test('US-T.12: o título em edição passa no axe', async ({ page }) => {
      await islands(page).title.click();
      await expect(islands(page).titleInput).toBeFocused();

      expect(await audit(page)).toEqual([]);
    });
  });
}

for (const variant of VARIANTS) {
  test.describe(`Acessibilidade do mini-menu da seleção: ${variant.name}`, () => {
    test('passa no axe com o mini-menu e com o painel de propriedades abertos, e o foco é visível', async ({
      page,
    }) => {
      await openVariant(page, variant, { classic: false });
      await createShape(page, {
        id: 'r1',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 160,
        height: 100,
        rotation: 0,
      });
      // O mini-menu tem 3 ações e o painel de propriedades vive na toolbar.
      const hosts = variant.isVanilla
        ? ['#selection-menu', '#shell-toolbar']
        : ['canvas-selection-menu', 'canvas-toolbar'];
      const menu = page.locator(
        variant.isVanilla ? '#selection-menu' : 'canvas-selection-menu [part~="selection-menu"]',
      );
      const properties = page.locator(
        variant.isVanilla ? '#btn-properties' : 'canvas-toolbar [data-action="properties"]',
      );
      const firstAction = page.locator(
        variant.isVanilla
          ? '#btn-selection-front'
          : 'canvas-selection-menu [part~="selection-action-bring-to-front"]',
      );
      const panel = page.locator(
        variant.isVanilla ? '#properties-panel' : 'canvas-toolbar [part~="properties-panel"]',
      );
      const axeOf = () => {
        const builder = new AxeBuilder({ page }).withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
        ]);
        for (const host of hosts) builder.include(host);
        return builder.analyze();
      };
      const audit = async () => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        return results.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
      };

      // Mini-menu visível: barra com nome, botões com nome e o botão do painel como diálogo.
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('role', 'toolbar');
      await expect(menu).toHaveAttribute('aria-label', 'Ações da seleção');
      await expect(properties).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(properties).toHaveAttribute('aria-expanded', 'false');
      const menuAxe = await axeOf();
      expect(menuAxe.violations).toEqual([]);
      expect(await audit()).toEqual([]);

      // Pelo teclado, o foco chega ao botão com o anel visível.
      await page.evaluate(() => {
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus();
      });
      await page.keyboard.press('Shift+F10');
      await expect(firstAction).toBeFocused();
      const outline = await firstAction.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(outline.style).not.toBe('none');
      expect(parseFloat(outline.width)).toBeGreaterThan(0);

      // Painel aberto: diálogo com nome, e a página inteira sem violações sérias.
      await properties.focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('role', 'dialog');
      await expect(panel).toHaveAttribute('aria-label', 'Propriedades');
      await expect(properties).toHaveAttribute('aria-expanded', 'true');
      const openAxe = await axeOf();
      expect(openAxe.violations).toEqual([]);
      expect(await audit()).toEqual([]);
    });

    test('US-GA.9: Agrupar habilitado, Desagrupar habilitado e Agrupar desabilitado passam no axe, e o botão desabilitado segue focável', async ({
      page,
    }) => {
      // Três estados, cada um com duas auditorias do axe: sob carga passa dos 30 s padrão.
      test.setTimeout(120_000);
      await openVariant(page, variant, { classic: false });
      // Três retângulos na primeira camada, e um grupo com os dois primeiros.
      const arrange = (commands: readonly unknown[], selection: readonly string[]) =>
        page.evaluate(
          ({ list, ids }) => {
            const w = globalThis as unknown as {
              __CANVASH_PLAYGROUND__?: { section: Api };
              __CANVASH_REACT__?: { section: Api };
              __CANVASH_VUE__?: { section: Api };
              __CANVASH_WC__?: { canvas: { section?: Api } };
            };
            interface Api {
              getSnapshot(): { document: { layers: { id: string }[] } };
              transact(commands: readonly unknown[]): { ok: boolean };
              setSelection(ids: readonly string[]): void;
            }
            const section =
              w.__CANVASH_PLAYGROUND__?.section ??
              w.__CANVASH_REACT__?.section ??
              w.__CANVASH_VUE__?.section ??
              w.__CANVASH_WC__?.canvas.section;
            if (!section) throw new Error('Canvas não encontrado');
            const layerId = section.getSnapshot().document.layers[0]?.id;
            const withLayer = list.map((command) => {
              const c = command as { type?: string };
              return c.type === 'shape.create' ? { ...c, layerId } : command;
            });
            if (!section.transact(withLayer).ok) throw new Error('comando recusado');
            section.setSelection(ids);
          },
          { list: commands, ids: selection },
        );
      const rect = (id: string, x: number) => ({
        type: 'shape.create',
        shape: { id, type: 'rectangle', x, y: 300, width: 100, height: 80, rotation: 0 },
      });
      const hosts = variant.isVanilla ? ['#selection-menu'] : ['canvas-selection-menu'];
      const group = page.locator(
        variant.isVanilla
          ? '#btn-selection-group'
          : 'canvas-selection-menu [part~="selection-action-group"]',
      );
      const ungroup = page.locator(
        variant.isVanilla
          ? '#btn-selection-ungroup'
          : 'canvas-selection-menu [part~="selection-action-ungroup"]',
      );
      const axeOf = () => {
        const builder = new AxeBuilder({ page }).withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
        ]);
        for (const host of hosts) builder.include(host);
        return builder.analyze();
      };
      const audit = async () => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        return results.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
      };

      // 1. Agrupar habilitado: dois nós soltos.
      await arrange([rect('r1', 300), rect('r2', 440), rect('r3', 580)], ['r1', 'r2']);
      await expect(group).toBeVisible();
      await expect(group).not.toHaveAttribute('aria-disabled', 'true');
      expect((await axeOf()).violations).toEqual([]);
      expect(await audit()).toEqual([]);

      // 2. Desagrupar habilitado: um grupo.
      await arrange([{ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] }], ['g']);
      await expect(ungroup).toBeVisible();
      await expect(ungroup).not.toHaveAttribute('aria-disabled', 'true');
      expect((await axeOf()).violations).toEqual([]);
      expect(await audit()).toEqual([]);

      // 3. Agrupar desabilitado e Desagrupar habilitado: um grupo e um nó solto.
      await arrange([], ['g', 'r3']);
      await expect(group).toHaveAttribute('aria-disabled', 'true');
      await expect(ungroup).toBeVisible();
      expect((await axeOf()).violations).toEqual([]);
      expect(await audit()).toEqual([]);

      // O botão desabilitado continua na navegação por teclado, com o anel de foco visível.
      await page.evaluate(() => {
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus();
      });
      await page.keyboard.press('Shift+F10');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect(group).toBeFocused();
      const outline = await group.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(outline.style).not.toBe('none');
      expect(parseFloat(outline.width)).toBeGreaterThan(0);
    });
  });
}

// Ilha vertical (spec vertical-island, US-V.14): sem violação crítica ou séria com a ilha fechada,
// com cada ghost island aberta e com o painel de Propriedades, nos quatro exemplos.

/** Luminância relativa (WCAG 2.1) de uma cor `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

test.describe('Ilha vertical: contraste AA do fundo e do item sob o ponteiro', () => {
  test('o ícone escuro passa no AA sobre o fundo da ilha, o item sob o ponteiro e o ativo', () => {
    expect(contrast('#1f1f1f', '#d9dbe0')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#1f1f1f', '#ccced3')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#1f1f1f')).toBeGreaterThanOrEqual(4.5);
  });
});

for (const variant of VARIANTS) {
  test.describe(`Acessibilidade da ilha vertical: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    const ids = (variant: Variant) =>
      variant.isVanilla
        ? {
            figures: '#btn-group-figures',
            note: '#btn-group-sticky',
            draw: '#btn-group-draw',
            properties: '#btn-properties',
            island: (name: 'figures' | 'note' | 'draw') =>
              `#${name === 'note' ? 'sticky' : name}-island`,
          }
        : {
            figures: 'canvas-toolbar [data-action="open-shapes"]',
            note: 'canvas-toolbar [data-action="open-sticky-colors"]',
            draw: 'canvas-toolbar [data-action="open-draw"]',
            properties: 'canvas-toolbar [data-action="properties"]',
            island: () => 'canvas-toolbar [role="menu"]',
          };

    const audit = async (page: Page) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      return results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
    };

    test('US-V.14: a ilha fechada passa no axe', async ({ page }) => {
      expect(await audit(page)).toEqual([]);
    });

    for (const group of ['figures', 'note', 'draw'] as const) {
      test(`US-V.14: a ilha de ${group} aberta passa no axe`, async ({ page }) => {
        const target = ids(variant);
        await page.locator(target[group]).hover();
        await expect(page.locator(target.island(group))).toBeVisible();
        expect(await audit(page)).toEqual([]);
      });
    }

    for (const tool of ['pen', 'eraser'] as const) {
      test(`US-V.14: a ilha de Desenho com ${tool === 'pen' ? 'Tinta' : 'a borracha'} marcada passa no axe`, async ({
        page,
      }) => {
        const target = ids(variant);
        await setTool(page, tool);
        await page.locator(target.draw).hover();
        await expect(page.locator(target.island('draw'))).toBeVisible();
        expect(await audit(page)).toEqual([]);
      });
    }

    test('US-V.14: o painel de Propriedades aberto passa no axe', async ({ page }) => {
      const target = ids(variant);
      await createShape(page, {
        id: 'r1',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 160,
        height: 100,
        rotation: 0,
      });
      await expect(page.locator(target.properties)).toBeEnabled();
      await page.locator(target.properties).click();
      await expect(
        page.locator('#properties-panel, canvas-toolbar [part~="properties-panel"]'),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    // O painel do Vanilla é próprio e tem a mesma seção, com os mesmos `data-field`.
    test('US-SL.10: o painel com a seção "Texto na forma" aberta passa no axe', async ({
      page,
    }) => {
      const target = ids(variant);
      await createShape(page, {
        id: 'r1',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 160,
        height: 100,
        rotation: 0,
        label: { text: 'Olá', fontWeight: 'bold', color: '#7c3aed' },
      });
      await expect(page.locator(target.properties)).toBeEnabled();
      await page.locator(target.properties).click();
      await expect(page.locator('[part~="section-label"], #label-section')).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    // O botão Board, a seção do board e o editor de título: nome acessível e axe, nos quatro exemplos.
    const boardAt = { id: 'b', x: 300, y: 300, width: 320, height: 200, title: 'Fluxo' };

    test('US-BD.17: o botão Board tem nome acessível', async ({ page }) => {
      const button = page.locator('canvas-toolbar [data-tool="board"], #btn-tool-board');
      await expect(button).toHaveAccessibleName('Board');
      await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    test('US-BD.17: o painel com a seção do board aberta passa no axe, com os campos nomeados', async ({
      page,
    }) => {
      const target = ids(variant);
      await createBoardNode(page, boardAt, []);
      await expect(page.locator(target.properties)).toBeEnabled();
      await page.locator(target.properties).click();
      const part = (name: string) => page.locator(`[part~="${name}"]`);
      await expect(part('section-board')).toBeVisible();

      await expect(part('input-board-title')).toHaveAccessibleName('Título');
      await expect(part('input-board-fill')).toHaveAccessibleName('Fundo');
      await expect(part('input-board-fill-opacity')).toHaveAccessibleName('Opacidade do fundo');
      await expect(part('input-board-stroke')).toHaveAccessibleName('Borda');
      await expect(part('button-board-fill-none')).toHaveAccessibleName('Fundo: Nenhum');
      await expect(part('button-board-stroke-none')).toHaveAccessibleName('Borda: Nenhum');
      await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible();
      await expect(page.getByRole('spinbutton', { name: 'Opacidade do fundo' })).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    test('US-BD.17: o editor do título aberto tem nome acessível e passa no axe', async ({
      page,
    }) => {
      await createBoardNode(page, boardAt, []);
      const box = await canvasBox(page, variant);
      await page.mouse.dblclick(box.x + boardAt.x + 120, box.y + boardAt.y - 12);

      const editor = page.getByRole('textbox', { name: 'Título do board' });
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue('Fluxo');
      expect(await audit(page)).toEqual([]);
    });

    // O mini-menu com o botão Exportar board e o submenu aberto: nomes do i18n e foco visível.
    test('US-BE.8: o submenu Exportar board aberto passa no axe, com nomes e foco visível', async ({
      page,
    }) => {
      const target = variant.isVanilla
        ? {
            button: '[data-testid="btn-selection-export-board"]',
            menu: '[data-testid="selection-export-board-menu"]',
            item: (format: 'svg' | 'png') => `[data-testid="btn-selection-export-board-${format}"]`,
          }
        : {
            button: 'canvas-selection-menu [data-action="export-board"]',
            menu: 'canvas-selection-menu [part="export-board-menu"]',
            item: (format: 'svg' | 'png') =>
              `canvas-selection-menu [part="export-board-item"][data-format="${format}"]`,
          };
      await createBoardNode(page, boardAt, []);

      const button = page.locator(target.button);
      await expect(button).toHaveAccessibleName('Exportar board');
      await expect(button).toHaveAttribute('aria-haspopup', 'menu');
      await expect(button).toHaveAttribute('aria-expanded', 'false');

      await button.focus();
      await page.keyboard.press('Enter');
      const menu = page.locator(target.menu);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAccessibleName('Opções de exportação do board');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(target.item('svg'))).toHaveAccessibleName(
        'Exportar board como SVG',
      );
      await expect(page.locator(target.item('png'))).toHaveAccessibleName(
        'Exportar board como PNG',
      );

      // O item focado (SVG) e, depois da seta, o PNG têm o anel de foco visível.
      for (const format of ['svg', 'png'] as const) {
        const item = page.locator(target.item(format));
        await expect(item).toBeFocused();
        const outline = await item.evaluate((el) => {
          const style = getComputedStyle(el);
          return { width: style.outlineWidth, style: style.outlineStyle };
        });
        expect(outline.style).not.toBe('none');
        expect(parseFloat(outline.width)).toBeGreaterThan(0);
        if (format === 'svg') await page.keyboard.press('ArrowDown');
      }

      expect(await audit(page)).toEqual([]);
    });
  });
}

for (const variant of VARIANTS) {
  test.describe(`Acessibilidade da colaboração: ${variant.name}`, () => {
    test.describe.configure({ timeout: 90_000 });

    const audit = async (page: Page) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      return results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
    };

    /** Mostra o estado `connecting` na pill, que na prática dura um instante. */
    const showConnecting = async (page: Page) => {
      await page.evaluate((isVanilla) => {
        if (isVanilla) {
          const pill = document.getElementById('shell-share-button')!;
          pill.dataset['sharing'] = 'connecting';
          pill.setAttribute('aria-label', 'Compartilhar, conectando');
          const dot = document.getElementById('shell-share-status')!;
          dot.hidden = false;
          dot.dataset['state'] = 'connecting';
        } else {
          (document.querySelector('canvas-section') as unknown as { sharing: string }).sharing =
            'connecting';
        }
      }, variant.isVanilla);
    };

    const stack = (page: Page) => page.locator('[part~="participants"]');
    const island = (page: Page) => page.locator('[part~="participants-island"]');

    async function sharedPair(context: import('@playwright/test').BrowserContext) {
      const a = await openCollabPage(context, variant, { room: uniqueRoom() });
      await waitForSharing(a, 'off');
      return a;
    }

    test('US-LS.7: a pill passa no axe nos três estados e o ponto tem contraste 3:1', async ({
      context,
    }) => {
      const a = await sharedPair(context);
      expect(await audit(a)).toEqual([]);

      await showConnecting(a);
      expect(await audit(a)).toEqual([]);
      const pill = a.locator('#shell-share-button, canvas-section [part~="share-button"]').first();
      await expect(pill).toHaveAttribute('aria-label', 'Compartilhar, conectando');

      await a.reload();
      await clickShare(a);
      await waitForSharing(a, 'on');
      expect(await audit(a)).toEqual([]);
      await expect(pill).toHaveAttribute('aria-label', 'Compartilhar, ativo');

      const ratio = await a.evaluate(() => {
        const root: ParentNode = document.querySelector('canvas-section')?.shadowRoot ?? document;
        const dot = root.querySelector<HTMLElement>('#shell-share-status, [part~="share-status"]')!;
        const pillEl = root.querySelector<HTMLElement>(
          '#shell-share-button, [part~="share-button"]',
        )!;
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (css: string) => {
          const [r, g, b] = (css.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number);
          return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
        };
        const a1 = luminance(getComputedStyle(dot).backgroundColor);
        const a2 = luminance(getComputedStyle(pillEl).backgroundColor);
        return (Math.max(a1, a2) + 0.05) / (Math.min(a1, a2) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    test('US-PI.8: a pilha fechada e a ilha de participantes aberta passam no axe', async ({
      context,
    }) => {
      const a = await sharedPair(context);
      await clickShare(a);
      await waitForSharing(a, 'on');
      await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      await expect(stack(a)).toHaveCount(1);

      expect(await audit(a)).toEqual([]);
      await stack(a).click();
      await expect(island(a)).toHaveCount(1);
      expect(await audit(a)).toEqual([]);
    });

    test('US-RL.2: o painel de Propriedades bloqueado passa no axe e anuncia quem edita', async ({
      context,
    }) => {
      const a = await sharedPair(context);
      await addRect(a, 'alvo');
      await selectIds(a, ['alvo']);
      const opener = a.locator('#btn-properties, canvas-toolbar [data-action="properties"]');
      await expect(opener).toBeEnabled();
      await opener.click();
      const panel = a.locator('#properties-panel, canvas-toolbar [part~="properties-panel"]');
      await expect(panel).toBeVisible();

      // Quem perde a disputa deixa de ter o nó selecionado (US-RL.4), então a jornada real só
      // passa por este estado de relance. Aqui o detentor é simulado e o documento muda uma vez,
      // para o painel reler o bloqueio: o que o axe confere é a marcação do aviso.
      await a.evaluate(() => {
        type Holder = { section: unknown };
        type SimulatedCanvasSection = {
          getPeerLock: (id: string) => unknown;
          dispatch: (command: unknown) => void;
        };
        const w = window as unknown as Record<
          string,
          Holder | { canvas: { section: unknown } } | undefined
        >;
        const found =
          (w['__CANVASH_PLAYGROUND__'] as Holder | undefined)?.section ??
          (w['__CANVASH_REACT__'] as Holder | undefined)?.section ??
          (w['__CANVASH_VUE__'] as Holder | undefined)?.section ??
          (w['__CANVASH_WC__'] as { canvas: { section: unknown } } | undefined)?.canvas.section;
        const section = found as SimulatedCanvasSection;
        section.getPeerLock = (id: string) =>
          id === 'alvo' ? { name: 'Maria', color: '#7c3aed', sessionId: 'outra' } : undefined;
        section.dispatch({ type: 'shape.update', id: 'alvo', patch: { x: 121 } });
      });

      const notice = a.locator('#properties-peer-lock, [part~="peer-lock-notice"]');
      await expect(notice).toHaveText('Em edição por Maria');
      await expect(notice).toHaveAttribute('role', 'status');
      expect(await audit(a)).toEqual([]);
    });

    test('US-FP.10: a faixa "Seguindo" passa no axe, com o status anunciado e o botão pressionado', async ({
      context,
    }) => {
      const a = await sharedPair(context);
      await clickShare(a);
      await waitForSharing(a, 'on');
      const b = await openFromLink(context, variant, (await copiedLinks(a))[0]!);
      await expect(stack(b)).toHaveCount(1);
      await stack(b).click();
      await island(b).locator('[part~="follow-button"]').first().click();
      await expect(b.locator('[part~="following-banner"]')).toHaveCount(1);

      const violations = await audit(b);
      expect(violations).toEqual([]);
      await expect(b.locator('[part~="following-banner"] [role="status"]')).toHaveCount(1);
      await expect(island(b).locator('[part~="follow-button"]').first()).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });
}
