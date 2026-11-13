import { expect, test, type Locator, type Page } from '@playwright/test';
import { createShape, openVariant, VARIANTS, type Variant } from '../helpers/canvas.js';

// Ilhas do topo voltadas ao host: itens do menu, playground na toolbar, Exportar, Compartilhar,
// Avatar e o novo estilo do título, nos quatro exemplos. O Vanilla tem as mesmas ilhas em HTML
// próprio; os outros usam <canvas-section>.

const VIEWPORT = { width: 1280, height: 720 };
const NARROW = { width: 375, height: 667 };
const MARGIN = 16;

const MENU_LABELS = ['Novo projeto', 'Abrir projeto…', 'Sobre o Canvash'];
const MENU_IDS = ['new', 'open', 'about'];

interface Islands {
  readonly menuButton: Locator;
  readonly menu: Locator;
  readonly menuItems: Locator;
  readonly title: Locator;
  readonly titleInput: Locator;
  readonly share: Locator;
  readonly exportButton: Locator;
  readonly exportMenu: Locator;
  readonly exportItems: Locator;
  readonly avatar: Locator;
  readonly avatarImage: Locator;
  readonly avatarInitials: Locator;
  readonly toolbar: Locator;
  readonly endSeparator: Locator;
  readonly playgroundButton: Locator;
  readonly playgroundPanel: Locator;
  readonly status: Locator;
}

function islands(page: Page, variant: Variant): Islands {
  if (variant.isVanilla) {
    return {
      menuButton: page.locator('#shell-menu-button'),
      menu: page.locator('#shell-menu'),
      menuItems: page.locator('#shell-menu [data-menu-item]'),
      title: page.locator('#shell-title'),
      titleInput: page.locator('#shell-title-input'),
      share: page.locator('#shell-share-button'),
      exportButton: page.locator('#shell-export-button'),
      exportMenu: page.locator('#shell-export-menu'),
      exportItems: page.locator('#shell-export-menu [role="menuitem"]'),
      avatar: page.locator('#shell-avatar'),
      avatarImage: page.locator('#shell-avatar img'),
      avatarInitials: page.locator('#shell-avatar .shell-avatar-initials'),
      toolbar: page.locator('#shell-toolbar'),
      endSeparator: page.locator('#shell-toolbar .shell-toolbar-separator:not(.area-separator)'),
      playgroundButton: page.locator('#btn-playground'),
      playgroundPanel: page.locator('#playground-panel'),
      status: page.locator('#app-status'),
    };
  }
  return {
    menuButton: page.locator('canvas-section [part~="menu-button"]'),
    menu: page.locator('canvas-section [part~="menu"]'),
    menuItems: page.locator('canvas-section [part~="menu-item"]'),
    title: page.locator('canvas-section [part~="title"]'),
    titleInput: page.locator('canvas-section [part~="title-input"]'),
    share: page.locator('canvas-section [part~="share-button"]'),
    exportButton: page.locator('canvas-section [part~="export-button"]'),
    exportMenu: page.locator('canvas-section [part~="export-menu"]'),
    exportItems: page.locator('canvas-section [part~="export-item"]'),
    avatar: page.locator('canvas-section [part~="avatar"]'),
    avatarImage: page.locator('canvas-section [part~="avatar-image"]'),
    avatarInitials: page.locator('canvas-section [part~="avatar-initials"]'),
    toolbar: page.locator('canvas-toolbar'),
    endSeparator: page.locator('canvas-toolbar [part~="end-separator"]'),
    playgroundButton: page.locator('#btn-playground'),
    playgroundPanel: page.locator('#playground-panel'),
    status: page.locator('#app-status'),
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

interface ClipboardWindow {
  __copied: string[];
  __clipboardFails: boolean;
  __menuSelects: string[];
}

/**
 * Troca `navigator.clipboard.writeText` por um que guarda o texto (ou falha, se pedido): a
 * permissão de leitura da área de transferência varia entre as engines.
 */
async function interceptClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as ClipboardWindow;
    w.__copied = [];
    w.__clipboardFails = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (w.__clipboardFails) throw new DOMException('negado', 'NotAllowedError');
          w.__copied.push(text);
        },
      },
    });
  });
}

const slugOf = (variant: Variant): string =>
  variant.name === 'Web Components' ? 'wc' : variant.name.toLowerCase();

const CONTROLS = {
  shell: [
    'btn-toggle-readonly',
    'btn-toggle-panels',
    'btn-add-rect',
    'btn-add-sticky',
    'btn-save-now',
    'btn-load-saved',
    'btn-toggle-collab',
    'btn-open-tab',
  ],
  vanilla: [
    'btn-zoom-in',
    'btn-pan-left',
    'btn-toggle-grid',
    'btn-toggle-snap',
    'btn-save-now',
    'btn-load-saved',
    'btn-toggle-collab',
    'btn-open-tab',
  ],
} as const;

/** Um controle do playground que não muda o que o spec mede. */
const SAFE_CLICK = { shell: '#btn-add-rect', vanilla: '#btn-toggle-grid' } as const;

/** Liga ou desliga o modo leitura direto no canvas, que todos os exemplos expõem. */
async function setReadOnly(page: Page, readOnly: boolean): Promise<void> {
  await page.evaluate((value) => {
    interface HasCanvasSection {
      section?: { setReadOnly(value: boolean): void };
    }
    const w = globalThis as unknown as Record<string, HasCanvasSection | undefined> & {
      __CANVASH_WC__?: { canvas: { section?: HasCanvasSection['section'] } };
    };
    const section =
      w['__CANVASH_PLAYGROUND__']?.section ??
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w.__CANVASH_WC__?.canvas.section;
    section?.setReadOnly(value);
  }, readOnly);
}

for (const variant of VARIANTS) {
  test.describe(`Menu e playground: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
    });

    test('US-T.1 e US-T.2: o menu lista só os três itens do host; clique, Enter e Espaço escolhem uma vez, fecham e devolvem o foco', async ({
      page,
    }) => {
      const { menuButton, menu, menuItems, status } = islands(page, variant);
      // O Vanilla não usa o <canvas-section>: o aviso é o que se observa nele.
      if (!variant.isVanilla) {
        await page.evaluate(() => {
          const w = window as unknown as ClipboardWindow;
          w.__menuSelects = [];
          document
            .querySelector('canvas-section')
            ?.addEventListener('menu-select', (event) =>
              w.__menuSelects.push((event as CustomEvent<{ id: string }>).detail.id),
            );
        });
      }

      await menuButton.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await expect(menuItems).toHaveText(MENU_LABELS);
      // O que era do menu foi para o playground: o cartão só tem os itens do host.
      await expect(menu.locator('#btn-add-rect, #btn-fit, #btn-save-now')).toHaveCount(0);

      // Enter no primeiro item.
      await menuItems.nth(0).focus();
      await page.keyboard.press('Enter');
      await expect(status).toHaveText('Selecionado: Novo projeto');
      await expect(menu).toBeHidden();
      await expect(menuButton).toBeFocused();

      // Espaço no segundo.
      await page.keyboard.press('Enter');
      await menuItems.nth(1).focus();
      await page.keyboard.press('Space');
      await expect(status).toHaveText('Selecionado: Abrir projeto…');
      await expect(menu).toBeHidden();
      await expect(menuButton).toBeFocused();

      // Clique no terceiro.
      await menuButton.click();
      await menuItems.nth(2).click();
      await expect(status).toHaveText('Selecionado: Sobre o Canvash');
      await expect(menu).toBeHidden();

      if (!variant.isVanilla) {
        const selected = await page.evaluate(
          () => (window as unknown as ClipboardWindow).__menuSelects,
        );
        expect(selected).toEqual(MENU_IDS);
      }
    });

    test('US-T.2: o aviso some depois de alguns segundos', async ({ page }) => {
      const { menuButton, menuItems, status } = islands(page, variant);

      await page.clock.install();
      await menuButton.click();
      await menuItems.nth(0).click();
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute('role', 'status');

      await page.clock.fastForward(3000);
      await expect(status).toBeHidden({ timeout: 6000 });
    });

    test('US-T.3: o botão do playground fica abaixo do divisor da toolbar e abre o cartão com os controles antigos do menu', async ({
      page,
    }) => {
      const { playgroundButton, playgroundPanel, endSeparator, toolbar } = islands(page, variant);

      const separatorBox = await box(endSeparator);
      const buttonBox = await box(playgroundButton);
      expect(buttonBox.y).toBeGreaterThan(separatorBox.y);
      expect(buttonBox.width).toBeCloseTo(36, 0);
      expect(buttonBox.height).toBeCloseTo(36, 0);
      await expect(playgroundButton).toHaveAttribute('aria-label', 'Playground');
      await expect(playgroundButton).toHaveAttribute('aria-controls', 'playground-panel');
      await expect(playgroundButton).toHaveAttribute('aria-expanded', 'false');
      await expect(playgroundPanel).toBeHidden();

      await playgroundButton.focus();
      await page.keyboard.press('Enter');
      await expect(playgroundPanel).toBeVisible();
      await expect(playgroundButton).toHaveAttribute('aria-expanded', 'true');

      // À esquerda da toolbar, centralizado na vertical e dentro da tela.
      const panelBox = await box(playgroundPanel);
      const toolbarBox = await box(toolbar);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(toolbarBox.x);
      expect(panelBox.y + panelBox.height / 2).toBeCloseTo(VIEWPORT.height / 2, -1);
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(VIEWPORT.height);

      for (const id of CONTROLS[variant.isVanilla ? 'vanilla' : 'shell']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }

      // Clicar num controle não fecha o cartão.
      await page.click(SAFE_CLICK[variant.isVanilla ? 'vanilla' : 'shell']);
      await expect(playgroundPanel).toBeVisible();
    });

    test('US-T.3: Esc e clique fora fecham o cartão, e o foco volta ao botão', async ({ page }) => {
      const { playgroundButton, playgroundPanel } = islands(page, variant);

      // Pelo teclado: no Safari o clique não foca o botão, e o foco devolvido é o de antes de abrir.
      await playgroundButton.focus();
      await page.keyboard.press('Enter');
      await expect(playgroundPanel).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(playgroundPanel).toBeHidden();
      await expect(playgroundButton).toHaveAttribute('aria-expanded', 'false');
      await expect(playgroundButton).toBeFocused();

      await playgroundButton.click();
      await expect(playgroundPanel).toBeVisible();
      await page.mouse.click(300, 400);
      await expect(playgroundPanel).toBeHidden();
      await expect(playgroundButton).toHaveAttribute('aria-expanded', 'false');

      // Clicar de novo no botão com o cartão aberto fecha, em vez de reabrir.
      await playgroundButton.click();
      await expect(playgroundPanel).toBeVisible();
      await playgroundButton.click();
      await expect(playgroundPanel).toBeHidden();
    });

    test('US-T.3: em modo leitura o botão do playground segue visível e funcional', async ({
      page,
    }) => {
      const { playgroundButton, playgroundPanel } = islands(page, variant);

      await setReadOnly(page, true);
      await expect(playgroundButton).toBeVisible();
      await expect(playgroundButton).toBeEnabled();

      await playgroundButton.click();
      await expect(playgroundPanel).toBeVisible();
      await expect(
        page.locator(`#${CONTROLS[variant.isVanilla ? 'vanilla' : 'shell'][0] ?? ''}`),
      ).toBeVisible();
    });
  });

  test.describe(`Playground em tela estreita: ${variant.name}`, () => {
    test.use({ viewport: NARROW });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
    });

    test('US-T.11: o cartão do playground cabe na tela', async ({ page }) => {
      const { playgroundButton, playgroundPanel } = islands(page, variant);

      await playgroundButton.click();
      await expect(playgroundPanel).toBeVisible();
      const panel = await box(playgroundPanel);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(NARROW.width);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(NARROW.height);
      // Desconta a toolbar (no mínimo 44 px: um botão de 32 px, o preenchimento e a borda), as duas
      // margens e o vão até o cartão.
      expect(panel.width).toBeLessThanOrEqual(NARROW.width - 44 - 3 * MARGIN + 1);
    });
  });
}

for (const variant of VARIANTS) {
  test.describe(`Ilhas do topo: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
    });

    test('US-T.5: o título é negrito, sem fundo nem borda, mesmo com o ponteiro em cima', async ({
      page,
    }) => {
      const { title } = islands(page, variant);

      await expect(title).toHaveCSS('font-weight', '700');
      await expect(title).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(title).toHaveCSS('background-image', 'none');
      await expect(title).toHaveCSS('border-top-width', '0px');

      await title.hover();
      await expect(title).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });

    test('US-T.5: em edição o campo é itálico, sem negrito, transparente, sem contorno e com a linha em degradê embaixo', async ({
      page,
    }) => {
      const { title, titleInput } = islands(page, variant);

      await title.click();
      await expect(titleInput).toBeFocused();
      await expect(titleInput).toHaveCSS('font-style', 'italic');
      await expect(titleInput).toHaveCSS('font-weight', '400');
      await expect(titleInput).toHaveCSS('border-top-width', '1px');
      await expect(titleInput).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await expect(titleInput).toHaveCSS('outline-style', 'none');
      // Fundo transparente: nenhum preenchimento, nem cor nem gradiente.
      await expect(titleInput).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(titleInput).toHaveCSS('background-image', 'none');
      // A linha: borda de baixo de 2 px, em degradê do tom de seleção dos itens ao fundo do canvas.
      await expect(titleInput).toHaveCSS('border-bottom-width', '2px');
      const line = await titleInput.evaluate((input) => getComputedStyle(input).borderImageSource);
      expect(line).toContain('linear-gradient');
      expect(line.indexOf('rgb(204, 206, 211)')).toBeGreaterThan(-1);
      expect(line.indexOf('rgb(204, 206, 211)')).toBeLessThan(line.indexOf('rgb(242, 243, 245)'));
      // A linha não muda a altura do campo: o topo não pula.
      expect((await box(titleInput)).height).toBe(27);

      // O comportamento da edição não muda: Esc cancela e devolve o foco ao título.
      await page.keyboard.press('Escape');
      await expect(titleInput).toHaveCount(0);
      await expect(title).toBeFocused();
    });

    test('US-T.6: a pill Exportar abre a ilha 8 px abaixo, alinhada à direita, com os dois formatos', async ({
      page,
    }) => {
      const { exportButton, exportMenu, exportItems } = islands(page, variant);

      await expect(exportButton).toHaveText('Exportar');
      await expect(exportButton).toHaveCSS('font-weight', '700');
      await expect(exportButton).toHaveAttribute('aria-haspopup', 'menu');
      await expect(exportButton).toHaveAttribute('aria-expanded', 'false');
      await expect(exportMenu).toBeHidden();

      await exportButton.click();
      await expect(exportMenu).toBeVisible();
      await expect(exportMenu).toHaveAttribute('role', 'menu');
      await expect(exportButton).toHaveAttribute('aria-expanded', 'true');
      await expect(exportItems).toHaveText(['Exportar SVG', 'Exportar PNG']);
      await expect(exportItems.nth(0)).toBeFocused();

      const pill = await box(exportButton);
      const island = await box(exportMenu);
      expect(island.y - (pill.y + pill.height)).toBeCloseTo(8, 0);
      expect(island.x + island.width).toBeCloseTo(pill.x + pill.width, 0);
    });

    test('US-T.6: teclado da ilha (Enter, Espaço e seta para baixo abrem; setas navegam; Esc e Tab fecham)', async ({
      page,
    }) => {
      const { exportButton, exportMenu, exportItems } = islands(page, variant);

      for (const key of ['Enter', 'Space', 'ArrowDown']) {
        await exportButton.focus();
        await page.keyboard.press(key);
        await expect(exportMenu).toBeVisible();
        await expect(exportItems.nth(0)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(exportMenu).toBeHidden();
        await expect(exportButton).toBeFocused();
      }

      await exportButton.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await expect(exportItems.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(exportItems.nth(0)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(exportItems.nth(1)).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(exportMenu).toBeHidden();
      await expect(exportButton).toBeFocused();
    });

    test('US-T.6: clicar fora fecha a ilha', async ({ page }) => {
      const { exportButton, exportMenu } = islands(page, variant);

      await exportButton.click();
      await expect(exportMenu).toBeVisible();
      await page.mouse.click(300, 400);

      await expect(exportMenu).toBeHidden();
      await expect(exportButton).toHaveAttribute('aria-expanded', 'false');
    });

    test('US-T.6: abrir a ilha fecha o menu hambúrguer, e abrir o menu fecha a ilha', async ({
      page,
    }) => {
      const { menuButton, menu, exportButton, exportMenu } = islands(page, variant);

      await menuButton.click();
      await expect(menu).toBeVisible();
      await exportButton.click();
      await expect(exportMenu).toBeVisible();
      await expect(menu).toBeHidden();

      await menuButton.click();
      await expect(menu).toBeVisible();
      await expect(exportMenu).toBeHidden();
    });

    for (const [index, extension] of [
      [0, 'svg'],
      [1, 'png'],
    ] as const) {
      test(`US-T.6: escolher "Exportar ${extension.toUpperCase()}" baixa o arquivo e fecha a ilha`, async ({
        page,
      }) => {
        const { exportButton, exportMenu, exportItems } = islands(page, variant);
        await createShape(page, {
          id: 'export-rect',
          type: 'rectangle',
          x: 40,
          y: 40,
          width: 120,
          height: 80,
          rotation: 0,
        });

        await exportButton.click();
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          exportItems.nth(index).click(),
        ]);

        expect(download.suggestedFilename()).toBe(
          `canvash-${slugOf(variant)}-document.${extension}`,
        );
        await expect(exportMenu).toBeHidden();
      });
    }

    test('US-T.7: Compartilhar copia o link com collab=true e avisa; se a cópia falhar, avisa também', async ({
      page,
    }) => {
      const { share, status } = islands(page, variant);

      await expect(share).toHaveText('Compartilhar');
      await expect(share).toHaveCSS('font-weight', '700');

      await share.click();
      await expect(status).toHaveText('Link copiado');
      await share.click();
      const copied = await page.evaluate(() => (window as unknown as ClipboardWindow).__copied);
      expect(copied).toHaveLength(2);
      const link = new URL(copied[0] ?? '');
      expect(link.searchParams.get('collab')).toBe('true');
      expect(link.origin).toBe(new URL(page.url()).origin);

      await page.evaluate(() => {
        (window as unknown as ClipboardWindow).__clipboardFails = true;
      });
      await share.click();
      await expect(status).toHaveText('Não foi possível copiar o link');
    });

    test('US-T.8: o avatar é a foto circular de 32 px, sem borda nem sombra, com nome acessível e clique', async ({
      page,
    }) => {
      const { avatar, avatarImage, status } = islands(page, variant);

      const found = await box(avatar);
      expect(found.width).toBeCloseTo(32, 0);
      expect(found.height).toBeCloseTo(32, 0);
      await expect(avatar).toHaveCSS('border-top-width', '0px');
      await expect(avatar).toHaveCSS('box-shadow', 'none');
      await expect(avatar).toHaveCSS('border-radius', '50%');
      await expect(avatarImage).toBeVisible();
      await expect
        .poll(() => avatarImage.evaluate((img) => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);

      const named = page.getByRole('button', { name: 'Conta: Pessoa Exemplo' });
      await expect(named).toBeVisible();
      await named.click();
      await expect(status).toHaveText('Conta: Pessoa Exemplo');
    });

    test('US-T.8: se a foto falhar, o avatar mostra as iniciais em branco sobre #1f1f1f', async ({
      page,
    }) => {
      await page.route('**/avatar.svg', (route) => route.abort());
      await openVariant(page, variant, { classic: false });
      const { avatar, avatarImage, avatarInitials } = islands(page, variant);

      await expect(avatarInitials).toHaveText('PE');
      await expect(avatarImage).toHaveCount(0);
      await expect(avatar).toHaveCSS('background-color', 'rgb(31, 31, 31)');
      await expect(avatar).toHaveCSS('color', 'rgb(255, 255, 255)');
    });

    test('US-T.9: à direita a ordem é Compartilhar, Exportar, Avatar, com 8 px entre eles, a 16 px da borda e alinhados ao botão do menu', async ({
      page,
    }) => {
      const { menuButton, share, exportButton, avatar } = islands(page, variant);

      const [anchor, first, second, third] = [
        await box(menuButton),
        await box(share),
        await box(exportButton),
        await box(avatar),
      ];

      expect(second.x - (first.x + first.width)).toBeCloseTo(8, 0);
      expect(third.x - (second.x + second.width)).toBeCloseTo(8, 0);
      expect(VIEWPORT.width - (third.x + third.width)).toBeCloseTo(MARGIN, 0);
      for (const item of [first, second, third]) {
        expect(item.y + item.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 0);
      }
      expect(first.height).toBeCloseTo(32, 0);
      expect(second.height).toBeCloseTo(32, 0);
    });

    test('US-T.10: Exportar e Compartilhar aparecem por padrão; hide-export e hide-share as removem', async ({
      page,
    }) => {
      const { share, exportButton } = islands(page, variant);
      await expect(share).toBeVisible();
      await expect(exportButton).toBeVisible();

      // Os atributos são do <canvas-section>; o Vanilla só tem as ilhas, sempre visíveis.
      if (variant.isVanilla) return;
      await page.evaluate(() => {
        const shell = document.querySelector('canvas-section') as HTMLElement & {
          hideExport: boolean;
          hideShare: boolean;
        };
        shell.hideExport = true;
        shell.hideShare = true;
      });

      await expect(share).toHaveCount(0);
      await expect(exportButton).toHaveCount(0);
      await expect(islands(page, variant).avatar).toBeVisible();
    });
  });

  test.describe(`Ilhas do topo em tela estreita: ${variant.name}`, () => {
    test.use({ viewport: NARROW });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
    });

    test('US-T.11: as pills mostram só o ícone, com o nome acessível, e nada sai da tela nem rola na horizontal', async ({
      page,
    }) => {
      const { share, exportButton, avatar, menuButton, playgroundButton } = islands(page, variant);

      for (const [locator, name] of [
        [share, 'Compartilhar'],
        [exportButton, 'Exportar'],
      ] as const) {
        const found = await box(locator);
        expect(found.width).toBeLessThanOrEqual(40);
        await expect(locator).toHaveAttribute('aria-label', name);
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      }

      for (const locator of [menuButton, share, exportButton, avatar, playgroundButton]) {
        const found = await box(locator);
        expect(found.x).toBeGreaterThanOrEqual(0);
        expect(found.x + found.width).toBeLessThanOrEqual(NARROW.width);
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(NARROW.width);
    });
  });
}

// Hover forte e ilhas temporárias (ghost island): o hover das ilhas do topo deixa o fundo mais forte
// e opaco, e a ilha temporária tem esse mesmo fundo, com a ilha de origem mantendo-o enquanto aberta.
const RESTING_BG = 'rgb(235, 236, 239)';
const STRONG_BG = 'rgb(217, 219, 224)';
/** Um ponto vazio do canvas, longe de qualquer ilha. */
const AWAY = { x: VIEWPORT.width / 2, y: VIEWPORT.height - 120 };

for (const variant of VARIANTS) {
  test.describe(`Hover das ilhas e ilhas temporárias: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
      await page.mouse.move(AWAY.x, AWAY.y);
    });

    test('o hover do hambúrguer, de Compartilhar e de Exportar deixa o fundo mais forte e opaco; sair devolve o original', async ({
      page,
    }) => {
      const { menuButton, share, exportButton } = islands(page, variant);

      for (const island of [menuButton, share, exportButton]) {
        await expect(island).toHaveCSS('background-color', RESTING_BG);

        await island.hover();
        await expect(island).toHaveCSS('background-color', STRONG_BG);

        await page.mouse.move(AWAY.x, AWAY.y);
        await expect(island).toHaveCSS('background-color', RESTING_BG);
      }
    });

    test('menu hambúrguer: o botão e o cartão têm o fundo forte enquanto o cartão está aberto', async ({
      page,
    }) => {
      const { menuButton, menu } = islands(page, variant);

      await menuButton.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await page.mouse.move(AWAY.x, AWAY.y);

      await expect(menu).toHaveCSS('background-color', STRONG_BG);
      await expect(menuButton).toHaveCSS('background-color', STRONG_BG);

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuButton).toHaveCSS('background-color', RESTING_BG);
    });

    test('ilha de exportação: a pill e a ilha têm o fundo forte enquanto aberta; a Compartilhar não muda', async ({
      page,
    }) => {
      const { exportButton, exportMenu, share } = islands(page, variant);

      await exportButton.focus();
      await page.keyboard.press('Enter');
      await expect(exportMenu).toBeVisible();
      await page.mouse.move(AWAY.x, AWAY.y);

      await expect(exportMenu).toHaveCSS('background-color', STRONG_BG);
      await expect(exportButton).toHaveCSS('background-color', STRONG_BG);
      await expect(share).toHaveCSS('background-color', RESTING_BG);

      await page.keyboard.press('Escape');
      await expect(exportMenu).toBeHidden();
      await expect(exportButton).toHaveCSS('background-color', RESTING_BG);
    });

    test('ilha de exportação: clicar fora fecha e a pill volta ao fundo original', async ({
      page,
    }) => {
      const { exportButton, exportMenu } = islands(page, variant);

      await exportButton.click();
      await expect(exportMenu).toBeVisible();
      await page.mouse.move(AWAY.x, AWAY.y);
      await expect(exportButton).toHaveCSS('background-color', STRONG_BG);

      await page.mouse.click(AWAY.x, AWAY.y);
      await expect(exportMenu).toBeHidden();
      await expect(exportButton).toHaveCSS('background-color', RESTING_BG);
    });

    test('os ícones de Compartilhar (16 px, viewBox 256) e Exportar (20 px, viewBox 18) são os novos, com a cor do texto', async ({
      page,
    }) => {
      const { share, exportButton } = islands(page, variant);

      for (const [island, viewBox, size] of [
        [share, '0 0 256 256', 16],
        [exportButton, '0 0 18 18', 20],
      ] as const) {
        const icon = island.locator('svg');
        await expect(icon).toHaveAttribute('viewBox', viewBox);
        const found = await box(icon);
        expect(found.width).toBeCloseTo(size, 0);
        expect(found.height).toBeCloseTo(size, 0);
        await expect(icon.locator('path').first()).toHaveCSS('fill', 'rgb(31, 31, 31)');
      }
    });
  });
}

// O tom de seleção dos itens das ilhas temporárias é o mesmo da linha do título em edição.
const ITEM_HOVER_BG = 'rgb(204, 206, 211)';

for (const variant of VARIANTS) {
  test.describe(`Tom de seleção dos itens e linha do título: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await interceptClipboard(page);
      await openVariant(page, variant, { classic: false });
    });

    test('o item sob o ponteiro, nas duas ilhas temporárias, tem o tom de seleção', async ({
      page,
    }) => {
      const { menuButton, menuItems, exportButton, exportItems } = islands(page, variant);

      await menuButton.focus();
      await page.keyboard.press('Enter');
      await menuItems.nth(1).hover();
      await expect(menuItems.nth(1)).toHaveCSS('background-color', ITEM_HOVER_BG);
      await expect(menuItems.nth(0)).not.toHaveCSS('background-color', ITEM_HOVER_BG);
      await page.keyboard.press('Escape');

      await exportButton.focus();
      await page.keyboard.press('Enter');
      await exportItems.nth(1).hover();
      await expect(exportItems.nth(1)).toHaveCSS('background-color', ITEM_HOVER_BG);
    });

    test('a linha do título em edição começa nesse mesmo tom e termina na cor do canvas', async ({
      page,
    }) => {
      const { title, titleInput } = islands(page, variant);

      await title.click();
      const line = await titleInput.evaluate((input) => getComputedStyle(input).borderImageSource);

      expect(line).toContain(ITEM_HOVER_BG);
      expect(line.indexOf(ITEM_HOVER_BG)).toBeLessThan(line.indexOf('rgb(242, 243, 245)'));
    });
  });
}
