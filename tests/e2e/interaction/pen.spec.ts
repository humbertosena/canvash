import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  createShape,
  drag,
  openVariant,
  snapshot,
  VARIANTS,
  type NodeData,
  type Variant,
} from '../helpers/canvas.js';
import { openPropertiesPanel } from '../helpers/shell.js';
import { selectDrawTool } from '../helpers/toolbar.js';

interface StrokeData {
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly color: string;
  readonly kind: string;
  readonly width: string;
}

type InkData = NodeData & {
  readonly strokes: readonly StrokeData[];
  readonly style: { readonly opacity: number };
};

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Um zigue-zague de cantos bem marcados, que a simplificação precisa manter. */
const ZIGZAG = [
  { x: 60, y: 80 },
  { x: 140, y: 160 },
  { x: 220, y: 80 },
  { x: 300, y: 160 },
  { x: 380, y: 80 },
];

async function inks(page: Page): Promise<InkData[]> {
  const nodes = (await snapshot(page)).document.nodes as Record<string, NodeData>;
  return Object.values(nodes).filter((node): node is InkData => node.type === 'ink');
}

async function revision(page: Page): Promise<number> {
  return (await snapshot(page)).revision;
}

async function sectionCall(page: Page, method: 'undo' | 'redo'): Promise<void> {
  await page.evaluate((name) => {
    const w = globalThis as unknown as Record<
      string,
      { section?: Record<string, () => void>; canvas?: { section?: Record<string, () => void> } }
    >;
    const section =
      w['__CANVASH_PLAYGROUND__']?.section ??
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w['__CANVASH_WC__']?.canvas?.section;
    section?.[name]?.();
  }, method);
}

async function previewCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = globalThis as unknown as Record<
      string,
      {
        section?: { getPreview(): { additions: unknown[] } | null };
        canvas?: { section?: { getPreview(): { additions: unknown[] } | null } };
      }
    >;
    const section =
      w['__CANVASH_PLAYGROUND__']?.section ??
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w['__CANVASH_WC__']?.canvas?.section;
    return section?.getPreview()?.additions.length ?? 0;
  });
}

async function setSelection(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((value) => {
    const w = globalThis as unknown as Record<
      string,
      {
        section?: { setSelection(ids: string[]): void };
        canvas?: { section?: { setSelection(ids: string[]): void } };
      }
    >;
    const section =
      w['__CANVASH_PLAYGROUND__']?.section ??
      w['__CANVASH_REACT__']?.section ??
      w['__CANVASH_VUE__']?.section ??
      w['__CANVASH_WC__']?.canvas?.section;
    section?.setSelection(value);
  }, ids);
}

async function dispatchUpdate(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ nodeId, value }) => {
      const w = globalThis as unknown as Record<
        string,
        {
          section?: { dispatch(command: unknown): unknown };
          canvas?: { section?: { dispatch(command: unknown): unknown } };
        }
      >;
      const section =
        w['__CANVASH_PLAYGROUND__']?.section ??
        w['__CANVASH_REACT__']?.section ??
        w['__CANVASH_VUE__']?.section ??
        w['__CANVASH_WC__']?.canvas?.section;
      section?.dispatch({ type: 'shape.update', id: nodeId, patch: value });
    },
    { nodeId: id, value: patch },
  );
}

/** Escolhe a caneta pela interface do exemplo e devolve a caixa do canvas já com a página no topo. */
async function selectPen(page: Page, variant: Variant) {
  await selectDrawTool(page, variant, 'pen');
  await page.evaluate(() => window.scrollTo(0, 0));
  return canvasBox(page, variant);
}

async function chooseSettings(
  page: Page,
  variant: Variant,
  settings: { kind?: string; width?: string; color?: string },
): Promise<void> {
  if (variant.isVanilla) {
    if (settings.kind) await page.locator('#select-pen-kind').selectOption(settings.kind);
    if (settings.width) await page.locator('#select-pen-width').selectOption(settings.width);
    if (settings.color) await page.locator('#input-pen-color').fill(settings.color);
    return;
  }
  const toolbar = page.locator('canvas-toolbar');
  // As configurações aparecem na ilha de Desenho quando a Tinta é a opção marcada: escolhe a Tinta
  // e reabre a ilha pelo botão do grupo.
  await selectDrawTool(page, variant, 'pen');
  await toolbar.locator('[data-action="open-draw"]').click();
  if (settings.kind) await toolbar.locator(`[data-pen-kind="${settings.kind}"]`).click();
  if (settings.width) await toolbar.locator(`[data-pen-width="${settings.width}"]`).click();
  if (settings.color) await toolbar.locator(`[data-pen-color="${settings.color}"]`).click();
  // O menu fecha com a escolha da cor; sem cor, fecha com Esc.
  if (!settings.color) await page.keyboard.press('Escape');
}

/** Desenha com o mouse seguindo os pontos, em coordenadas do mundo (viewport 0, 0, zoom 1). */
async function stroke(
  page: Page,
  box: { x: number; y: number },
  points: ReadonlyArray<{ x: number; y: number }>,
  steps = 8,
): Promise<void> {
  await page.mouse.move(box.x + points[0]!.x, box.y + points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(box.x + point.x, box.y + point.y, { steps });
  }
  await page.mouse.up();
}

/** Desenha com ponteiro de toque, por eventos sintéticos no contêiner interativo do exemplo. */
async function touchStroke(
  page: Page,
  variant: Variant,
  points: ReadonlyArray<{ x: number; y: number }>,
  pointerId = 7,
): Promise<void> {
  await page.evaluate(
    ({ path, isVanilla, id }) => {
      const element = isVanilla
        ? document.querySelector<HTMLElement>('#canvas-container')
        : (document
            .querySelector('canvas-surface')
            ?.shadowRoot?.querySelector('.surface-container') as HTMLElement | null | undefined);
      if (!element) throw new Error('contêiner interativo não encontrado');
      const rect = element.getBoundingClientRect();
      const fire = (type: string, x: number, y: number, buttons: number): void => {
        element.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons,
            clientX: rect.left + x,
            clientY: rect.top + y,
            bubbles: true,
          }),
        );
      };
      fire('pointerdown', path[0]!.x, path[0]!.y, 1);
      for (const point of path.slice(1)) fire('pointermove', point.x, point.y, 1);
      const last = path[path.length - 1]!;
      fire('pointerup', last.x, last.y, 0);
    },
    { path: points, isVanilla: variant.isVanilla, id: pointerId },
  );
}

/** Lê um pixel do canvas na posição de mundo dada (viewport em 0, 0, zoom 1). */
async function pixel(
  page: Page,
  variant: Variant,
  x: number,
  y: number,
): Promise<readonly [number, number, number, number]> {
  const canvas = variant.isVanilla
    ? page.locator('#canvas-container canvas')
    : page.locator('canvas-surface canvas');
  return canvas.evaluate(
    (el, point) => {
      const target = el as HTMLCanvasElement;
      const ratio = target.width / target.clientWidth;
      const context = target.getContext('2d');
      if (!context) return [0, 0, 0, 0] as const;
      const data = context.getImageData(
        Math.round(point.x * ratio),
        Math.round(point.y * ratio),
        1,
        1,
      ).data;
      return [data[0]!, data[1]!, data[2]!, data[3]!] as const;
    },
    { x, y },
  );
}

/** Quanto de "tinta escura" há no pixel: o alfa vezes o escurecimento, de 0 (vazio) a 1 (preto opaco). */
function darkness([r, g, b, a]: readonly [number, number, number, number]): number {
  return (a / 255) * (1 - (r + g + b) / 3 / 255);
}

/** Quantos pixels de uma coluna do canvas são pretos e opacos: a espessura vista do traço. */
async function darkRun(page: Page, variant: Variant, x: number, y0: number, y1: number) {
  let run = 0;
  for (let y = y0; y <= y1; y++) {
    if (darkness(await pixel(page, variant, x, y)) > 0.8) run += 1;
  }
  return run;
}

test.describe('Épico 04 - Feature 01: Caneta nos 4 Exemplos', () => {
  for (const variant of VARIANTS) {
    test.describe(`Plataforma: ${variant.name} (${variant.url})`, () => {
      test(`US-K.1: o traço aparece em tempo real e vira um elemento simplificado em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        expect((await snapshot(page)).session.activeTool).toBe('pen');
        const before = await revision(page);

        await page.mouse.move(box.x + 60, box.y + 80);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 160, { steps: 10 });
        expect(await previewCount(page)).toBe(1);
        expect(await inks(page)).toHaveLength(0);
        await page.mouse.move(box.x + 380, box.y + 80, { steps: 10 });
        await page.mouse.up();

        expect(await previewCount(page)).toBe(0);
        const [ink] = await inks(page);
        expect(ink).toBeDefined();
        expect(ink!.strokes).toHaveLength(1);
        expect(ink!.strokes[0]).toMatchObject({ color: '#1f2937', kind: 'pen', width: 'medium' });
        // Os 20 eventos de movimento viram só as pontas e a quina do meio.
        expect(ink!.strokes[0]!.points.length).toBeLessThan(10);
        expect(ink!.strokes[0]!.points.length).toBeGreaterThanOrEqual(3);
        expect(await revision(page)).toBe(before + 1);
      });

      test(`US-K.1: três traços seguidos formam um elemento e três entradas de histórico em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        const before = await revision(page);

        await stroke(page, box, ZIGZAG);
        await stroke(
          page,
          box,
          ZIGZAG.map((p) => ({ x: p.x, y: p.y + 100 })),
        );
        await stroke(
          page,
          box,
          ZIGZAG.map((p) => ({ x: p.x, y: p.y + 200 })),
        );

        const all = await inks(page);
        expect(all).toHaveLength(1);
        expect(all[0]!.strokes).toHaveLength(3);
        expect(await revision(page)).toBe(before + 3);
      });

      test(`US-K.2: trocar para a seleção e voltar inicia outro elemento em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        await stroke(page, box, ZIGZAG);
        await page.evaluate(() => window.scrollTo(0, 0));
        if (variant.isVanilla) await page.locator('#btn-tool-select').click();
        else await page.locator('canvas-toolbar [data-tool="select"]').click();
        await selectPen(page, variant);
        await stroke(
          page,
          box,
          ZIGZAG.map((p) => ({ x: p.x, y: p.y + 120 })),
        );
        expect(await inks(page)).toHaveLength(2);
      });

      test(`US-K.3: desfazer remove o último traço, depois o elemento, e refazer restaura em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        await stroke(page, box, ZIGZAG);
        await stroke(
          page,
          box,
          ZIGZAG.map((p) => ({ x: p.x, y: p.y + 100 })),
        );
        const full = (await inks(page))[0]!;

        await sectionCall(page, 'undo');
        expect((await inks(page))[0]!.strokes).toHaveLength(1);
        await sectionCall(page, 'undo');
        expect(await inks(page)).toHaveLength(0);

        await sectionCall(page, 'redo');
        await sectionCall(page, 'redo');
        const restored = (await inks(page))[0]!;
        expect(restored).toEqual(full);
      });

      test(`US-K.4: tipo, espessura e cor valem para os próximos traços, e os antigos mantêm os seus em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        let box = await selectPen(page, variant);
        await stroke(page, box, ZIGZAG);

        await chooseSettings(page, variant, {
          kind: 'highlighter',
          width: 'thick',
          color: variant.isVanilla ? '#ef4444' : '#ef4444',
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        box = await canvasBox(page, variant);
        expect((await snapshot(page)).session.activeTool).toBe('pen');
        await stroke(
          page,
          box,
          ZIGZAG.map((p) => ({ x: p.x, y: p.y + 120 })),
        );

        const [ink] = await inks(page);
        expect(ink!.strokes).toHaveLength(2);
        expect(ink!.strokes[0]).toMatchObject({ color: '#1f2937', kind: 'pen', width: 'medium' });
        expect(ink!.strokes[1]).toMatchObject({
          color: '#ef4444',
          kind: 'highlighter',
          width: 'thick',
        });
      });

      test(`US-K.5: seleciona clicando no traço e não no vazio da caixa, move, redimensiona e gira em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        // Um "L": o canto superior direito da caixa fica vazio.
        await stroke(page, box, [
          { x: 100, y: 100 },
          { x: 100, y: 260 },
          { x: 300, y: 260 },
        ]);
        const [ink] = await inks(page);
        const id = ink!.id;
        if (variant.isVanilla) await page.locator('#btn-tool-select').click();
        else await page.locator('canvas-toolbar [data-tool="select"]').click();
        await page.evaluate(() => window.scrollTo(0, 0));

        // Vazio da caixa: não seleciona.
        await page.mouse.click(box.x + 280, box.y + 120);
        expect((await snapshot(page)).session.selectedIds).toEqual([]);
        // Sobre o traço: seleciona.
        await page.mouse.click(box.x + 100, box.y + 140);
        expect((await snapshot(page)).session.selectedIds).toEqual([id]);

        // Mover pelo traço.
        const original = (await inks(page))[0]!;
        await drag(page, { x: box.x + 100, y: box.y + 140 }, { x: box.x + 160, y: box.y + 190 });
        const moved = (await inks(page))[0]!;
        // O encaixe na grade pode acrescentar alguns pixels ao deslocamento.
        expect(Math.abs(moved.x! - (original.x! + 60))).toBeLessThanOrEqual(6);
        expect(Math.abs(moved.y! - (original.y! + 50))).toBeLessThanOrEqual(6);
        expect(moved.x!).toBeGreaterThan(original.x!);
        expect(moved.strokes).toEqual(original.strokes);

        // Redimensionar pela alça sudeste: os traços esticam e a espessura não muda.
        await setSelection(page, [id]);
        const corner = {
          x: box.x + moved.x! + moved.width!,
          y: box.y + moved.y! + moved.height!,
        };
        await drag(page, corner, { x: corner.x + 100, y: corner.y + 60 });
        const resized = (await inks(page))[0]!;
        expect(resized.width!).toBeGreaterThan(moved.width!);
        expect(resized.strokes[0]!.width).toBe('medium');
        expect(resized.strokes[0]!.points).toEqual(moved.strokes[0]!.points);

        // Girar: o traço girado é o atingido.
        await dispatchUpdate(page, id, { rotation: Math.PI / 2 });
        const rotated = (await inks(page))[0]!;
        expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 6);
      });

      test(`US-K.6: caneta, marcador e marca-texto têm espessura e opacidade próprias em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const line = (y: number) => [
          { x: 40, y },
          { x: 240, y },
        ];
        const kinds: Array<[string, string, number]> = [
          ['pen', 'thin', 101],
          ['pen', 'thick', 161],
          ['marker', 'thick', 221],
          ['highlighter', 'thick', 281],
        ];
        for (const [index, [kind, width, y]] of kinds.entries()) {
          await createShape(page, {
            id: `ink-${index}`,
            type: 'ink',
            strokes: [{ points: line(y), color: '#000000', kind, width }],
          });
        }
        await setSelection(page, []);

        // O fundo do canvas muda de exemplo para exemplo, e o grid cruza as coordenadas múltiplas de 20: as
        // linhas ficam em coordenadas ímpares e o escurecimento é medido contra o fundo.
        await expect
          .poll(async () => darkness(await pixel(page, variant, 141, 101)))
          .toBeGreaterThan(0.5);
        // A última linha (marca-texto) é pintada depois da primeira: espera por ela também.
        await expect
          // O fundo é lido a cada tentativa, no mesmo instante que o traço: lido uma vez antes do
          // poll, um quadro transitório fixava a referência e o poll nunca convergia.
          .poll(
            async () =>
              darkness(await pixel(page, variant, 141, 281)) -
              darkness(await pixel(page, variant, 341, 281)),
          )
          .toBeGreaterThan(0);
        const background = darkness(await pixel(page, variant, 341, 281));
        const pen = darkness(await pixel(page, variant, 141, 161));
        const marker = darkness(await pixel(page, variant, 141, 221));
        const highlighter = darkness(await pixel(page, variant, 141, 281));
        expect(pen).toBeGreaterThan(0.9);
        expect(marker).toBeGreaterThan(0.9);
        // Marca-texto: 0,4 de opacidade, bem entre o fundo e o preto opaco.
        expect(highlighter - background).toBeGreaterThan(0.25);
        expect(highlighter - background).toBeLessThan(0.55);

        // A espessura vista segue a tabela: 8 e 16 unidades (± 2 pixels de antialiasing).
        expect(Math.abs((await darkRun(page, variant, 141, 131, 191)) - 8)).toBeLessThanOrEqual(2);
        expect(Math.abs((await darkRun(page, variant, 141, 191, 251)) - 16)).toBeLessThanOrEqual(2);
        // O marca-texto não chega a preto opaco.
        expect(await darkRun(page, variant, 141, 251, 311)).toBe(0);
      });

      test(`US-K.7: um gesto com centenas de amostras fica com poucos pontos, e a forma é a mesma em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        const wave = Array.from({ length: 41 }, (_, i) => ({
          x: 40 + i * 10,
          y: 150 + Math.sin(i / 4) * 60,
        }));
        await stroke(page, box, wave, 10);

        const [ink] = await inks(page);
        const points = ink!.strokes[0]!.points;
        expect(points.length).toBeLessThanOrEqual(2000);
        expect(points.length).toBeLessThan(400);
        expect(points.length).toBeGreaterThan(10);
        // As pontas continuam onde o gesto começou e terminou.
        const world = (p: { x: number; y: number }) => ({
          x: ink!.x! + p.x * ink!.width!,
          y: ink!.y! + p.y * ink!.height!,
        });
        expect(world(points[0]!).x).toBeCloseTo(40, 0);
        expect(world(points[points.length - 1]!).x).toBeCloseTo(440, 0);
      });

      test(`US-K.8: toque e mouse produzem o mesmo documento para o mesmo caminho em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        await stroke(page, box, ZIGZAG, 1);
        const mouse = (await inks(page))[0]!;

        await sectionCall(page, 'undo');
        await selectPen(page, variant);
        await touchStroke(page, variant, ZIGZAG);
        const touch = (await inks(page))[0]!;

        expect(touch.strokes).toEqual(mouse.strokes);
        expect({ x: touch.x, y: touch.y, width: touch.width, height: touch.height }).toEqual({
          x: mouse.x,
          y: mouse.y,
          width: mouse.width,
          height: mouse.height,
        });
      });

      test(`US-K.8: Esc e pointercancel descartam o traço sem histórico em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        const box = await selectPen(page, variant);
        const before = await revision(page);

        await page.mouse.move(box.x + 60, box.y + 80);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 160, { steps: 5 });
        expect(await previewCount(page)).toBe(1);
        await page.keyboard.press('Escape');
        expect(await previewCount(page)).toBe(0);
        await page.mouse.up();
        expect(await inks(page)).toHaveLength(0);
        expect(await revision(page)).toBe(before);

        // pointercancel de um toque em andamento.
        await page.evaluate(
          ({ isVanilla }) => {
            const element = isVanilla
              ? document.querySelector<HTMLElement>('#canvas-container')
              : (document
                  .querySelector('canvas-surface')
                  ?.shadowRoot?.querySelector('.surface-container') as HTMLElement | null);
            if (!element) throw new Error('contêiner interativo não encontrado');
            const rect = element.getBoundingClientRect();
            const make = (type: string, x: number, y: number) =>
              new PointerEvent(type, {
                pointerId: 9,
                pointerType: 'touch',
                isPrimary: true,
                button: type === 'pointermove' ? -1 : 0,
                buttons: type === 'pointercancel' ? 0 : 1,
                clientX: rect.left + x,
                clientY: rect.top + y,
                bubbles: true,
              });
            element.dispatchEvent(make('pointerdown', 50, 50));
            element.dispatchEvent(make('pointermove', 120, 90));
            element.dispatchEvent(make('pointercancel', 120, 90));
          },
          { isVanilla: variant.isVanilla },
        );
        expect(await previewCount(page)).toBe(0);
        expect(await inks(page)).toHaveLength(0);
        expect(await revision(page)).toBe(before);
      });

      test(`a caneta não tem atalho de teclado em ${variant.name}`, async ({ page }) => {
        await openVariant(page, variant);
        const box = await canvasBox(page, variant);
        await page.mouse.move(box.x + 300, box.y + 200);
        for (const key of ['p', 'P', 'b', 'B', 'e', 'E']) {
          await page.keyboard.press(key);
          expect((await snapshot(page)).session.activeTool).not.toBe('pen');
        }
      });

      test(`o menu da caneta passa no axe e se navega pelo teclado em ${variant.name}`, async ({
        page,
      }) => {
        await openVariant(page, variant);
        if (variant.isVanilla) {
          const results = await new AxeBuilder({ page })
            .include('#btn-tool-pen')
            .include('#select-pen-kind')
            .include('#select-pen-width')
            .include('#input-pen-color')
            .withTags(AXE_TAGS)
            .analyze();
          expect(results.violations).toEqual([]);
          return;
        }

        const toolbar = page.locator('canvas-toolbar');
        // A Tinta é a opção marcada do grupo Desenho: a ilha mostra as configurações dela.
        await selectDrawTool(page, variant, 'pen');
        const chip = toolbar.locator('[data-action="open-draw"]');
        await expect(chip).toHaveAttribute('aria-haspopup', 'menu');
        await expect(chip).toHaveAttribute('aria-expanded', 'false');
        await chip.focus();
        await page.keyboard.press('ArrowDown');
        const menu = toolbar.locator('[role="menu"]');
        await expect(menu).toBeVisible();
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.locator('[role="group"]')).toHaveCount(3);
        const items = menu.locator('[role="menuitemradio"]');
        // 4 opções do grupo + 3 tipos + 3 espessuras + 8 cores.
        await expect(items).toHaveCount(18);
        for (let index = 0; index < 18; index++) {
          await expect(items.nth(index)).toHaveAttribute('aria-label', /\S/);
          await expect(items.nth(index)).toHaveAttribute('aria-checked', /^(true|false)$/);
        }
        await expect(toolbar.locator('[role="menuitemradio"]:focus')).toHaveCount(1);

        const axe = await new AxeBuilder({ page })
          .include('canvas-toolbar')
          .withTags(AXE_TAGS)
          .analyze();
        expect(axe.violations).toEqual([]);

        // Teclado: o foco abre na opção Tinta; duas setas para baixo chegam à espessura grossa, e
        // Enter a escolhe com a ilha aberta.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(toolbar.locator('[data-pen-width="thick"]')).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await expect(menu).toBeVisible();
        expect((await snapshot(page)).session.activeTool).toBe('pen');
        // Esc fecha e devolve o foco ao chip.
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(chip).toBeFocused();
      });

      // O painel de propriedades é do <canvas-properties>: o Vanilla não o usa.
      if (!variant.isVanilla) {
        test(`o painel mostra a seção Caneta e recolore os traços em ${variant.name}`, async ({
          page,
        }) => {
          await openVariant(page, variant);
          await createShape(page, {
            id: 'k',
            type: 'ink',
            strokes: [
              {
                points: [
                  { x: 50, y: 50 },
                  { x: 150, y: 90 },
                ],
              },
              { points: [{ x: 50, y: 150 }], color: '#ef4444' },
            ],
          });
          await openPropertiesPanel(page, variant);
          const properties = page.locator('canvas-properties');
          await expect(properties.locator('[part="section-ink"]')).toBeVisible();
          await expect(properties.locator('[data-field="ink-strokes"]')).toContainText('2 traços');
          await expect(properties.locator('[part="btn-fill-preview"]')).toHaveCount(0);

          const axe = await new AxeBuilder({ page })
            .include('canvas-properties')
            .withTags(AXE_TAGS)
            .analyze();
          expect(axe.violations).toEqual([]);

          await properties.locator('input[data-field="ink-color"]').fill('#22c55e');
          await expect
            .poll(async () => (await inks(page))[0]!.strokes.map((s) => s.color))
            .toEqual(['#22c55e', '#22c55e']);
        });
      }
    });
  }
});
