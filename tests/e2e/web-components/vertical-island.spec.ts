import { expect, test, type Page } from '@playwright/test';
import { createShape, openVariant, snapshot, VARIANTS } from '../helpers/canvas.js';

// Ilha vertical de ferramentas (spec vertical-island): ghost islands abertas por hover, fixadas
// por clique, com o fundo da regra das ilhas do topo. Jornada nos exemplos de componentes, no
// layout de ilhas (`classic: false`); cresce a cada tarefa da spec.

const GHOST_ISLAND_BG = 'rgb(217, 219, 224)';

const FIGURES = [
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'diamond',
  'triangle',
  'polygon',
  'pentagon',
  'hexagon',
  'octagon',
  'cross',
  'chevron',
  'arrow',
  'brace',
] as const;

interface SelectionSection {
  setSelection(ids: readonly string[]): void;
}

interface ReadOnlyCanvasSection {
  setReadOnly(value: boolean): void;
}

interface ToolSection {
  getSnapshot: () => { session: { activeTool: string } };
}

async function activeTool(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const w = globalThis as unknown as Record<string, { section?: ToolSection } | undefined> & {
      __CANVASH_WC__?: { canvas: { section?: ToolSection } };
    };
    const section =
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w.__CANVASH_WC__?.canvas.section;
    return section?.getSnapshot().session.activeTool;
  });
}

const COMPONENT_VARIANTS = VARIANTS.filter((variant) => !variant.isVanilla);

// O Vanilla reproduz a ilha com HTML próprio (layout de ilhas). Propriedades entra na tarefa 224;
// as configurações da Tinta e da borracha seguem no playground (spec, seção 5).
const VANILLA = VARIANTS.find((variant) => variant.isVanilla)!;

test.describe('Ilha vertical (Vanilla)', () => {
  test.beforeEach(async ({ page }) => {
    await openVariant(page, VANILLA, { classic: false });
  });

  const ui = (page: Page) => ({
    toolbar: page.locator('#shell-toolbar'),
    figures: {
      button: page.locator('#btn-group-figures'),
      island: page.locator('#figures-island'),
      item: (tool: string) => page.locator(`#figures-island [data-tool="${tool}"]`),
    },
    note: {
      button: page.locator('#btn-group-sticky'),
      island: page.locator('#sticky-island'),
      swatch: (color: string) => page.locator(`#sticky-island [data-color="${color}"]`),
    },
    draw: {
      button: page.locator('#btn-group-draw'),
      island: page.locator('#draw-island'),
      option: (tool: string) => page.locator(`#draw-island [data-tool="${tool}"]`),
    },
  });

  async function tool(page: Page): Promise<string | undefined> {
    return page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __CANVASH_PLAYGROUND__?: { section?: ToolSection };
          }
        ).__CANVASH_PLAYGROUND__?.section?.getSnapshot().session.activeTool,
    );
  }

  test('US-V.1: a ilha tem duas áreas nomeadas e a ordem da spec', async ({ page }) => {
    const { toolbar } = ui(page);
    await expect(toolbar).toHaveAttribute('role', 'toolbar');
    await expect(toolbar.locator('#area-control')).toHaveAttribute('aria-label', 'Controle');
    await expect(toolbar.locator('#area-shapes')).toHaveAttribute('aria-label', 'Formas');
    const order = await toolbar
      .locator('button:visible')
      .evaluateAll((buttons) => buttons.map((button) => button.id));
    expect(order.slice(0, 6)).toEqual([
      'btn-tool-select',
      'btn-tool-hand',
      'btn-group-figures',
      'btn-tool-text',
      'btn-group-sticky',
      'btn-group-draw',
    ]);
  });

  test('US-V.3: o hover em Figuras abre a ilha com as 14 figuras, e tirar o mouse a fecha', async ({
    page,
  }) => {
    const { figures } = ui(page);
    await expect(figures.island).toBeHidden();
    await figures.button.hover();
    await expect(figures.island).toBeVisible({ timeout: 1000 });
    const tools = await figures.island
      .locator('button[data-tool]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-tool')));
    expect(tools).toEqual([...FIGURES]);
    await expect(figures.item('rectangle')).toHaveAttribute('aria-checked', 'true');

    await figures.item('circle').hover();
    await page.waitForTimeout(400);
    await expect(figures.island).toBeVisible();

    await page.mouse.move(0, 0);
    await expect(figures.island).toBeHidden();
  });

  test('US-V.4: o clique ativa a última figura e fixa a ilha; escolher fecha e lembra', async ({
    page,
  }) => {
    const { figures } = ui(page);
    await figures.button.click();
    expect(await tool(page)).toBe('rectangle');
    await expect(figures.island).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await expect(figures.island).toBeVisible();

    await figures.item('arrow').click();
    await expect(figures.island).toBeHidden();
    expect(await tool(page)).toBe('arrow');
    await expect(figures.button).toHaveAttribute('aria-label', 'Figuras: Seta');

    await figures.button.hover();
    await expect(figures.item('arrow')).toHaveAttribute('aria-checked', 'true');
  });

  test('US-V.6: Nota abre as 6 cores e a Personalizada; o clique ativa a nota', async ({
    page,
  }) => {
    const { note } = ui(page);
    await note.button.hover();
    await expect(note.island).toBeVisible({ timeout: 1000 });
    await expect(note.island.locator('[data-color]')).toHaveCount(6);
    await expect(note.island.locator('#btn-sticky-custom')).toBeVisible();
    await expect(note.swatch('yellow')).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(0, 0);
    await expect(note.island).toBeHidden();

    await note.button.click();
    expect(await tool(page)).toBe('sticky');
    await note.swatch('pink').click();
    await expect(note.island).toBeHidden();
    await expect(page.locator('#select-sticky-color')).toHaveValue('pink');
    await note.button.hover();
    await expect(note.swatch('pink')).toHaveAttribute('aria-checked', 'true');
  });

  test('US-V.7: Desenho abre linha, Bézier, Tinta e borracha, e o clique ativa a lembrada', async ({
    page,
  }) => {
    const { draw } = ui(page);
    await draw.button.hover();
    await expect(draw.island).toBeVisible({ timeout: 1000 });
    const tools = await draw.island
      .locator('button[data-tool]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-tool')));
    expect(tools).toEqual(['line', 'bezier', 'pen', 'eraser']);
    await expect(draw.option('bezier')).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(0, 0);

    await draw.button.click();
    expect(await tool(page)).toBe('bezier');
    await draw.option('pen').click();
    await expect(draw.island).toBeHidden();
    expect(await tool(page)).toBe('pen');
    await expect(draw.button).toHaveAttribute('aria-label', 'Desenho: Tinta');
    await draw.button.click();
    await draw.option('eraser').click();
    expect(await tool(page)).toBe('eraser');
  });

  test('US-V.8: uma ilha por vez, teclado e toque', async ({ page, browser }) => {
    const { figures, note, draw } = ui(page);
    await figures.button.hover();
    await expect(figures.island).toBeVisible();
    await note.button.hover();
    await expect(note.island).toBeVisible();
    await expect(figures.island).toBeHidden();
    await draw.button.click();
    await expect(draw.island).toBeVisible();
    await expect(note.island).toBeHidden();

    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await figures.button.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(figures.item('rectangle')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(figures.item('square')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(figures.island).toBeHidden();
    await expect(figures.button).toBeFocused();

    const context = await browser.newContext({ hasTouch: true });
    const touchPage = await context.newPage();
    await openVariant(touchPage, VANILLA, { classic: false });
    const touch = ui(touchPage).figures;
    await touch.button.tap();
    await expect(touch.island).toBeVisible();
    expect(await tool(touchPage)).toBe('rectangle');
    await touch.item('circle').tap();
    await expect(touch.island).toBeHidden();
    expect(await tool(touchPage)).toBe('circle');
    await context.close();
  });

  async function select(page: Page, ids: readonly string[]): Promise<void> {
    await page.evaluate((selected) => {
      (
        globalThis as unknown as { __CANVASH_PLAYGROUND__?: { section?: SelectionSection } }
      ).__CANVASH_PLAYGROUND__?.section?.setSelection(selected);
    }, ids);
  }

  async function rect(page: Page, id: string, x: number): Promise<void> {
    await createShape(page, {
      id,
      type: 'rectangle',
      x,
      y: 300,
      width: 160,
      height: 100,
      rotation: 0,
      style: { fill: '#3b82f6', stroke: null, strokeWidth: 0, opacity: 1 },
    });
  }

  test('US-V.9: Propriedades acompanha a seleção, abre o painel e o mantém ao trocar a seleção', async ({
    page,
  }) => {
    const button = page.locator('#btn-properties');
    const panel = page.locator('#properties-panel');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', 'Selecione uma ou mais formas');
    await expect(panel).toBeHidden();

    await rect(page, 'a', 100);
    await rect(page, 'b', 500);
    await select(page, ['a']);
    await expect(button).toBeEnabled();

    await button.click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const bar = (await page.locator('#shell-toolbar').boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(bar.x);
    expect(box.y + box.height).toBeLessThanOrEqual(720);

    await select(page, ['b']);
    await expect(panel).toBeVisible();
    await select(page, []);
    await expect(panel).toBeHidden();
    await expect(button).toBeDisabled();

    await select(page, ['a']);
    await button.click();
    await expect(panel).toBeVisible();
    await page.locator('#btn-convert-type').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();

    // Abrir Propriedades fecha a ilha de grupo, e o contrário também vale.
    await button.click();
    await page.locator('#btn-group-figures').hover();
    await expect(page.locator('#figures-island')).toBeVisible();
    await expect(panel).toBeHidden();
    await button.click();
    await expect(panel).toBeVisible();
    await expect(page.locator('#figures-island')).toBeHidden();
  });

  test('US-V.10: o mini-menu fica só com trazer para frente, enviar para trás e excluir', async ({
    page,
  }) => {
    await rect(page, 'a', 100);
    const menu = page.locator('#selection-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveCount(3);
    await expect(page.locator('#btn-selection-properties')).toHaveCount(0);
  });

  test('US-V.11: o mini-menu da seleção não fica sob a toolbar', async ({ page }) => {
    await rect(page, 'edge', 1100);
    await select(page, ['edge']);
    const menu = page.locator('#selection-menu');
    await expect(menu).toBeVisible();
    const bar = (await page.locator('#shell-toolbar').boundingBox())!;
    const found = (await menu.boundingBox())!;
    expect(found.x + found.width).toBeLessThanOrEqual(bar.x);
  });

  test('US-V.11: a toolbar fica à direita, e as ilhas abrem à esquerda, dentro da tela', async ({
    page,
  }) => {
    const { toolbar, figures } = ui(page);
    const bar = (await toolbar.boundingBox())!;
    expect(1280 - (bar.x + bar.width)).toBeCloseTo(16, 0);
    expect(bar.y + bar.height / 2).toBeCloseTo(360, 0);

    await figures.button.hover();
    await expect(figures.island).toBeVisible();
    const island = (await figures.island.boundingBox())!;
    expect(island.x + island.width).toBeLessThanOrEqual(bar.x);
    expect(island.x).toBeGreaterThanOrEqual(0);
    expect(island.y + island.height).toBeLessThanOrEqual(720);
  });

  test('US-V.12: a ilha aberta e o botão de origem usam o fundo de ghost island', async ({
    page,
  }) => {
    const { figures } = ui(page);
    await figures.button.hover();
    await expect(figures.island).toBeVisible();
    await expect(figures.island).toHaveCSS('background-color', GHOST_ISLAND_BG);
    await expect(figures.button).toHaveAttribute('aria-expanded', 'true');
    await expect(figures.button).toHaveCSS('background-color', GHOST_ISLAND_BG);
    await figures.item('square').hover();
    await expect(figures.item('square')).toHaveCSS('background-color', 'rgb(204, 206, 211)');

    await page.mouse.move(0, 0);
    await expect(figures.island).toBeHidden();
    await figures.button.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(figures.island).toBeVisible();
    await expect(figures.button).toHaveCSS('background-color', GHOST_ISLAND_BG);
  });
});

for (const variant of COMPONENT_VARIANTS) {
  test.describe(`Ilha vertical (${variant.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    const figuresOf = (page: Page) => figures(page);

    function figures(page: Page) {
      const toolbar = page.locator('canvas-toolbar');
      return {
        button: toolbar.locator('[data-action="open-shapes"]'),
        island: toolbar.locator('[role="menu"]'),
        item: (tool: string) => toolbar.locator(`[role="menuitemradio"][data-tool="${tool}"]`),
      };
    }

    test('US-V.3: o mouse sobre Figuras abre a ilha com as 14 figuras, e tirar o mouse a fecha', async ({
      page,
    }) => {
      const { button, island } = figures(page);
      await expect(island).toHaveCount(0);

      await button.hover();
      await expect(island).toBeVisible({ timeout: 1000 });
      const tools = await island
        .locator('[role="menuitemradio"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-tool')));
      expect(tools).toEqual([...FIGURES]);
      // Na primeira vez, a figura marcada é o retângulo.
      await expect(island.locator('[aria-checked="true"]')).toHaveAttribute(
        'data-tool',
        'rectangle',
      );

      await page.mouse.move(0, 0);
      await expect(island).toHaveCount(0);
    });

    test('US-V.3: passar do botão para a ilha não fecha, e a ilha lembra a última figura', async ({
      page,
    }) => {
      const { button, island, item } = figures(page);
      await button.hover();
      await expect(island).toBeVisible();

      // Mais que a tolerância de fechamento (250 ms): a ilha segue aberta com o mouse sobre ela.
      await item('circle').hover();
      await page.waitForTimeout(400);
      await expect(island).toBeVisible();

      await item('circle').click();
      await expect(island).toHaveCount(0);
      expect(await activeTool(page)).toBe('circle');

      await page.mouse.move(0, 0);
      await button.hover();
      await expect(island).toBeVisible();
      await expect(item('circle')).toHaveAttribute('aria-checked', 'true');
      await expect(item('rectangle')).toHaveAttribute('aria-checked', 'false');
    });

    test('US-V.4: o clique ativa a última figura e fixa a ilha; escolher a seta cria setas', async ({
      page,
    }) => {
      const { button, island, item } = figures(page);
      await button.click();
      expect(await activeTool(page)).toBe('rectangle');
      await expect(island).toBeVisible();

      // Fixada, a ilha não segue o ponteiro.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await expect(island).toBeVisible();

      await item('arrow').click();
      await expect(island).toHaveCount(0);
      expect(await activeTool(page)).toBe('arrow');
      await expect(button).toHaveAttribute('aria-label', /Seta|Arrow/);

      const canvas = await page.locator('canvas-surface').boundingBox();
      expect(canvas).not.toBeNull();
      await page.mouse.move(canvas!.x + 200, canvas!.y + 200);
      await page.mouse.down();
      await page.mouse.move(canvas!.x + 320, canvas!.y + 260, { steps: 6 });
      await page.mouse.up();
      const nodes = Object.values((await snapshot(page)).document.nodes);
      expect(nodes.map((node) => node.type)).toEqual(['arrow']);
    });

    function note(page: Page) {
      const toolbar = page.locator('canvas-toolbar');
      return {
        toolbar,
        button: toolbar.locator('[data-action="open-sticky-colors"]'),
        island: toolbar.locator('[role="menu"]'),
        swatch: (color: string) => toolbar.locator(`[role="menuitemradio"][data-color="${color}"]`),
      };
    }

    test('US-V.6: o hover em Nota abre as 6 cores e a Personalizada, com o amarelo marcado', async ({
      page,
    }) => {
      const { button, island, swatch } = note(page);
      await expect(button).toHaveAttribute('data-tool', 'sticky');
      await button.hover();
      await expect(island).toBeVisible({ timeout: 1000 });
      await expect(island.locator('[role="menuitemradio"]')).toHaveCount(6);
      await expect(island.locator('[data-action="custom-sticky-color"]')).toBeVisible();
      await expect(swatch('yellow')).toHaveAttribute('aria-checked', 'true');

      await page.mouse.move(0, 0);
      await expect(island).toHaveCount(0);
    });

    test('US-V.6: o clique ativa a nota com a cor lembrada; escolher uma cor avisa uma vez e fecha', async ({
      page,
    }) => {
      const { toolbar, button, island, swatch } = note(page);
      await toolbar.evaluate((el) => {
        const calls: string[] = [];
        (globalThis as unknown as { __stickyColors: string[] }).__stickyColors = calls;
        el.addEventListener('sticky-color-change', (event) =>
          calls.push((event as CustomEvent<{ color: string }>).detail.color),
        );
      });

      await button.click();
      expect(await activeTool(page)).toBe('sticky');
      await expect(island).toBeVisible();

      await swatch('pink').click();
      await expect(island).toHaveCount(0);
      expect(await activeTool(page)).toBe('sticky');
      const colors = await page.evaluate(
        () => (globalThis as unknown as { __stickyColors: string[] }).__stickyColors,
      );
      expect(colors).toHaveLength(1);

      // A cor escolhida vira a lembrada.
      await page.mouse.move(0, 0);
      await button.hover();
      await expect(swatch('pink')).toHaveAttribute('aria-checked', 'true');
      await expect(swatch('yellow')).toHaveAttribute('aria-checked', 'false');
    });

    test('US-V.6: Personalizada abre o seletor nativo de cor', async ({ page }) => {
      const { toolbar, button, island } = note(page);
      await toolbar.evaluate((el) => {
        const input = el.shadowRoot?.querySelector<HTMLInputElement>(
          'input[data-field="sticky-color-custom"]',
        );
        if (!input) throw new Error('seletor de cor ausente');
        (globalThis as unknown as { __pickerOpened: boolean }).__pickerOpened = false;
        input.showPicker = () => {
          (globalThis as unknown as { __pickerOpened: boolean }).__pickerOpened = true;
        };
      });
      await button.click();
      await island.locator('[data-action="custom-sticky-color"]').click();
      expect(
        await page.evaluate(
          () => (globalThis as unknown as { __pickerOpened: boolean }).__pickerOpened,
        ),
      ).toBe(true);
    });

    function draw(page: Page) {
      const toolbar = page.locator('canvas-toolbar');
      return {
        toolbar,
        button: toolbar.locator('[data-action="open-draw"]'),
        island: toolbar.locator('[role="menu"]'),
        option: (tool: string) => toolbar.locator(`[role="menuitemradio"][data-tool="${tool}"]`),
        divider: toolbar.locator('.menu-divider'),
      };
    }

    test('US-V.7: o hover em Desenho abre line, Bézier, Tinta e borracha, sem configurações', async ({
      page,
    }) => {
      const { button, island, option, divider } = draw(page);
      await button.hover();
      await expect(island).toBeVisible({ timeout: 1000 });
      const tools = await island
        .locator('[role="menuitemradio"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-tool')));
      expect(tools).toEqual(['line', 'bezier', 'pen', 'eraser']);
      await expect(option('bezier')).toHaveAttribute('aria-checked', 'true');
      await expect(option('pen')).toHaveAttribute('aria-label', 'Tinta');
      await expect(divider).toHaveCount(0);

      await page.mouse.move(0, 0);
      await expect(island).toHaveCount(0);
    });

    test('US-V.7: o clique ativa a opção lembrada; Tinta mostra tipo, espessura e cores', async ({
      page,
    }) => {
      const { toolbar, button, island, option, divider } = draw(page);
      await toolbar.evaluate((el) => {
        const calls: unknown[] = [];
        (globalThis as unknown as { __penEvents: unknown[] }).__penEvents = calls;
        el.addEventListener('pen-settings-change', (event) =>
          calls.push((event as CustomEvent).detail.settings),
        );
      });

      await button.click();
      expect(await activeTool(page)).toBe('bezier');
      await option('pen').click();
      await expect(island).toHaveCount(0);
      expect(await activeTool(page)).toBe('pen');
      await expect(button).toHaveAttribute('aria-label', /Tinta|Ink/);

      // Reaberta, a ilha mostra a grade da Tinta abaixo do divisor.
      await button.click();
      await expect(divider).toHaveCount(1);
      await expect(toolbar.locator('[data-pen-kind]')).toHaveCount(3);
      await expect(toolbar.locator('[data-pen-width]')).toHaveCount(3);
      await expect(toolbar.locator('[data-pen-color]')).toHaveCount(8);

      // Tipo e espessura deixam a ilha aberta; a cor a fecha.
      await toolbar.locator('[data-pen-kind="marker"]').click();
      await toolbar.locator('[data-pen-width="thick"]').click();
      await expect(island).toBeVisible();
      await toolbar.locator('[data-pen-color="#ef4444"]').click();
      await expect(island).toHaveCount(0);
      const events = await page.evaluate(
        () => (globalThis as unknown as { __penEvents: unknown[] }).__penEvents,
      );
      expect(events.at(-1)).toEqual({ color: '#ef4444', kind: 'marker', width: 'thick' });
    });

    test('US-V.7: com a borracha marcada a ilha mostra os 3 tamanhos; com linha, nada', async ({
      page,
    }) => {
      const { toolbar, button, island, option, divider } = draw(page);
      await toolbar.evaluate((el) => {
        const calls: string[] = [];
        (globalThis as unknown as { __eraserSizes: string[] }).__eraserSizes = calls;
        el.addEventListener('eraser-size-change', (event) =>
          calls.push((event as CustomEvent<{ size: string }>).detail.size),
        );
      });

      await button.click();
      await option('eraser').click();
      expect(await activeTool(page)).toBe('eraser');
      await button.click();
      await expect(toolbar.locator('[data-eraser-size]')).toHaveCount(3);
      await toolbar.locator('[data-eraser-size="thick"]').click();
      await expect(island).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (globalThis as unknown as { __eraserSizes: string[] }).__eraserSizes,
        ),
      ).toEqual(['thick']);

      await button.click();
      await option('line').click();
      expect(await activeTool(page)).toBe('line');
      await button.click();
      await expect(island).toBeVisible();
      await expect(divider).toHaveCount(0);
      await expect(toolbar.locator('[data-eraser-size], [data-pen-kind]')).toHaveCount(0);
    });

    test('US-V.1: a ilha tem duas áreas nomeadas, separadas por divisor, na ordem da spec', async ({
      page,
    }) => {
      const toolbar = page.locator('canvas-toolbar');
      const control = toolbar.locator('[part~="control-area"]');
      const shapes = toolbar.locator('[part~="shapes-area"]');
      await expect(control).toHaveAttribute('role', 'group');
      await expect(control).toHaveAttribute('aria-label', 'Controle');
      await expect(shapes).toHaveAttribute('role', 'group');
      await expect(shapes).toHaveAttribute('aria-label', 'Formas');
      await expect(toolbar.locator('[role="toolbar"]')).toHaveAttribute(
        'aria-label',
        'Ferramentas do canvas',
      );

      const tools = await toolbar
        .locator('button[data-tool]')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-tool')));
      expect(tools).toEqual(['select', 'hand', 'rectangle', 'text', 'sticky', 'bezier', 'board']);

      // O primeiro grupo guarda Select e Pan, e um divisor o separa do segundo.
      await expect(control.locator('button[data-tool]')).toHaveCount(2);
      await expect(shapes.locator('button[data-tool]')).toHaveCount(5);
      const gap = await control.evaluate((el) => el.nextElementSibling?.getAttribute('role'));
      expect(gap).toBe('separator');
    });

    test('US-V.8: abrir uma ilha fecha a outra, e o teclado abre, navega e devolve o foco', async ({
      page,
    }) => {
      const figures = figuresOf(page);
      const noteButton = page.locator('canvas-toolbar [data-action="open-sticky-colors"]');
      const drawButton = page.locator('canvas-toolbar [data-action="open-draw"]');
      const menus = page.locator('canvas-toolbar [role="menu"]');

      await figures.button.hover();
      await expect(menus).toHaveCount(1);
      await noteButton.hover();
      await expect(menus).toHaveCount(1);
      await expect(menus.first()).toHaveAttribute('aria-label', /Cor|cor|color/i);
      await drawButton.click();
      await expect(menus).toHaveCount(1);
      await expect(menus.first()).toHaveAttribute('aria-label', 'Desenho');

      // Teclado: ← abre com o foco na opção marcada, as setas navegam, Esc fecha e devolve o foco.
      await page.mouse.move(0, 0);
      await page.keyboard.press('Escape');
      await expect(menus).toHaveCount(0);
      await figures.button.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(figures.item('rectangle')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(figures.item('square')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menus).toHaveCount(0);
      await expect(figures.button).toBeFocused();

      // Tab e clique fora fecham a ilha fixada.
      await page.keyboard.press('ArrowLeft');
      await expect(menus).toHaveCount(1);
      await page.keyboard.press('Tab');
      await expect(menus).toHaveCount(0);
      await figures.button.click();
      await expect(menus).toHaveCount(1);
      await page.locator('canvas-surface').click({ position: { x: 300, y: 300 } });
      await expect(menus).toHaveCount(0);
    });

    test('US-V.8: no toque, tocar no botão ativa a opção lembrada e abre a ilha', async ({
      browser,
    }) => {
      const context = await browser.newContext({
        hasTouch: true,
        viewport: { width: 1280, height: 720 },
      });
      const touchPage = await context.newPage();
      await openVariant(touchPage, variant, { classic: false });
      const { button, island, item } = figures(touchPage);

      await button.tap();
      await expect(island).toBeVisible();
      expect(await activeTool(touchPage)).toBe('rectangle');
      await item('circle').tap();
      await expect(island).toHaveCount(0);
      expect(await activeTool(touchPage)).toBe('circle');
      await context.close();
    });

    test('US-V.13: em modo leitura sobram Select e Pan', async ({ page }) => {
      await page.evaluate(() => {
        const w = globalThis as unknown as Record<
          string,
          { section?: ReadOnlyCanvasSection } | undefined
        > & {
          __CANVASH_WC__?: { canvas: { section?: ReadOnlyCanvasSection } };
        };
        const section =
          w['__CANVASH_REACT__']?.section ??
          w['__CANVASH_VUE__']?.section ??
          w.__CANVASH_WC__?.canvas.section;
        section?.setReadOnly(true);
      });
      const tools = page.locator('canvas-toolbar button[data-tool]');
      await expect(tools).toHaveCount(2);
      await expect(page.locator('canvas-toolbar [aria-label="Formas"]')).toHaveCount(0);
    });

    function properties(page: Page) {
      const toolbar = page.locator('canvas-toolbar');
      return {
        toolbar,
        button: toolbar.locator('[data-action="properties"]'),
        panel: toolbar.locator('[part~="properties-panel"]'),
      };
    }

    async function setSelection(page: Page, ids: readonly string[]): Promise<void> {
      await page.evaluate((selected) => {
        const w = globalThis as unknown as Record<
          string,
          { section?: SelectionSection } | undefined
        > & {
          __CANVASH_WC__?: { canvas: { section?: SelectionSection } };
        };
        const section =
          w['__CANVASH_REACT__']?.section ??
          w['__CANVASH_VUE__']?.section ??
          w.__CANVASH_WC__?.canvas.section;
        section?.setSelection(selected);
      }, ids);
    }

    async function addRect(page: Page, id: string, x: number): Promise<void> {
      await createShape(page, {
        id,
        type: 'rectangle',
        x,
        y: 300,
        width: 160,
        height: 100,
        rotation: 0,
        style: { fill: '#3b82f6', stroke: null, strokeWidth: 0, opacity: 1 },
      });
    }

    test('US-V.9: Propriedades acompanha a seleção, abre o painel e o mantém ao trocar a seleção', async ({
      page,
    }) => {
      const { toolbar, button, panel } = properties(page);
      await toolbar.evaluate((el) => {
        const calls: boolean[] = [];
        (globalThis as unknown as { __toggles: boolean[] }).__toggles = calls;
        el.addEventListener('properties-panel-toggle', (event) =>
          calls.push((event as CustomEvent<{ open: boolean }>).detail.open),
        );
      });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('title', 'Selecione uma ou mais formas');

      await addRect(page, 'a', 100);
      await addRect(page, 'b', 500);
      await setSelection(page, ['a']);
      await expect(button).toBeEnabled();

      await button.click();
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('role', 'dialog');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(panel.locator('slot[name="properties"]')).toHaveCount(1);
      await expect(page.locator('canvas-properties')).toBeVisible();

      // Trocar a seleção atualiza o painel, sem fechá-lo; esvaziá-la o fecha e desabilita o botão.
      await setSelection(page, ['b']);
      await expect(panel).toBeVisible();
      await setSelection(page, []);
      await expect(panel).toHaveCount(0);
      await expect(button).toBeDisabled();
      expect(
        await page.evaluate(() => (globalThis as unknown as { __toggles: boolean[] }).__toggles),
      ).toEqual([true, false]);

      // Esc fecha e devolve o foco ao botão.
      await setSelection(page, ['a']);
      await button.click();
      await expect(panel).toBeVisible();
      await page.locator('canvas-properties input').first().focus();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(button).toBeFocused();
    });

    test('US-V.10: o mini-menu fica só com trazer para frente, enviar para trás e excluir', async ({
      page,
    }) => {
      await addRect(page, 'a', 100);
      const menu = page.locator('canvas-selection-menu [part~="selection-menu"]');
      await expect(menu).toBeVisible();
      await expect(menu.locator('button')).toHaveCount(3);
      await expect(menu.locator('[data-action="properties"]')).toHaveCount(0);
      await expect(page.locator('canvas-selection-menu [part~="properties-panel"]')).toHaveCount(0);
    });

    async function bar(page: Page) {
      const found = await page.locator('canvas-toolbar [part~="toolbar"]').boundingBox();
      expect(found).not.toBeNull();
      return found!;
    }

    test('US-V.11: a toolbar fica a 16 px da borda direita, centralizada na vertical', async ({
      page,
    }) => {
      const found = await bar(page);
      expect(1280 - (found.x + found.width)).toBeCloseTo(16, 0);
      expect(found.y + found.height / 2).toBeCloseTo(360, 0);
    });

    test('US-V.11: o cartão de camadas fica na borda esquerda, sem sobreposição com a toolbar', async ({
      page,
    }) => {
      await page.evaluate(() => {
        const left = document.querySelector('[slot="left"]') as HTMLElement | null;
        if (left) left.hidden = false;
      });
      const found = await bar(page);
      const card = await page.locator('canvas-section [part~="left"]').boundingBox();
      expect(card).not.toBeNull();
      expect(card!.x).toBeCloseTo(16, 0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(found.x);
    });

    test('US-V.11: as ilhas de grupo e o painel de Propriedades abrem à esquerda, dentro da tela', async ({
      page,
    }) => {
      const { button, island } = figures(page);
      await button.hover();
      await expect(island).toBeVisible();
      const toolbarBox = await bar(page);
      const islandBox = await island.boundingBox();
      expect(islandBox!.x + islandBox!.width).toBeLessThanOrEqual(toolbarBox.x);
      expect(islandBox!.x).toBeGreaterThanOrEqual(0);
      expect(islandBox!.y).toBeGreaterThanOrEqual(0);
      expect(islandBox!.y + islandBox!.height).toBeLessThanOrEqual(720);

      await page.mouse.move(0, 0);
      await addRect(page, 'a', 300);
      await setSelection(page, ['a']);
      const { button: propertiesButton, panel } = properties(page);
      await propertiesButton.click();
      await expect(panel).toBeVisible();
      const panelBox = await panel.boundingBox();
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(toolbarBox.x);
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(720);
    });

    test('US-V.11: o cartão do playground abre à esquerda da toolbar, em 1280×720', async ({
      page,
    }) => {
      await page.locator('#btn-playground').click();
      const card = await page.locator('#playground-panel').boundingBox();
      const found = await bar(page);
      expect(card).not.toBeNull();
      expect(card!.x + card!.width).toBeLessThanOrEqual(found.x);
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.y).toBeGreaterThanOrEqual(0);
      expect(card!.y + card!.height).toBeLessThanOrEqual(720);
    });

    test('US-V.11: o cartão do playground cabe em 375×667', async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
      const narrow = await context.newPage();
      await openVariant(narrow, variant, { classic: false });
      await narrow.locator('#btn-playground').click();
      const card = await narrow.locator('#playground-panel').boundingBox();
      const found = await narrow.locator('canvas-toolbar [part~="toolbar"]').boundingBox();
      expect(card!.x + card!.width).toBeLessThanOrEqual(found!.x);
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.y + card!.height).toBeLessThanOrEqual(667);
      await context.close();
    });

    test('US-V.11: o mini-menu da seleção não fica sob a toolbar', async ({ page }) => {
      await addRect(page, 'edge', 1100);
      await setSelection(page, ['edge']);
      const menu = page.locator('canvas-selection-menu [part~="selection-menu"]');
      await expect(menu).toBeVisible();
      const found = await bar(page);
      const menuBox = await menu.boundingBox();
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(found.x);
    });

    test('US-V.12: com a ilha aberta, a ilha e o botão de origem usam o fundo de ghost island', async ({
      page,
    }) => {
      const { button, island } = figures(page);
      await button.hover();
      await expect(island).toBeVisible();
      await expect(island).toHaveCSS('background-color', GHOST_ISLAND_BG);
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(button).toHaveCSS('background-color', GHOST_ISLAND_BG);

      // Aberta pelo teclado, com o ponteiro longe, o botão mantém o fundo por aria-expanded.
      await page.mouse.move(0, 0);
      await expect(island).toHaveCount(0);
      await button.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(island).toBeVisible();
      await expect(button).toHaveCSS('background-color', GHOST_ISLAND_BG);
      await page.keyboard.press('Escape');
      await expect(island).toHaveCount(0);
      await expect(button).not.toHaveCSS('background-color', GHOST_ISLAND_BG);
    });
  });
}
