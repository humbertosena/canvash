import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasBox, createShape, openVariant, VARIANTS, type Variant } from '../helpers/canvas.js';

// Mini-menu da seleção e painel de propriedades nos quatro exemplos. O Vanilla tem o mesmo
// comportamento em HTML próprio; os outros usam <canvas-selection-menu> (US-P.1 a US-P.13). Em todos
// o mini-menu tem 3 botões e o painel de propriedades vive na ilha da toolbar (spec
// vertical-island, US-V.9 e US-V.10).

const VIEWPORT = { width: 1280, height: 720 };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const EDITOR = '[data-testid="canvash-text-editor"]';

interface Ui {
  readonly menu: Locator;
  readonly properties: Locator;
  readonly front: Locator;
  readonly back: Locator;
  readonly remove: Locator;
  readonly panel: Locator;
  /** Seletor do elemento que emite `properties-panel-toggle`. */
  readonly host: string;
  /** Seletores dos elementos que contêm o mini-menu e o painel, para o axe. */
  readonly hosts: readonly string[];
  /** Botões do mini-menu, na ordem de tabulação. */
  readonly order: readonly Locator[];
}

function ui(page: Page, variant: Variant): Ui {
  if (variant.isVanilla) {
    const front = page.locator('#btn-selection-front');
    const back = page.locator('#btn-selection-back');
    const remove = page.locator('#btn-selection-delete');
    return {
      menu: page.locator('#selection-menu'),
      properties: page.locator('#btn-properties'),
      front,
      back,
      remove,
      panel: page.locator('#properties-panel'),
      host: '#shell-toolbar',
      hosts: ['#selection-menu', '#shell-toolbar'],
      order: [front, back, remove],
    };
  }
  const menuHost = page.locator('canvas-selection-menu');
  const toolbar = page.locator('canvas-toolbar');
  const front = menuHost.locator('[part~="selection-action-bring-to-front"]');
  const back = menuHost.locator('[part~="selection-action-send-to-back"]');
  const remove = menuHost.locator('[part~="selection-action-delete"]');
  return {
    menu: menuHost.locator('[part~="selection-menu"]'),
    properties: toolbar.locator('[data-action="properties"]'),
    front,
    back,
    remove,
    panel: toolbar.locator('[part~="properties-panel"]'),
    host: 'canvas-toolbar',
    hosts: ['canvas-selection-menu', 'canvas-toolbar'],
    order: [front, back, remove],
  };
}

interface CanvasSectionState {
  readonly order: readonly string[];
  readonly selected: readonly string[];
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly nodes: Record<
    string,
    { readonly type: string; readonly style?: { readonly fill?: string | null } }
  >;
}

type SectionCall =
  | { readonly call: 'state' }
  | { readonly call: 'undo' }
  | { readonly call: 'setSelection'; readonly ids: readonly string[] }
  | { readonly call: 'setReadOnly'; readonly value: boolean }
  | {
      readonly call: 'setViewport';
      readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
    }
  | { readonly call: 'focusCanvas' }
  | { readonly call: 'listen'; readonly host: string };

/** Fala com o canvas do exemplo, seja qual for, e devolve o estado que os testes leem. */
async function call(page: Page, input: SectionCall): Promise<CanvasSectionState> {
  return page.evaluate((command) => {
    interface CanvasSectionApi {
      getSnapshot(): {
        document: {
          layers: ReadonlyArray<{ childIds: readonly string[] }>;
          nodes: CanvasSectionState['nodes'];
        };
        session: { selectedIds: readonly string[]; viewport: CanvasSectionState['viewport'] };
      };
      undo(): void;
      setSelection(ids: readonly string[]): void;
      setReadOnly(value: boolean): void;
      setViewport(viewport: CanvasSectionState['viewport']): void;
    }
    const w = globalThis as unknown as {
      __CANVASH_PLAYGROUND__?: { section: CanvasSectionApi };
      __CANVASH_REACT__?: { section: CanvasSectionApi };
      __CANVASH_VUE__?: { section: CanvasSectionApi };
      __CANVASH_WC__?: { canvas: { section?: CanvasSectionApi } };
      __toggles?: boolean[];
    };
    const section =
      w.__CANVASH_PLAYGROUND__?.section ??
      w.__CANVASH_REACT__?.section ??
      w.__CANVASH_VUE__?.section ??
      w.__CANVASH_WC__?.canvas.section;
    if (!section) throw new Error('Canvas não encontrado');

    switch (command.call) {
      case 'undo':
        section.undo();
        break;
      case 'setSelection':
        section.setSelection(command.ids);
        break;
      case 'setReadOnly':
        section.setReadOnly(command.value);
        break;
      case 'setViewport':
        section.setViewport(command.viewport);
        break;
      case 'focusCanvas':
        (
          (document.querySelector('canvas-surface') ??
            document.querySelector('#canvas-container')) as HTMLElement | null
        )?.focus();
        break;
      case 'listen': {
        w.__toggles = [];
        document
          .querySelector(command.host)
          ?.addEventListener('properties-panel-toggle', (event) => {
            w.__toggles?.push((event as CustomEvent<{ open: boolean }>).detail.open);
          });
        break;
      }
      default:
        break;
    }

    const snap = section.getSnapshot();
    return {
      order: snap.document.layers[0]?.childIds ?? [],
      selected: snap.session.selectedIds,
      viewport: snap.session.viewport,
      nodes: snap.document.nodes,
    };
  }, input);
}

async function toggles(page: Page): Promise<readonly boolean[]> {
  return page.evaluate(() => (globalThis as unknown as { __toggles?: boolean[] }).__toggles ?? []);
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

async function addRect(page: Page, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await createShape(page, {
    id,
    type: 'rectangle',
    x: 300,
    y: 300,
    width: 160,
    height: 100,
    rotation: 0,
    style: { fill: '#3b82f6', stroke: null, strokeWidth: 0, opacity: 1 },
    ...extra,
  });
}

/** O foco está no canvas: o `<canvas-surface>` ou, no Vanilla, o `#canvas-container`. */
async function canvasHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.activeElement?.tagName.toLowerCase() === 'canvas-surface' ||
      document.activeElement?.id === 'canvas-container',
  );
}

for (const variant of VARIANTS) {
  test.describe(`Mini-menu da seleção: ${variant.name}`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      await openVariant(page, variant, { classic: false });
    });

    test('US-P.1: a seleção mostra o mini-menu acima dela, com as ações e o botão Propriedades', async ({
      page,
    }) => {
      const { menu, properties, front, back, remove } = ui(page, variant);
      await expect(menu).toBeHidden();

      await addRect(page, 'r1');

      await expect(menu).toBeVisible();
      await expect(properties).toHaveAttribute('aria-label', 'Propriedades');
      await expect(properties).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(properties).toHaveAttribute('aria-expanded', 'false');
      await expect(front).toHaveAttribute('aria-label', 'Trazer para frente');
      await expect(back).toHaveAttribute('aria-label', 'Enviar para trás');
      await expect(remove).toHaveAttribute('aria-label', 'Excluir');
      await expect(menu).toHaveAttribute('role', 'toolbar');
      await expect(menu).toHaveAttribute('aria-label', 'Ações da seleção');
      // O mini-menu só tem as 3 ações; Propriedades mora na ilha da toolbar.
      await expect(menu.locator('button')).toHaveCount(3);

      const canvas = await canvasBox(page, variant);
      const found = await box(menu);
      expect(found.y + found.height).toBeLessThanOrEqual(canvas.y + 300);
      expect(found.x + found.width / 2).toBeCloseTo(canvas.x + 380, -1);
    });

    test('US-P.2: Propriedades abre o painel junto do menu, e alterar ali é uma entrada de histórico', async ({
      page,
    }) => {
      const { menu, properties, panel, host } = ui(page, variant);
      await addRect(page, 'r1');
      await call(page, { call: 'listen', host });
      await expect(menu).toBeVisible();

      await properties.click();

      await expect(panel).toBeVisible();
      await expect(properties).toHaveAttribute('aria-expanded', 'true');
      const panelBox = await box(panel);
      // O painel abre ao lado da toolbar, dentro da tela e sem cobri-la.
      const bar = await box(
        variant.isVanilla
          ? page.locator('#shell-toolbar')
          : page.locator('canvas-toolbar [part~="toolbar"]'),
      );
      const beside =
        panelBox.x + panelBox.width <= bar.x + 1 || panelBox.x >= bar.x + bar.width - 1;
      expect(beside).toBe(true);
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(await toggles(page)).toEqual([true]);

      if (variant.isVanilla) {
        // O painel do Vanilla guarda "Seleção & Tipo": converter é a propriedade que há nele.
        await page.locator('#btn-convert-type').click();
        await expect
          .poll(async () => (await call(page, { call: 'state' })).nodes['r1']?.type)
          .toBe('square');
        await call(page, { call: 'undo' });
        await expect
          .poll(async () => (await call(page, { call: 'state' })).nodes['r1']?.type)
          .toBe('rectangle');
      } else {
        const fill = page.locator('canvas-properties input[data-property="fill"]');
        await fill.fill('#10b981');
        await fill.dispatchEvent('input');
        await expect
          .poll(async () => (await call(page, { call: 'state' })).nodes['r1']?.style?.fill)
          .toBe('#10b981');
        await call(page, { call: 'undo' });
        await expect
          .poll(async () => (await call(page, { call: 'state' })).nodes['r1']?.style?.fill)
          .toBe('#3b82f6');
      }
    });

    test('US-P.3: esvaziar a seleção fecha o painel; Esc fecha e devolve o foco ao botão', async ({
      page,
    }) => {
      const { menu, properties, panel, host } = ui(page, variant);
      await addRect(page, 'r1');
      await call(page, { call: 'listen', host });
      await expect(menu).toBeVisible();
      const canvas = await canvasBox(page, variant);

      await properties.click();
      await expect(panel).toBeVisible();
      await page.mouse.click(canvas.x + 900, canvas.y + 600);
      await expect(panel).toBeHidden();
      expect((await call(page, { call: 'state' })).selected).toEqual([]);

      await call(page, { call: 'setSelection', ids: ['r1'] });
      await expect(menu).toBeVisible();
      await properties.click();
      await expect(panel).toBeVisible();
      const inside = variant.isVanilla
        ? page.locator('#btn-convert-type')
        : page.locator('canvas-properties input[data-property="width"]');
      await inside.focus();

      await page.keyboard.press('Escape');

      await expect(panel).toBeHidden();
      await expect(properties).toBeFocused();
      await expect(properties).toHaveAttribute('aria-expanded', 'false');
      expect(await toggles(page)).toEqual([true, false, true, false]);
    });

    test('US-P.3: clicar em Propriedades de novo fecha o painel e não o reabre', async ({
      page,
    }) => {
      const { menu, properties, panel } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();

      await properties.click();
      await expect(panel).toBeVisible();
      await properties.click();

      await expect(panel).toBeHidden();
      await expect(properties).toHaveAttribute('aria-expanded', 'false');
    });

    test('US-P.4: durante mover, redimensionar e girar o menu some, e volta ao soltar', async ({
      page,
    }) => {
      const { menu } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();
      const canvas = await canvasBox(page, variant);

      // Mover.
      await page.mouse.move(canvas.x + 380, canvas.y + 350);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 500, canvas.y + 430, { steps: 8 });
      await expect(menu).toBeHidden();
      await page.mouse.up();
      await expect(menu).toBeVisible();
      const moved = await box(menu);
      expect(moved.x + moved.width / 2).toBeCloseTo(canvas.x + 380 + 120, -1);

      // Redimensionar pela alça do canto inferior direito (a caixa agora vai de 420 a 580).
      await page.mouse.move(canvas.x + 580, canvas.y + 480);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 640, canvas.y + 520, { steps: 8 });
      await expect(menu).toBeHidden();
      await page.mouse.up();
      await expect(menu).toBeVisible();

      // Girar pela alça acima do topo (a caixa agora vai de (420, 380) a (640, 520)).
      await page.mouse.move(canvas.x + 530, canvas.y + 380 - 24);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 640, canvas.y + 340, { steps: 8 });
      await expect(menu).toBeHidden();
      await page.mouse.up();
      await expect(menu).toBeVisible();
    });

    test('US-P.4: durante a edição de texto o menu some, e volta ao terminar', async ({ page }) => {
      const { menu } = ui(page, variant);
      await createShape(page, {
        id: 'n1',
        type: 'sticky',
        x: 120,
        y: 100,
        width: 200,
        height: 200,
      });
      await expect(menu).toBeVisible();
      const canvas = await canvasBox(page, variant);

      await page.mouse.dblclick(canvas.x + 220, canvas.y + 200);
      await expect(page.locator(EDITOR)).toBeVisible();
      await expect(menu).toBeHidden();

      await page.keyboard.press('Escape');
      await expect(page.locator(EDITOR)).toHaveCount(0);
      await expect(menu).toBeVisible();
    });

    test('US-P.5: pan e zoom levam o menu junto, e a seleção fora da tela o esconde', async ({
      page,
    }) => {
      const { menu } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();
      const canvas = await canvasBox(page, variant);
      const before = await box(menu);

      await call(page, { call: 'setViewport', viewport: { x: 100, y: 60, zoom: 1 } });
      await expect.poll(async () => (await box(menu)).x).toBeCloseTo(before.x + 100, -1);
      await expect.poll(async () => (await box(menu)).y).toBeCloseTo(before.y + 60, -1);

      // Zoom 2: a caixa vai de (600, 600) a (920, 800); o centro, em x = 760.
      await call(page, { call: 'setViewport', viewport: { x: 0, y: 0, zoom: 2 } });
      await expect
        .poll(async () => {
          const found = await box(menu);
          return found.x + found.width / 2;
        })
        .toBeCloseTo(canvas.x + 760, -1);

      await call(page, { call: 'setViewport', viewport: { x: -5000, y: 0, zoom: 1 } });
      await expect(menu).toBeHidden();

      await call(page, { call: 'setViewport', viewport: { x: 0, y: 0, zoom: 1 } });
      await expect(menu).toBeVisible();
    });

    test('US-P.6: perto do topo o menu vai para baixo da seleção, e perto da borda direita não sai', async ({
      page,
    }) => {
      const { menu } = ui(page, variant);
      const canvas = await canvasBox(page, variant);

      await addRect(page, 'top', { y: 20 });
      await expect(menu).toBeVisible();
      const below = await box(menu);
      expect(below.y).toBeGreaterThanOrEqual(canvas.y + 20 + 100);

      await call(page, { call: 'setSelection', ids: [] });
      await addRect(page, 'edge', { x: 1180, y: 300 });
      await expect(menu).toBeVisible();
      const edge = await box(menu);
      expect(edge.x + edge.width).toBeLessThanOrEqual(canvas.x + canvas.width - 16 + 1);
      expect(edge.x).toBeGreaterThanOrEqual(canvas.x);
    });

    test('US-P.7: trazer para frente e enviar para trás mudam a ordem, e cada clique é uma entrada de histórico', async ({
      page,
    }) => {
      const { menu, front, back } = ui(page, variant);
      await addRect(page, 'a');
      await addRect(page, 'b', { x: 600 });
      await call(page, { call: 'setSelection', ids: ['a'] });
      await expect(menu).toBeVisible();
      expect((await call(page, { call: 'state' })).order).toEqual(['a', 'b']);

      await front.click();
      await expect
        .poll(async () => (await call(page, { call: 'state' })).order)
        .toEqual(['b', 'a']);
      await call(page, { call: 'undo' });
      expect((await call(page, { call: 'state' })).order).toEqual(['a', 'b']);

      await call(page, { call: 'setSelection', ids: ['b'] });
      await expect(menu).toBeVisible();
      await back.click();
      await expect
        .poll(async () => (await call(page, { call: 'state' })).order)
        .toEqual(['b', 'a']);
      await call(page, { call: 'undo' });
      expect((await call(page, { call: 'state' })).order).toEqual(['a', 'b']);
    });

    test('US-P.8: Excluir remove a seleção numa entrada de histórico, esconde o menu e foca o canvas', async ({
      page,
    }) => {
      const { menu, remove } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();

      await remove.click();

      await expect(menu).toBeHidden();
      const after = await call(page, { call: 'state' });
      expect(after.nodes['r1']).toBeUndefined();
      expect(after.selected).toEqual([]);
      expect(await canvasHasFocus(page)).toBe(true);

      await call(page, { call: 'undo' });
      expect((await call(page, { call: 'state' })).nodes['r1']).toBeDefined();
    });

    test('US-P.9: a seleção múltipla tem um só menu sobre a caixa conjunta e valores mistos no painel', async ({
      page,
    }) => {
      const { menu, properties, panel } = ui(page, variant);
      await addRect(page, 'a');
      await addRect(page, 'b', { x: 500, y: 420, width: 240 });
      await call(page, { call: 'setSelection', ids: ['a', 'b'] });

      await expect(menu).toHaveCount(1);
      await expect(menu).toBeVisible();
      const canvas = await canvasBox(page, variant);
      // A caixa conjunta vai de x = 300 a 740: o centro está em 520. O menu se reposiciona no
      // quadro seguinte à seleção.
      await expect
        .poll(async () => {
          const found = await box(menu);
          return found.x + found.width / 2;
        })
        .toBeCloseTo(canvas.x + 520, -1);

      await properties.click();
      await expect(panel).toBeVisible();
      if (!variant.isVanilla) {
        const width = page.locator('canvas-properties input[data-property="width"]');
        await expect(width).toHaveAttribute('placeholder', 'Misto');
      }
    });

    test('US-P.10: em modo leitura nenhum menu aparece, e o painel aberto fecha', async ({
      page,
    }) => {
      const { menu, properties, panel } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();
      await properties.click();
      await expect(panel).toBeVisible();

      await call(page, { call: 'setReadOnly', value: true });

      await expect(menu).toBeHidden();
      await expect(panel).toBeHidden();

      await call(page, { call: 'setReadOnly', value: false });
      await expect(menu).toBeVisible();
    });

    test('US-P.11: ⇧F10 e a tecla de contexto levam o foco ao menu; setas andam; Tab sai', async ({
      page,
    }) => {
      const { menu, order } = ui(page, variant);
      const first = order[0]!;
      const last = order[order.length - 1]!;
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();

      // Do canvas, Tab chega ao mini-menu logo depois dele.
      await call(page, { call: 'focusCanvas' });
      await page.keyboard.press('Tab');
      await expect(first).toBeFocused();

      await call(page, { call: 'focusCanvas' });
      await page.keyboard.press('Shift+F10');
      await expect(first).toBeFocused();

      for (const next of order.slice(1)) {
        await page.keyboard.press('ArrowRight');
        await expect(next).toBeFocused();
      }
      await page.keyboard.press('Home');
      await expect(first).toBeFocused();
      await page.keyboard.press('End');
      await expect(last).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(first).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(last).toBeFocused();
      await page.keyboard.press('Home');
      await expect(first).toBeFocused();

      // Só o botão atual entra na ordem de tabulação: Tab sai do menu.
      await page.keyboard.press('Tab');
      for (const button of order) {
        await expect(button).not.toBeFocused();
      }

      await call(page, { call: 'focusCanvas' });
      await page.keyboard.press('ContextMenu');
      await expect(first).toBeFocused();
    });

    test('US-P.12: o mini-menu e o painel abertos passam no axe-core', async ({ page }) => {
      const { menu, properties, panel, hosts } = ui(page, variant);
      await addRect(page, 'r1');
      await expect(menu).toBeVisible();

      const axeOf = () => {
        const builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
        for (const host of hosts) builder.include(host);
        return builder.analyze();
      };
      const menuAxe = await axeOf();
      expect(menuAxe.violations).toEqual([]);
      const pageAxe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(
        pageAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
      ).toEqual([]);

      await properties.click();
      await expect(panel).toBeVisible();

      const openAxe = await axeOf();
      expect(openAxe.violations).toEqual([]);
      const openPageAxe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(
        openPageAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
      ).toEqual([]);
    });
  });
}
