import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  createBoardNode,
  createShape,
  openVariant,
  VARIANTS,
  type Variant,
} from '../helpers/canvas.js';

// Exportar só o board pelo menu de seleção (spec board-export, US-BE.7 e US-BE.9), nos exemplos
// que ligaram a ação. O mini-menu não existe no layout clássico, então abre o layout de ilhas.

/** Os exemplos que já ligam Exportar board. */
export const WIRED: readonly Variant['name'][] = ['Web Components', 'React', 'Vue', 'Vanilla'];

const TITLE = 'Fluxo de aprovação: v2/final';
const BOARD = { id: 'ref', x: 100, y: 50, width: 300, height: 200, title: TITLE };
const OVERLAPPING_COLOR = '#aa0000';

/** Os seletores do botão e dos itens do submenu em cada exemplo (§4.7 da spec). */
function selectors(variant: Variant) {
  return variant.isVanilla
    ? {
        button: '[data-testid="btn-selection-export-board"]',
        item: (format: 'png' | 'svg') => `[data-testid="btn-selection-export-board-${format}"]`,
      }
    : {
        button: 'canvas-selection-menu [data-action="export-board"]',
        item: (format: 'png' | 'svg') =>
          `canvas-selection-menu [part="export-board-item"][data-format="${format}"]`,
      };
}

const slug = (variant: Variant): string =>
  variant.name === 'Web Components' ? 'wc' : variant.name.toLowerCase();

/** O board de referência com um filho que passa 50 da borda direita, e um nó que só o sobrepõe. */
async function buildReference(page: Page): Promise<void> {
  await createShape(page, {
    id: 'child',
    type: 'rectangle',
    x: 350,
    y: 100,
    width: 100,
    height: 50,
    rotation: 0,
    style: { fill: '#336699', stroke: null, strokeWidth: 0, opacity: 1 },
  });
  await createShape(page, {
    id: 'over',
    type: 'rectangle',
    x: 200,
    y: 160,
    width: 60,
    height: 40,
    rotation: 0,
    style: { fill: OVERLAPPING_COLOR, stroke: null, strokeWidth: 0, opacity: 1 },
  });
  await createBoardNode(page, BOARD, ['child']);
}

/**
 * O nome sugerido pelo download. O WebKit o devolve decomposto (NFD), como o sistema de arquivos
 * do macOS; o que o exemplo entrega é NFC, então a comparação é feita em NFC.
 */
const nameOf = (download: { suggestedFilename(): string }): string =>
  download.suggestedFilename().normalize('NFC');

/** Largura e altura do PNG, lidas do cabeçalho IHDR (bytes 16 a 23). */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function exportWith(page: Page, variant: Variant, format: 'png' | 'svg') {
  const target = selectors(variant);
  const button = page.locator(target.button);
  await expect(button).toBeVisible();
  await button.click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(target.item(format)).click(),
  ]);
  return download;
}

for (const variant of VARIANTS.filter((candidate) => WIRED.includes(candidate.name))) {
  test.describe(`Exportar board: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
      await buildReference(page);
    });

    test('US-BE.9: PNG baixa com o título no nome e 602 × 402 px', async ({ page }) => {
      const download = await exportWith(page, variant, 'png');

      expect(nameOf(download)).toBe('Fluxo de aprovação-v2-final.png');
      expect(pngSize((await download.path())!)).toEqual({ width: 602, height: 402 });
    });

    test('US-BE.9: SVG baixa com o título no nome, o recorte, e sem o título nem o nó sobreposto', async ({
      page,
    }) => {
      const download = await exportWith(page, variant, 'svg');

      expect(nameOf(download)).toBe('Fluxo de aprovação-v2-final.svg');
      const svg = readFileSync((await download.path())!, 'utf8');
      expect(svg).toContain('viewBox="99.5 49.5 301 201"');
      expect(svg).toContain('<clipPath id="canvash-board-clip-1">');
      expect(svg).toContain('<g clip-path="url(#canvash-board-clip-1)">');
      expect(svg).not.toContain('Fluxo');
      expect(svg).not.toContain('<text');
      expect(svg.toLowerCase()).not.toContain(OVERLAPPING_COLOR);
      expect(svg).toContain('#336699');
    });

    test('US-BE.7: o submenu tem SVG e PNG, e o botão não existe com um retângulo selecionado', async ({
      page,
    }) => {
      const target = selectors(variant);
      const button = page.locator(target.button);

      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(target.item('svg'))).toBeVisible();
      await expect(page.locator(target.item('png'))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');

      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __CANVASH_PLAYGROUND__?: { section?: { setSelection(ids: string[]): void } };
          __CANVASH_REACT__?: { section: { setSelection(ids: string[]): void } };
          __CANVASH_VUE__?: { section: { setSelection(ids: string[]): void } };
          __CANVASH_WC__?: { canvas: { section?: { setSelection(ids: string[]): void } } };
        };
        (
          w.__CANVASH_PLAYGROUND__?.section ??
          w.__CANVASH_REACT__?.section ??
          w.__CANVASH_VUE__?.section ??
          w.__CANVASH_WC__?.canvas.section
        )?.setSelection(['over']);
      });
      await expect(button).toHaveCount(0);
    });

    test('US-BE.8: Enter abre o submenu com foco em SVG, a seta para baixo vai a PNG e Esc devolve o foco ao botão', async ({
      page,
    }) => {
      const target = selectors(variant);
      const button = page.locator(target.button);

      await button.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(target.item('svg'))).toBeFocused();

      await page.keyboard.press('ArrowDown');
      await expect(page.locator(target.item('png'))).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator(target.item('svg'))).toBeHidden();
    });

    test('a pill Exportar continua baixando o documento inteiro', async ({ page }) => {
      const pill = variant.isVanilla
        ? { button: '#shell-export-button', item: '#shell-export-menu [role="menuitem"]' }
        : {
            button: 'canvas-section [part~="export-button"]',
            item: 'canvas-section [part~="export-item"]',
          };
      await page.locator(pill.button).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(pill.item).nth(0).click(),
      ]);

      expect(download.suggestedFilename()).toBe(`canvash-${slug(variant)}-document.svg`);
    });
  });
}

// No layout clássico do Vanilla o mini-menu não existe: o board não se exporta pela UI ali, e os
// botões soltos continuam exportando o documento.
test.describe('Exportar board: Vanilla no layout clássico', () => {
  test('não há botão de Exportar board, e btn-export-svg exporta o documento', async ({ page }) => {
    const variant = VARIANTS.find((candidate) => candidate.isVanilla)!;
    await openVariant(page, variant);
    await buildReference(page);

    await expect(page.locator('[data-testid="btn-selection-export-board"]')).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-export-svg').click(),
    ]);
    expect(download.suggestedFilename()).toBe('canvash-vanilla-document.svg');
  });
});
