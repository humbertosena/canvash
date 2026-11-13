import { expect, test, type Locator, type Page } from '@playwright/test';
import { openVariant, setTool, VARIANTS, type Variant } from '../helpers/canvas.js';

// Layout de ilhas flutuantes (menu, título, toolbar e controles sobre o canvas) nos quatro
// exemplos. O Vanilla tem o mesmo layout em HTML próprio; os outros usam <canvas-section>.

const VIEWPORT = { width: 1280, height: 720 };
const MARGIN = 16;

interface Regions {
  readonly shell: Locator;
  readonly canvas: Locator;
  readonly menuButton: Locator;
  readonly menu: Locator;
  readonly title: Locator;
  readonly titleInput: Locator;
  readonly toolbar: Locator;
  readonly controls: Locator;
}

function regions(page: Page, variant: Variant): Regions {
  if (variant.isVanilla) {
    return {
      shell: page.locator('#shell'),
      canvas: page.locator('#canvas-container'),
      menuButton: page.locator('#shell-menu-button'),
      menu: page.locator('#shell-menu'),
      title: page.locator('#shell-title'),
      titleInput: page.locator('#shell-title-input'),
      toolbar: page.locator('#shell-toolbar'),
      controls: page.locator('#canvas-controls'),
    };
  }
  return {
    shell: page.locator('canvas-section'),
    canvas: page.locator('canvas-surface'),
    menuButton: page.locator('canvas-section [part~="menu-button"]'),
    menu: page.locator('canvas-section [part~="menu"]'),
    title: page.locator('canvas-section [part~="title"]'),
    titleInput: page.locator('canvas-section [part~="title-input"]'),
    toolbar: page.locator('canvas-toolbar'),
    controls: page.locator('canvas-controls'),
  };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

async function viewportOf(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: { getSnapshot(): { session: { viewport: never } } } };
      __CANVASH_REACT__?: { section: { getSnapshot(): { session: { viewport: never } } } };
      __CANVASH_VUE__?: { section: { getSnapshot(): { session: { viewport: never } } } };
      __CANVASH_WC__?: {
        canvas: { section?: { getSnapshot(): { session: { viewport: never } } } };
      };
    };
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    return section.getSnapshot().session.viewport;
  });
}

for (const variant of VARIANTS) {
  test.describe(`Shell de ilhas flutuantes: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    test('US-S.1: o canvas ocupa a tela inteira, e nenhuma ilha muda o tamanho dele', async ({
      page,
    }) => {
      const { shell, canvas } = regions(page, variant);

      const shellBox = await box(shell);
      const canvasBox = await box(canvas);

      expect(canvasBox.width).toBeCloseTo(shellBox.width, 0);
      expect(canvasBox.height).toBeCloseTo(shellBox.height, 0);
      expect(canvasBox.width).toBeCloseTo(VIEWPORT.width, 0);
      expect(canvasBox.height).toBeCloseTo(VIEWPORT.height, 0);

      // Abrir o menu e a toolbar não empurra o canvas.
      await regions(page, variant).menuButton.focus();
      await page.keyboard.press('Enter');
      await expect(regions(page, variant).menu).toBeVisible();
      const afterMenu = await box(canvas);
      expect(afterMenu.width).toBeCloseTo(canvasBox.width, 0);
      expect(afterMenu.height).toBeCloseTo(canvasBox.height, 0);
    });

    test('US-S.2: o ponteiro passa entre as ilhas e não passa por elas', async ({ page }) => {
      const { menuButton } = regions(page, variant);
      await setTool(page, 'hand');

      // Entre as ilhas: o elemento sob o ponteiro é o canvas.
      const target = await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit?.tagName.toLowerCase() === 'canvas-surface' ||
            hit?.closest('#canvas-container')
            ? 'canvas'
            : (hit?.tagName.toLowerCase() ?? 'nada');
        },
        { x: VIEWPORT.width / 2, y: 120 },
      );
      expect(target).toBe('canvas');

      // Arrastar a mão sobre uma área vazia faz pan.
      const before = await viewportOf(page);
      await page.mouse.move(500, 300);
      await page.mouse.down();
      await page.mouse.move(560, 340, { steps: 5 });
      await page.mouse.up();
      const panned = await viewportOf(page);
      expect(panned.x).not.toBe(before.x);

      // Arrastar a partir de uma ilha não faz pan no canvas.
      const buttonBox = await box(menuButton);
      await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(buttonBox.x + 300, buttonBox.y + 200, { steps: 5 });
      await page.mouse.up();
      const afterIsland = await viewportOf(page);
      expect(afterIsland.x).toBe(panned.x);
      expect(afterIsland.y).toBe(panned.y);
    });

    test('US-S.3: as ilhas têm fundo cinza de superfície, sombra difusa e cantos arredondados', async ({
      page,
    }) => {
      const { menuButton, toolbar } = regions(page, variant);
      const style = async (locator: Locator) =>
        locator.evaluate((el) => {
          const computed = getComputedStyle(el);
          return {
            background: computed.backgroundColor,
            shadow: computed.boxShadow,
            radius: parseFloat(computed.borderTopLeftRadius),
          };
        });

      const button = await style(menuButton);
      expect(button.background).toBe('rgb(235, 236, 239)');
      expect(button.shadow).not.toBe('none');
      expect(button.radius).toBeGreaterThanOrEqual(16);

      // A pílula da toolbar: no <canvas-toolbar>, é o `toolbar-wrapper` dentro do Shadow DOM.
      const bar = await style(variant.isVanilla ? toolbar : toolbar.locator('[part~="toolbar"]'));
      expect(bar.background).toBe('rgb(235, 236, 239)');
      expect(bar.shadow).not.toBe('none');
      expect(bar.radius).toBeGreaterThanOrEqual(16);
    });

    test('US-S.4: o menu abre por clique, Enter e Espaço; Esc e clique fora fecham e devolvem o foco', async ({
      page,
    }) => {
      const { menuButton, menu, shell } = regions(page, variant);
      const toggles: boolean[] = [];
      if (!variant.isVanilla) {
        await shell.evaluate((el, key) => {
          const target = window as unknown as Record<string, boolean[]>;
          target[key] = [];
          el.addEventListener('menu-toggle', (event) =>
            target[key]!.push((event as CustomEvent<{ open: boolean }>).detail.open),
          );
        }, '__toggles');
      }

      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toBeHidden();

      await menuButton.click();
      await expect(menu).toBeVisible();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      toggles.push(true);

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuButton).toBeFocused();
      toggles.push(false);

      await menuButton.press('Enter');
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      toggles.push(true, false);

      await menuButton.focus();
      await page.keyboard.press('Space');
      await expect(menu).toBeVisible();
      toggles.push(true);

      // Clicar dentro do menu não fecha; clicar fora fecha.
      await menu.click({ position: { x: 4, y: 4 } });
      await expect(menu).toBeVisible();
      await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height - 120);
      await expect(menu).toBeHidden();
      toggles.push(false);

      if (!variant.isVanilla) {
        const emitted = await page.evaluate(
          () => (window as unknown as Record<string, boolean[]>)['__toggles'],
        );
        expect(emitted).toEqual(toggles);
      }
    });

    test('US-S.5: o título edita no lugar: Enter confirma, Esc cancela e vazio volta ao anterior', async ({
      page,
    }) => {
      const { title, titleInput } = regions(page, variant);
      const original = (await title.textContent())!.trim();
      expect(original).not.toBe('');

      await title.click();
      await expect(titleInput).toBeFocused();
      await titleInput.fill('  Projeto novo  ');
      await page.keyboard.press('Enter');
      await expect(titleInput).toHaveCount(0);
      await expect(title).toBeFocused();
      await expect(title).toHaveText('Projeto novo');

      await title.press('F2');
      await expect(titleInput).toBeFocused();
      await titleInput.fill('descartado');
      await page.keyboard.press('Escape');
      await expect(titleInput).toHaveCount(0);
      await expect(title).toHaveText('Projeto novo');

      await title.click();
      await titleInput.fill('   ');
      await page.keyboard.press('Enter');
      await expect(title).toHaveText('Projeto novo');

      await title.click();
      await expect(titleInput).toHaveAttribute('maxlength', '120');
    });

    test('US-S.6: a toolbar fica centralizada na vertical, a 16 px da borda direita, e os menus abrem para dentro da tela', async ({
      page,
    }) => {
      const { toolbar } = regions(page, variant);

      const bar = await box(toolbar);

      expect(bar.x + bar.width).toBeCloseTo(VIEWPORT.width - MARGIN, 0);
      expect(bar.y + bar.height / 2).toBeCloseTo(VIEWPORT.height / 2, 0);
      expect(bar.width).toBeLessThanOrEqual(80);
      await toolbar.locator('[data-action="open-shapes"]').click();
      const menu = toolbar.locator('[role="menu"]').first();
      await expect(menu).toBeVisible();
      const menuBox = await box(menu);
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(bar.x + 1);
    });

    // O Vanilla não tem toolbar compacta: o teste existe só para os exemplos com <canvas-toolbar>.
    if (!variant.isVanilla) {
      test('US-S.7: em modo leitura a toolbar mostra só Seleção e Mão e volta ao completo ao sair', async ({
        page,
      }) => {
        const { toolbar } = regions(page, variant);
        const tools = toolbar.locator('[data-tool]');
        const full = await tools.count();
        expect(full).toBeGreaterThan(5);

        await page.evaluate(() => {
          const w = globalThis as unknown as Record<
            string,
            { section?: { setReadOnly(v: boolean): void } }
          >;
          const section =
            w['__CANVASH_REACT__']?.section ??
            w['__CANVASH_VUE__']?.section ??
            (
              w['__CANVASH_WC__'] as unknown as {
                canvas: { section?: { setReadOnly(v: boolean): void } };
              }
            )?.canvas.section;
          section?.setReadOnly(true);
        });
        await expect(tools).toHaveCount(2);
        await expect(toolbar.locator('[data-tool="select"]')).toBeVisible();
        await expect(toolbar.locator('[data-tool="hand"]')).toBeVisible();

        await page.evaluate(() => {
          const w = globalThis as unknown as Record<
            string,
            { section?: { setReadOnly(v: boolean): void } }
          >;
          const section =
            w['__CANVASH_REACT__']?.section ??
            w['__CANVASH_VUE__']?.section ??
            (
              w['__CANVASH_WC__'] as unknown as {
                canvas: { section?: { setReadOnly(v: boolean): void } };
              }
            )?.canvas.section;
          section?.setReadOnly(false);
        });
        await expect(tools).toHaveCount(full);
      });
    }
  });

  test.describe(`Shell de ilhas flutuantes em tela estreita: ${variant.name}`, () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('US-S.9: nenhuma ilha sai da tela, a página não rola na horizontal e o título trunca', async ({
      page,
    }) => {
      await openVariant(page, variant, { classic: false });
      const { menuButton, title, toolbar, controls } = regions(page, variant);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      for (const island of [menuButton, toolbar, controls]) {
        const found = await box(island);
        expect(found.x).toBeGreaterThanOrEqual(0);
        expect(found.y).toBeGreaterThanOrEqual(0);
        expect(found.x + found.width).toBeLessThanOrEqual(375 + 1);
        expect(found.y + found.height).toBeLessThanOrEqual(667 + 1);
      }

      // Um título muito longo fica numa linha só, dentro da tela.
      await title.click();
      const input = regions(page, variant).titleInput;
      await input.fill('x'.repeat(120));
      await page.keyboard.press('Enter');
      const long = await box(title);
      expect(long.height).toBeLessThan(60);
      expect(long.x + long.width).toBeLessThanOrEqual(375);
    });
  });
}
