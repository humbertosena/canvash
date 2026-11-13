import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers do layout de ilhas flutuantes. Nos exemplos com shell, os controles do playground
 * (adicionar figuras, alternar leitura, persistência...) moram num cartão aberto por um botão da
 * toolbar (`#btn-playground`), que começa fechado, e camadas e propriedades vivem noutro cartão que
 * começa escondido. Em páginas sem shell, todos estes helpers não fazem nada.
 */

/** Botão do menu hambúrguer: o do `<canvas-section>` ou, no Vanilla, o `#shell-menu-button`. */
const MENU_BUTTON = 'canvas-section [part~="menu-button"], #shell-menu-button';

async function menuButton(page: Page) {
  // Sem shell na página (ou no layout clássico do Vanilla), não há o que abrir; com shell,
  // espera o botão renderizar.
  if ((await page.locator('body.classic').count()) > 0) return undefined;
  if ((await page.locator('canvas-section, #shell-menu-button').count()) === 0) return undefined;
  const button = page.locator(MENU_BUTTON).first();
  await button.waitFor();
  return button;
}

/** Abre o menu hambúrguer, se houver shell e ele estiver fechado. */
export async function openShellMenu(page: Page): Promise<void> {
  const button = await menuButton(page);
  if (!button || (await button.getAttribute('aria-expanded')) === 'true') return;
  // Pelo teclado, para não deixar a modalidade de entrada em "mouse": no Firefox o anel de foco
  // (:focus-visible) dos specs seguintes depende dela.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** Botão da toolbar que abre o cartão do playground, e o cartão (um `popover`). */
const PLAYGROUND_BUTTON = '#btn-playground';
const PLAYGROUND_PANEL = '#playground-panel';

/** O cartão do playground está aberto? (`:popover-open` é o estado real, não o atributo.) */
async function playgroundIsOpen(page: Page): Promise<boolean> {
  return page
    .locator(PLAYGROUND_PANEL)
    .evaluate((panel) => panel.matches(':popover-open'))
    .catch(() => false);
}

/**
 * O botão do playground, já renderizado. Sem shell na página, ou no layout clássico do Vanilla
 * (controles soltos), devolve `null`: não há o que abrir.
 */
async function playgroundButton(page: Page): Promise<Locator | null> {
  if ((await page.locator('body.classic').count()) > 0) return null;
  if ((await page.locator('canvas-section, #shell-menu-button').count()) === 0) return null;
  const button = page.locator(PLAYGROUND_BUTTON).first();
  await button.waitFor();
  return button;
}

/** Abre o playground, o cartão da toolbar, se houver shell e ele estiver fechado. */
export async function openPlayground(page: Page): Promise<void> {
  const button = await playgroundButton(page);
  if (!button || (await playgroundIsOpen(page))) return;
  // Pelo teclado, como no menu: não deixa a modalidade de entrada em "mouse".
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => playgroundIsOpen(page)).toBe(true);
}

/** Fecha o playground, se estiver aberto: o cartão fica ao lado da toolbar, mas cobre o canvas. */
export async function closePlayground(page: Page): Promise<void> {
  const button = await playgroundButton(page);
  if (!button || !(await playgroundIsOpen(page))) return;
  await page.keyboard.press('Escape');
  await expect.poll(() => playgroundIsOpen(page)).toBe(false);
}

/** Clica num controle do playground: abre, clica e fecha, para o cartão não cobrir o canvas. */
export async function clickInPlayground(page: Page, selector: string): Promise<void> {
  await openPlayground(page);
  await page.click(selector);
  await closePlayground(page);
}

/** Mostra o cartão de camadas e propriedades, que começa escondido. */
export async function showShellPanels(page: Page): Promise<void> {
  const toggle = page.locator('#btn-toggle-panels');
  if ((await toggle.count()) === 0) return;
  // O cartão só aparece depois do clique: espera o shell ficar interativo.
  await openPlayground(page);
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.focus();
    await page.keyboard.press('Enter');
  }
  await closePlayground(page);
}

/**
 * Devolve a toolbar do exemplo ao formato clássico: horizontal, com histórico e zoom, solta no
 * canto da página. Os specs que testam a própria `<canvas-toolbar>` (teclado, orientação, histórico
 * e zoom) dependem deste formato; no shell ela é vertical e sem histórico nem zoom.
 */
export async function useClassicToolbar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const toolbar = document.querySelector('canvas-toolbar[slot="toolbar"]') as
      | (HTMLElement & {
          orientation: string;
          hideHistory: boolean;
          hideZoom: boolean;
          compactReadonly: boolean;
        })
      | null;
    if (!toolbar || toolbar.getAttribute('slot') === null) return;
    toolbar.removeAttribute('slot');
    toolbar.orientation = 'horizontal';
    toolbar.hideHistory = false;
    toolbar.hideZoom = false;
    toolbar.compactReadonly = false;
    toolbar.style.cssText = 'position:fixed;left:72px;top:12px;z-index:30';
    document.body.append(toolbar);
  });
}

/**
 * Layout clássico para os specs entre variantes (figuras, painel de propriedades, teclado): a
 * toolbar volta ao formato clássico e o cartão de camadas e propriedades fica visível, mas à
 * direita, fora da área onde os specs desenham e clicam. O layout de ilhas em si é coberto pelos
 * specs do shell. Não faz nada em páginas sem o exemplo com shell.
 */
export async function useClassicLayout(page: Page): Promise<void> {
  if ((await page.locator('canvas-section').count()) === 0) return;
  await useClassicToolbar(page);
  await page.evaluate(() => {
    const left = document.querySelector('[slot="left"]') as HTMLElement | null;
    if (!left) return;
    left.hidden = false;
    left.style.cssText =
      'position:fixed;right:80px;top:72px;width:260px;height:520px;z-index:25;display:flex;flex-direction:column;gap:8px';
  });
}

/** Botão "Propriedades" da ilha: o da `<canvas-toolbar>` ou, no Vanilla shell, o `#btn-properties`. */
const PROPERTIES_BUTTON = 'canvas-toolbar [data-action="properties"], #btn-properties';

/** O canvas da página, quando há seleção: o mini-menu só aparece com ela. */
async function hasSelection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section?: CanvasSectionApi };
      __CANVASH_REACT__?: { section?: CanvasSectionApi };
      __CANVASH_VUE__?: { section?: CanvasSectionApi };
      __CANVASH_WC__?: { canvas: { section?: CanvasSectionApi } };
    };
    interface CanvasSectionApi {
      getSnapshot(): { session: { selectedIds: readonly string[] } };
    }
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    return (section?.getSnapshot().session.selectedIds.length ?? 0) > 0;
  });
}

/**
 * Fecha o painel de propriedades da ilha, se estiver aberto. A ilha não fecha ao clicar no canvas
 * (a seleção pode mudar com ela aberta), então os specs que depois mexem na área de desenho a
 * fecham antes, para o painel não cobrir o que o ponteiro vai tocar.
 */
export async function closePropertiesPanel(page: Page): Promise<void> {
  const button = page.locator(PROPERTIES_BUTTON).first();
  if ((await button.count()) === 0) return;
  if ((await button.getAttribute('aria-expanded')) !== 'true') return;
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
}

/**
 * Deixa o `<canvas-properties>` do exemplo visível e utilizável. As propriedades moram na ilha da
 * toolbar, cujo botão "Propriedades" só habilita com algo selecionado: com seleção, abre o painel
 * por ele (se já estiver aberto, não faz nada). Sem seleção o botão fica desabilitado, e o
 * `<canvas-properties>` (que também funciona fora da ilha) é fixado à direita: serve aos specs do
 * próprio componente (estado vazio, tema, partes, i18n e a11y). No layout clássico do Vanilla as
 * propriedades já ficam fixas: nada muda.
 */
export async function openPropertiesPanel(
  page: Page,
  variant: { readonly isVanilla: boolean },
): Promise<void> {
  const button = page.locator(PROPERTIES_BUTTON).first();
  // No layout clássico do Vanilla (`?layout=classic`) não há ilha: as propriedades ficam fixas.
  if (variant.isVanilla && (await page.locator('body.classic').count()) > 0) return;

  if (await hasSelection(page)) {
    // O botão habilita no quadro seguinte à seleção.
    await expect(button).toBeEnabled();
    if ((await button.getAttribute('aria-expanded')) === 'true') return;
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    return;
  }

  await page.evaluate(() => {
    const properties = document.querySelector('canvas-properties') as HTMLElement | null;
    if (!properties) return;
    properties.removeAttribute('slot');
    properties.style.cssText =
      'position:fixed;right:80px;top:72px;width:260px;max-height:520px;overflow:auto;z-index:25';
    document.body.append(properties);
  });
}
