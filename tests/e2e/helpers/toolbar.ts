import type { Page } from '@playwright/test';
import type { Variant } from './canvas.js';

/**
 * Ativa a ferramenta de uma figura pela interface do exemplo. No Vanilla, as figuras são botões
 * soltos num `<fieldset>`. Nos demais, ficam no menu "Formas" da `<canvas-toolbar>`: o helper abre
 * o menu se o item não estiver visível e clica nele.
 */
export async function selectShapeTool(page: Page, variant: Variant, tool: string): Promise<void> {
  if (variant.isVanilla) {
    await page.click(`#shapes-group button[data-tool="${tool}"]`);
    return;
  }
  const toolbar = page.locator('canvas-toolbar');
  const item = toolbar.locator(`[role="menuitemradio"][data-tool="${tool}"]`);
  if (!(await item.isVisible())) {
    await toolbar.locator('[data-action="open-shapes"]').click();
  }
  await item.click();
}

/**
 * Ativa uma ferramenta do grupo Desenho (linha, Bézier, caneta ou borracha) pela interface do
 * exemplo. No Vanilla clássico, são botões soltos. Nos demais, ficam na ilha de Desenho da
 * `<canvas-toolbar>`: o helper abre a ilha se o item não estiver visível, escolhe a opção e a ilha
 * fecha.
 */
export async function selectDrawTool(page: Page, variant: Variant, tool: string): Promise<void> {
  if (variant.isVanilla) {
    await page.click(`#btn-tool-${tool}`);
    return;
  }
  const toolbar = page.locator('canvas-toolbar');
  const item = toolbar.locator(`[role="menuitemradio"][data-tool="${tool}"]`);
  if (!(await item.isVisible())) {
    await toolbar.locator('[data-action="open-draw"]').click();
  }
  await item.click();
}
