import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createShape, openVariant, VARIANTS, type Variant } from '../helpers/canvas.js';

// Controles da base do canvas (desfazer, refazer, zoom com menu e ajuda) nos quatro exemplos.
// O Vanilla tem o mesmo comportamento em HTML próprio (#canvas-controls); os outros usam
// <canvas-controls>. Os seletores [data-action] e [data-zoom] valem para os dois.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface CanvasSectionLike {
  getSnapshot: () => {
    revision: number;
    document: { nodes: Record<string, unknown> };
    session: {
      viewport: { x: number; y: number; zoom: number };
      selectedIds: readonly string[];
      readOnly: boolean;
    };
    history: { canUndo: boolean; canRedo: boolean };
  };
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setReadOnly: (readOnly: boolean) => void;
  setSelection: (ids: readonly string[]) => void;
}

interface CanvasSectionWindow {
  __CANVASH_PLAYGROUND__?: { section: CanvasSectionLike };
  __CANVASH_REACT__?: { section: CanvasSectionLike };
  __CANVASH_VUE__?: { section: CanvasSectionLike };
  __CANVASH_WC__?: { canvas: { section?: CanvasSectionLike } };
}

interface State {
  readonly revision: number;
  readonly nodeCount: number;
  readonly viewport: { x: number; y: number; zoom: number };
  readonly selectedIds: readonly string[];
  readonly readOnly: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Tamanho em que o zoom se ancora: o do elemento do canvas. */
  readonly area: { width: number; height: number };
  /** Ponto de mundo sob o centro da área. */
  readonly centerWorld: { x: number; y: number };
}

/** Estado do canvas e da área do canvas, lido no navegador. */
async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    const w = globalThis as unknown as CanvasSectionWindow;
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');
    const element =
      document.querySelector('#canvas-container') ?? document.querySelector('canvas-surface');
    if (!element) throw new Error('Canvas não encontrado');
    const snap = section.getSnapshot();
    const { x, y, zoom } = snap.session.viewport;
    const area = { width: element.clientWidth, height: element.clientHeight };
    return {
      revision: snap.revision,
      nodeCount: Object.keys(snap.document.nodes).length,
      viewport: snap.session.viewport,
      selectedIds: snap.session.selectedIds,
      readOnly: snap.session.readOnly,
      canUndo: snap.history.canUndo,
      canRedo: snap.history.canRedo,
      area,
      centerWorld: { x: (area.width / 2 - x) / zoom, y: (area.height / 2 - y) / zoom },
    };
  });
}

async function setViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((v) => {
    const w = globalThis as unknown as CanvasSectionWindow;
    (
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section
    )?.setViewport(v);
  }, viewport);
}

async function sectionAction(
  page: Page,
  action: 'setReadOnly' | 'setSelection',
  value: boolean | readonly string[],
): Promise<void> {
  await page.evaluate(
    ({ name, arg }) => {
      const w = globalThis as unknown as CanvasSectionWindow;
      const section =
        w.__CANVASH_PLAYGROUND__?.section ??
        w.__CANVASH_REACT__?.section ??
        w.__CANVASH_VUE__?.section ??
        w.__CANVASH_WC__?.canvas.section;
      if (name === 'setReadOnly') section?.setReadOnly(arg as boolean);
      else section?.setSelection(arg as readonly string[]);
    },
    { name: action, arg: value },
  );
}

const plain = { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 };

const rectangle = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  type: 'rectangle',
  x,
  y,
  width,
  height,
  rotation: 0,
  style: plain,
});

function controls(page: Page, variant: Variant): Locator {
  return variant.isVanilla ? page.locator('#canvas-controls') : page.locator('canvas-controls');
}

/** Foca a superfície do canvas, para os atalhos de teclado valerem. */
async function focusSection(page: Page, variant: Variant): Promise<void> {
  if (variant.isVanilla) {
    await page.locator('#canvas-container').evaluate((el: HTMLElement) => el.focus());
  } else {
    await page.locator('canvas-surface').evaluate((el: HTMLElement) => el.focus());
  }
}

async function zoomMenuItem(root: Locator, id: string): Promise<Locator> {
  return root.locator(`[data-zoom="${id}"]`);
}

async function openZoomMenu(root: Locator): Promise<void> {
  await root.locator('[data-action="open-zoom"]').click();
  await expect(root.locator('[role="menu"]')).toBeVisible();
}

for (const variant of VARIANTS) {
  test.describe(`Controles do canvas: ${variant.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    test('US-C.1: Aproximar leva a 120% e mantém o ponto central da área', async ({ page }) => {
      await setViewport(page, { x: 30, y: 20, zoom: 1 });
      const before = await state(page);
      const root = controls(page, variant);
      await expect(root.locator('[data-action="open-zoom"]')).toHaveText('100%');

      await openZoomMenu(root);
      await (await zoomMenuItem(root, 'in')).click();

      const after = await state(page);
      expect(after.viewport.zoom).toBeCloseTo(1.2, 10);
      expect(after.centerWorld.x).toBeCloseTo(before.centerWorld.x, 6);
      expect(after.centerWorld.y).toBeCloseTo(before.centerWorld.y, 6);
      await expect(root.locator('[data-action="open-zoom"]')).toHaveText('120%');
      await expect(root.locator('[role="menu"]')).toBeHidden();
    });

    test('US-C.2: o menu abre pela pill, navega por setas, ativa com Enter e Espaço e fecha com Esc ou clique fora', async ({
      page,
    }) => {
      const root = controls(page, variant);
      const button = root.locator('[data-action="open-zoom"]');
      await expect(button).toHaveAttribute('aria-haspopup', 'menu');
      await expect(button).toHaveAttribute('aria-expanded', 'false');

      await button.focus();
      await page.keyboard.press('ArrowUp');
      await expect(root.locator('[role="menu"]')).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(root.locator('[data-zoom="in"]')).toBeFocused();

      await page.keyboard.press('ArrowDown');
      await expect(root.locator('[data-zoom="out"]')).toBeFocused();
      await page.keyboard.press('End');
      await expect(root.locator('[data-zoom="selection"]')).toBeFocused();
      await page.keyboard.press('Home');
      await expect(root.locator('[data-zoom="in"]')).toBeFocused();

      // Enter ativa Aproximar; o menu fecha e o foco volta à pill.
      await page.keyboard.press('Enter');
      expect((await state(page)).viewport.zoom).toBeCloseTo(1.2, 10);
      await expect(root.locator('[role="menu"]')).toBeHidden();
      await expect(button).toBeFocused();

      // Espaço ativa Afastar.
      await button.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
      expect((await state(page)).viewport.zoom).toBeCloseTo(1, 10);

      // Esc fecha e devolve o foco à pill.
      await button.click();
      await expect(root.locator('[role="menu"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(root.locator('[role="menu"]')).toBeHidden();
      await expect(button).toBeFocused();

      // Clique fora fecha.
      await button.click();
      await expect(root.locator('[role="menu"]')).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(root.locator('[role="menu"]')).toBeHidden();
    });

    test('US-C.3: Zoom em 100% volta a 100% mantendo o ponto central', async ({ page }) => {
      await setViewport(page, { x: 100, y: 50, zoom: 0.37 });
      const before = await state(page);
      const root = controls(page, variant);

      await openZoomMenu(root);
      await (await zoomMenuItem(root, 'reset')).click();

      const after = await state(page);
      expect(after.viewport.zoom).toBe(1);
      expect(after.centerWorld.x).toBeCloseTo(before.centerWorld.x, 6);
      expect(after.centerWorld.y).toBeCloseTo(before.centerWorld.y, 6);
    });

    test('US-C.4: Ajustar ao conteúdo enquadra todos os nós; com o documento vazio fica desabilitado', async ({
      page,
    }) => {
      const root = controls(page, variant);
      await openZoomMenu(root);
      await expect(root.locator('[data-zoom="fit"]')).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');

      await createShape(page, rectangle('a', 0, 0, 400, 100));
      await createShape(page, rectangle('b', 1000, 700, 200, 100));
      await sectionAction(page, 'setSelection', []);

      await openZoomMenu(root);
      await expect(root.locator('[data-zoom="fit"]')).toHaveAttribute('aria-disabled', 'false');
      await root.locator('[data-zoom="fit"]').click();

      const after = await state(page);
      // Conteúdo de 1200 × 800 com margem de 40 px em cada lado
      const expected = Math.min((after.area.width - 80) / 1200, (after.area.height - 80) / 800);
      expect(after.viewport.zoom).toBeCloseTo(expected, 6);
      expect(after.centerWorld.x).toBeCloseTo(600, 4);
      expect(after.centerWorld.y).toBeCloseTo(400, 4);
    });

    test('US-C.5: Ajustar à seleção enquadra só os selecionados; sem seleção fica desabilitado', async ({
      page,
    }) => {
      await createShape(page, rectangle('a', 0, 0, 300, 200));
      await createShape(page, rectangle('b', 5000, 5000, 100, 100));
      await sectionAction(page, 'setSelection', []);
      const root = controls(page, variant);

      await openZoomMenu(root);
      await expect(root.locator('[data-zoom="selection"]')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await page.keyboard.press('Escape');

      await sectionAction(page, 'setSelection', ['a']);
      await openZoomMenu(root);
      await root.locator('[data-zoom="selection"]').click();

      const after = await state(page);
      const expected = Math.min((after.area.width - 80) / 300, (after.area.height - 80) / 200);
      expect(after.viewport.zoom).toBeCloseTo(expected, 6);
      expect(after.centerWorld.x).toBeCloseTo(150, 4);
      expect(after.centerWorld.y).toBeCloseTo(100, 4);
    });

    test('US-C.6: atalhos de zoom valem com o canvas focado e são ignorados fora dele', async ({
      page,
    }) => {
      await createShape(page, rectangle('a', 0, 0, 300, 200));
      await sectionAction(page, 'setSelection', ['a']);
      await setViewport(page, { x: 0, y: 0, zoom: 1 });
      await focusSection(page, variant);

      await page.keyboard.press('Control+Equal');
      expect((await state(page)).viewport.zoom).toBeCloseTo(1.2, 10);
      await page.keyboard.press('Control+Minus');
      expect((await state(page)).viewport.zoom).toBeCloseTo(1, 10);

      await setViewport(page, { x: 10, y: 10, zoom: 0.4 });
      await page.keyboard.press('Shift+Digit0');
      expect((await state(page)).viewport.zoom).toBe(1);

      await page.keyboard.press('Shift+Digit1');
      const fitted = await state(page);
      const expected = Math.min((fitted.area.width - 80) / 300, (fitted.area.height - 80) / 200);
      expect(fitted.viewport.zoom).toBeCloseTo(expected, 6);

      await setViewport(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('Shift+Digit2');
      expect((await state(page)).viewport.zoom).toBeCloseTo(expected, 6);

      // Com o foco nos controles (fora do canvas), o atalho não faz nada.
      await setViewport(page, { x: 0, y: 0, zoom: 1 });
      await controls(page, variant).locator('[data-action="open-zoom"]').focus();
      await page.keyboard.press('Control+Equal');
      expect((await state(page)).viewport.zoom).toBe(1);
    });

    test('US-C.7: desfazer e refazer seguem o histórico e ficam desabilitados em somente leitura', async ({
      page,
    }) => {
      const root = controls(page, variant);
      const undo = root.locator('[data-action="undo"]');
      const redo = root.locator('[data-action="redo"]');
      const base = (await state(page)).nodeCount;

      await createShape(page, rectangle('a', 10, 10, 50, 50));
      await expect(undo).toBeEnabled();
      await expect(redo).toBeDisabled();
      expect((await state(page)).nodeCount).toBe(base + 1);

      await undo.click();
      expect((await state(page)).nodeCount).toBe(base);
      await expect(redo).toBeEnabled();

      await redo.click();
      expect((await state(page)).nodeCount).toBe(base + 1);

      await sectionAction(page, 'setReadOnly', true);
      await expect(undo).toBeDisabled();
      await expect(redo).toBeDisabled();
      await sectionAction(page, 'setReadOnly', false);
      await expect(undo).toBeEnabled();
    });

    test('US-C.8: o botão "?" abre o diálogo de atalhos; Esc e Fechar fecham e devolvem o foco', async ({
      page,
    }) => {
      const root = controls(page, variant);
      const help = root.locator('[data-action="open-help"]');
      const dialog = root.locator('dialog');
      await expect(help).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(dialog).toBeHidden();

      await help.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Atalhos de teclado');
      await expect(dialog).toContainText('Ajustar ao conteúdo');
      // A ação de edição de texto da forma (Enter) também está na lista.
      await expect(dialog).toContainText('Editar o texto da forma');

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(help).toBeFocused();

      await help.press('Enter');
      await expect(dialog).toBeVisible();
      await root.locator('[data-action="close-help"]').click();
      await expect(dialog).toBeHidden();
      await expect(help).toBeFocused();
    });

    test('US-C.9: o zoom não muda a revisão do documento nem o histórico', async ({ page }) => {
      await createShape(page, rectangle('a', 10, 10, 50, 50));
      const before = await state(page);
      const root = controls(page, variant);

      await openZoomMenu(root);
      await (await zoomMenuItem(root, 'in')).click();
      await openZoomMenu(root);
      await (await zoomMenuItem(root, 'out')).click();

      const after = await state(page);
      expect(after.revision).toBe(before.revision);
      expect(after.canUndo).toBe(before.canUndo);
      expect(after.canRedo).toBe(before.canRedo);
      expect(after.nodeCount).toBe(before.nodeCount);
    });

    test('axe: sem violações críticas ou sérias com o menu e com o diálogo abertos', async ({
      page,
    }) => {
      const root = controls(page, variant);
      const scope = variant.isVanilla ? '#canvas-controls' : 'canvas-controls';

      await openZoomMenu(root);
      const withMenu = await new AxeBuilder({ page }).include(scope).withTags(AXE_TAGS).analyze();
      expect(withMenu.violations).toEqual([]);
      await page.keyboard.press('Escape');

      await root.locator('[data-action="open-help"]').click();
      await expect(root.locator('dialog')).toBeVisible();
      const withDialog = await new AxeBuilder({ page }).include(scope).withTags(AXE_TAGS).analyze();
      expect(withDialog.violations).toEqual([]);
    });
  });
}

test.describe('Controles do canvas: dois canvas na mesma página (US-C.10)', () => {
  test('cada conjunto de controles age só no próprio canvas', async ({ page }) => {
    const variant = VARIANTS.find((item) => item.name === 'Web Components');
    if (!variant) throw new Error('Variante Web Components não encontrada');
    await openVariant(page, variant, { classic: false });

    await page.evaluate(async () => {
      const canvas = document.createElement('canvas-surface') as HTMLElement;
      canvas.id = 'second-canvas';
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;z-index:40';
      const controlsEl = document.createElement('canvas-controls') as HTMLElement & {
        section?: unknown;
        canvas?: unknown;
      };
      controlsEl.id = 'second-controls';
      controlsEl.style.cssText = 'position:fixed;left:8px;top:210px;z-index:41';
      document.body.append(canvas, controlsEl);
      await customElements.whenDefined('canvas-surface');
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if ((canvas as unknown as { section?: unknown }).section) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      controlsEl.section = (canvas as unknown as { section?: unknown }).section;
      controlsEl.canvas = canvas;
    });

    const readZoom = (id: string) =>
      page.evaluate((canvasId) => {
        const el = document.getElementById(canvasId) as unknown as { section: CanvasSectionLike };
        return el.section.getSnapshot().session.viewport.zoom;
      }, id);

    const second = page.locator('#second-controls');
    await second.locator('[data-action="open-zoom"]').click();
    await second.locator('[data-zoom="in"]').click();

    expect(await readZoom('second-canvas')).toBeCloseTo(1.2, 10);
    expect((await state(page)).viewport.zoom).toBe(1);

    const first = page.locator('canvas-controls').first();
    await first.locator('[data-action="open-zoom"]').click();
    await first.locator('[data-zoom="out"]').click();

    expect((await state(page)).viewport.zoom).toBeCloseTo(1 / 1.2, 10);
    expect(await readZoom('second-canvas')).toBeCloseTo(1.2, 10);
  });
});
