import { expect, test, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { useClassicToolbar } from '../helpers/shell.js';

const SHAPE_TOOLS = [
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

interface TestCanvasSection {
  getSnapshot: () => { session: { activeTool: string } };
  setTool: (tool: string) => { ok: boolean };
}

interface WcWindow {
  __CANVASH_WC__?: {
    canvas: { section?: TestCanvasSection };
    toolbar?: { section?: TestCanvasSection };
    createCanvasSection: () => TestCanvasSection;
  };
}

async function activeTool(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (globalThis as unknown as WcWindow).__CANVASH_WC__?.canvas.section?.getSnapshot().session
        .activeTool,
  );
}

function parts(toolbar: Locator) {
  return {
    main: toolbar.locator('[part~="shapes-button"]'),
    toggle: toolbar.locator('[data-action="open-shapes"]'),
    menu: toolbar.locator('[role="menu"]'),
    item: (tool: string) => toolbar.locator(`[role="menuitemradio"][data-tool="${tool}"]`),
  };
}

test.describe('Grupo "Formas" da toolbar: menu em grade (US-G.1 a US-G.9)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForSelector('canvas-toolbar');
    await page.waitForFunction(
      () => (globalThis as unknown as WcWindow).__CANVASH_WC__?.toolbar?.section !== undefined,
    );
    await useClassicToolbar(page);
  });

  test('US-G.1: o botão mostra o retângulo e um clique ativa a ferramenta e fixa a ilha', async ({
    page,
  }) => {
    const { main, menu } = parts(page.locator('#wc-toolbar'));
    await expect(main).toHaveAttribute('data-tool', 'rectangle');
    await expect(main).toHaveAttribute('aria-label', 'Figuras: Retângulo');
    await expect(main).toHaveAttribute('title', 'Figuras');
    await expect(menu).toHaveCount(0);

    await main.click();
    expect(await activeTool(page)).toBe('rectangle');
    await expect(main).toHaveAttribute('aria-pressed', 'true');
    // O clique também fixa a ilha aberta; o clique seguinte a fecha.
    await expect(menu).toBeVisible();
    await main.click();
    await expect(menu).toHaveCount(0);
  });

  test('US-G.2: escolher uma figura ativa, fecha o menu e vira o botão principal', async ({
    page,
  }) => {
    const { main, toggle, menu, item } = parts(page.locator('#wc-toolbar'));
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();

    await item('circle').click();
    expect(await activeTool(page)).toBe('circle');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(main).toHaveAttribute('data-tool', 'circle');
    await expect(main).toHaveAttribute('aria-label', 'Figuras: Círculo');

    // O próximo clique no botão principal ativa o círculo de novo.
    await page.evaluate(() =>
      (globalThis as unknown as WcWindow).__CANVASH_WC__?.canvas.section?.setTool('select'),
    );
    expect(await activeTool(page)).toBe('select');
    await expect(main).toHaveAttribute('aria-pressed', 'false');
    await main.click();
    expect(await activeTool(page)).toBe('circle');
  });

  test('US-G.3: setTool externo atualiza o botão e o item marcado, com o menu fechado', async ({
    page,
  }) => {
    const { main, toggle, item } = parts(page.locator('#wc-toolbar'));
    await page.evaluate(() =>
      (globalThis as unknown as WcWindow).__CANVASH_WC__?.canvas.section?.setTool('hexagon'),
    );
    await expect(main).toHaveAttribute('data-tool', 'hexagon');
    await expect(main).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(item('hexagon')).toHaveAttribute('aria-checked', 'true');
    await expect(item('rectangle')).toHaveAttribute('aria-checked', 'false');
  });

  test('US-G.4: 14 figuras na ilha com ícone, nome e tooltip, e os outros botões seguem soltos', async ({
    page,
  }) => {
    const toolbar = page.locator('#wc-toolbar');
    const { toggle, menu, item } = parts(toolbar);
    // Linha, Bézier, Tinta e borracha são opções do grupo Desenho: só o botão dele (Bézier) existe.
    for (const tool of ['select', 'hand', 'bezier', 'text']) {
      await expect(toolbar.locator(`button[data-tool="${tool}"]`)).toHaveCount(1);
    }
    for (const tool of ['line', 'pen', 'eraser']) {
      await expect(toolbar.locator(`button[data-tool="${tool}"]`)).toHaveCount(0);
    }
    // A seta não é mais um botão solto: só existe como figura da ilha.
    await expect(toolbar.locator('button[data-tool="arrow"]')).toHaveCount(0);

    await toggle.click();
    await expect(menu.locator('[role="menuitemradio"]')).toHaveCount(14);
    for (const tool of SHAPE_TOOLS) {
      const entry = item(tool);
      await expect(entry.locator('svg[aria-hidden="true"]')).toBeVisible();
      await expect(entry).toHaveAttribute('aria-label', /\S/);
      await expect(entry).toHaveAttribute('title', /\S/);
      await expect(entry).toHaveText('');
    }
    await expect(item('rectangle')).toHaveAttribute('title', 'Retângulo (R)');
    await expect(item('ellipse')).toHaveAttribute('title', 'Elipse (O)');

    // Grade de 4 colunas: o 5º item fica abaixo do 1º; o 2º, ao lado.
    const [first, second, fifth] = await Promise.all(
      [item('rectangle'), item('square'), item('diamond')].map((entry) => entry.boundingBox()),
    );
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(second!.y).toBeCloseTo(first!.y, 0);
    expect(fifth!.x).toBeCloseTo(first!.x, 0);
    expect(fifth!.y).toBeGreaterThan(first!.y);
  });

  test('US-G.5: abrir, navegar na grade, escolher e fechar só com o teclado', async ({ page }) => {
    const { main, toggle, menu, item } = parts(page.locator('#wc-toolbar'));

    // O botão do grupo é o próprio botão de abrir.
    await main.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(item('rectangle')).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(item('square')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('triangle')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(item('diamond')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item('rectangle')).toBeFocused();
    await page.keyboard.press('End');
    await expect(item('brace')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(item('rectangle')).toBeFocused();

    // Esc fecha e devolve o foco ao botão de abrir.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // Enter no toggle abre; Enter num item escolhe, fecha e devolve o foco.
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect(await activeTool(page)).toBe('triangle');
    await expect(main).toHaveAttribute('data-tool', 'triangle');

    // Espaço também escolhe; Tab fecha o menu.
    await page.keyboard.press('Space');
    await expect(item('triangle')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('o foco que sai do menu e o clique fora fecham o menu', async ({ page }) => {
    const toolbar = page.locator('#wc-toolbar');
    const { toggle, menu } = parts(toolbar);

    await toggle.click();
    await expect(menu).toBeVisible();
    await page.locator('canvas-surface').click({ position: { x: 300, y: 300 } });
    await expect(menu).toHaveCount(0);

    await toggle.click();
    await expect(menu).toBeVisible();
    await toolbar.locator('button[data-tool="text"]').focus();
    await expect(menu).toHaveCount(0);
  });

  test('US-G.7: na orientação vertical o menu abre à esquerda da toolbar e a navegação se mantém', async ({
    page,
  }) => {
    const toolbar = page.locator('#wc-toolbar');
    await toolbar.evaluate((el) => {
      el.setAttribute('orientation', 'vertical');
      // Encostada na borda direita, onde fica a ilha vertical do shell.
      el.style.position = 'fixed';
      el.style.left = 'auto';
      el.style.right = '16px';
      el.style.top = '100px';
      el.style.zIndex = '1000';
    });
    const { toggle, menu, item } = parts(toolbar);

    await toggle.focus();
    // Seta para baixo e para a direita não abrem na vertical; seta para a esquerda abre.
    await page.keyboard.press('ArrowDown');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(menu).toBeVisible();

    const wrapper = await toolbar.locator('[part="toolbar"]').boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(wrapper!.x + 1);

    await page.keyboard.press('ArrowDown');
    await expect(item('diamond')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(item('triangle')).toBeFocused();
  });

  test('US-G.8: dois canvas com duas toolbars não se influenciam', async ({ page }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as WcWindow;
      const sectionB = g.__CANVASH_WC__!.createCanvasSection();
      const toolbarB = document.createElement('canvas-toolbar') as HTMLElement & {
        section: unknown;
      };
      toolbarB.id = 'toolbar-b';
      toolbarB.section = sectionB;
      // Solta a segunda toolbar no canto de baixo: o shell ocupa a página inteira.
      toolbarB.style.cssText = 'position:fixed;left:72px;bottom:12px;z-index:30';
      document.body.appendChild(toolbarB);
    });
    const a = parts(page.locator('#wc-toolbar'));
    const b = parts(page.locator('#toolbar-b'));

    await a.toggle.click();
    await a.item('octagon').click();
    await expect(a.main).toHaveAttribute('data-tool', 'octagon');
    await expect(b.main).toHaveAttribute('data-tool', 'rectangle');

    await b.toggle.click();
    await expect(b.menu).toBeVisible();
    await expect(a.menu).toHaveCount(0);
  });

  test('US-G.9: toque abre o menu, escolhe uma figura e fecha ao tocar fora', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1000, height: 700 },
    });
    const page = await context.newPage();
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-toolbar');
    await page.waitForFunction(
      () => (globalThis as unknown as WcWindow).__CANVASH_WC__?.toolbar?.section !== undefined,
    );
    await useClassicToolbar(page);
    const { main, toggle, menu, item } = parts(page.locator('#wc-toolbar'));

    await toggle.tap();
    await expect(menu).toBeVisible();
    await item('pentagon').tap();
    await expect(menu).toHaveCount(0);
    await expect(main).toHaveAttribute('data-tool', 'pentagon');
    expect(await activeTool(page)).toBe('pentagon');

    await toggle.tap();
    await expect(menu).toBeVisible();
    await page.touchscreen.tap(500, 600);
    await expect(menu).toHaveCount(0);
    await context.close();
  });

  test('inverte o lado quando o menu estoura o viewport (400 × 300)', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 300 });
    const toolbar = page.locator('#wc-toolbar');
    // Encosta a toolbar na borda de baixo: o menu abaixo dela não caberia.
    await toolbar.evaluate((el) => {
      el.style.position = 'fixed';
      el.style.left = '0';
      el.style.top = 'auto';
      el.style.bottom = '0';
      el.style.zIndex = '1000';
    });
    const { toggle, menu } = parts(toolbar);

    await toggle.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/flipped/);
    const menuBox = await menu.boundingBox();
    const barBox = await toolbar.boundingBox();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  });
});
