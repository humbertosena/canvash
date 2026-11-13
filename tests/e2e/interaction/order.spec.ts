import { expect, test, type Page } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly revision: number;
        readonly session: {
          readonly selectedIds: readonly string[];
        };
        readonly document: {
          readonly nodes: Record<
            string,
            {
              readonly id: string;
              readonly type: string;
              readonly x?: number;
              readonly y?: number;
              readonly width?: number;
              readonly height?: number;
              readonly rotation?: number;
              readonly childIds?: readonly string[];
              readonly locked?: boolean;
            }
          >;
          readonly layers: readonly {
            readonly id: string;
            readonly name: string;
            readonly visible: boolean;
            readonly locked: boolean;
            readonly childIds: readonly string[];
          }[];
        };
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly dispatch: (cmd: unknown) => { ok: boolean; error?: unknown };
    };
  };
}

interface BrowserCanvasContext {
  getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
}

interface BrowserCanvasElement {
  getContext: (type: string) => BrowserCanvasContext | null;
}

interface BrowserGlobal {
  readonly document: {
    readonly querySelector: (selectors: string) => BrowserCanvasElement | null;
  };
  readonly devicePixelRatio?: number;
  readonly requestAnimationFrame: (callback: () => void) => number;
}

async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as BrowserGlobal;
    return new Promise<void>((resolve) => {
      g.requestAnimationFrame(() => {
        g.requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

async function getPixelAt(page: Page, cssX: number, cssY: number) {
  await waitForRender(page);
  return page.evaluate(
    ({ x, y }) => {
      const g = globalThis as unknown as BrowserGlobal;
      const canvas = g.document.querySelector('#canvas-container canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const dpr = g.devicePixelRatio || 1;
      const px = Math.round(x * dpr);
      const py = Math.round(y * dpr);
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      return {
        r: pixel[0] ?? 0,
        g: pixel[1] ?? 0,
        b: pixel[2] ?? 0,
        a: pixel[3] ?? 0,
      };
    },
    { x: cssX, y: cssY },
  );
}

test.describe('Interação: Reordenação de Camadas e Irmãos (Tarefa 50 - INPUT-08)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta select e seleção limpa
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('traz shape selecionado para a frente dos irmãos com Mod+Shift+] e verifica sobreposição visual (INPUT-08)', async ({
    page,
  }) => {
    // 1. Estado inicial: no ponto (330, 150), overlap-ellipse (laranja) está sobre overlap-rect (verde)
    const initialPixel = await getPixelAt(page, 330, 150);
    expect(initialPixel).not.toBeNull();
    expect(initialPixel!.r).toBeGreaterThan(180);
    expect(initialPixel!.b).toBeLessThan(80);

    // Seleciona overlap-rect e foca o container
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });
    await page.locator('#canvas-container').focus();

    // Pressiona Mod+Shift+] (bring-to-front)
    await page.keyboard.press('ControlOrMeta+Shift+]');

    // 2. Verifica a ordem no snapshot: overlap-rect deve ser o último de layer-middle
    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const middleLayer = snap?.document.layers.find((l) => l.id === 'layer-middle');
    expect(middleLayer).toBeDefined();
    expect(middleLayer!.childIds[middleLayer!.childIds.length - 1]).toBe('overlap-rect');

    // 3. Verificação visual: no ponto (330, 150), overlap-rect (verde: #16a34a) agora cobre overlap-ellipse!
    const updatedPixel = await getPixelAt(page, 330, 150);
    expect(updatedPixel).not.toBeNull();
    expect(updatedPixel!.g).toBeGreaterThan(120);
    expect(updatedPixel!.r).toBeLessThan(100);
  });

  test('envia shape selecionado para o fundo dos irmãos com Mod+Shift+[ e verifica sobreposição visual (INPUT-08)', async ({
    page,
  }) => {
    // Primeiro traz para frente para inverter a ordem
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });
    await page.locator('#canvas-container').focus();
    await page.keyboard.press('ControlOrMeta+Shift+]');

    // Confirma que agora está verde
    let pixel = await getPixelAt(page, 330, 150);
    expect(pixel!.g).toBeGreaterThan(120);

    // Agora envia para o fundo com Mod+Shift+[ (send-to-back)
    await page.keyboard.press('ControlOrMeta+Shift+[');

    // Verifica que overlap-rect voltou ao índice 0 de layer-middle
    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const middleLayer = snap?.document.layers.find((l) => l.id === 'layer-middle');
    expect(middleLayer!.childIds[0]).toBe('overlap-rect');

    // Verificação visual: volta a ser laranja (overlap-ellipse por cima)
    pixel = await getPixelAt(page, 330, 150);
    expect(pixel!.r).toBeGreaterThan(180);
    expect(pixel!.b).toBeLessThan(80);
  });

  test('move shape um nível para frente (Mod+]) e para trás (Mod+[) passo a passo (INPUT-08)', async ({
    page,
  }) => {
    // Inicialmente overlap-rect está no índice 0
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });
    await page.locator('#canvas-container').focus();

    // Mod+] move um nível para frente: do índice 0 para o índice 1 (à frente de overlap-ellipse)
    await page.keyboard.press('ControlOrMeta+]');

    let snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });
    let middleLayer = snap?.document.layers.find((l) => l.id === 'layer-middle');
    expect(middleLayer!.childIds[1]).toBe('overlap-rect');

    // Visualmente overlap-rect agora está sobre overlap-ellipse no ponto (330, 150)
    let pixel = await getPixelAt(page, 330, 150);
    expect(pixel!.g).toBeGreaterThan(120);

    // Mod+[ move um nível para trás: volta para o índice 0
    await page.keyboard.press('ControlOrMeta+[');

    snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });
    middleLayer = snap?.document.layers.find((l) => l.id === 'layer-middle');
    expect(middleLayer!.childIds[0]).toBe('overlap-rect');

    // Visualmente overlap-ellipse volta ao topo
    pixel = await getPixelAt(page, 330, 150);
    expect(pixel!.r).toBeGreaterThan(180);
  });

  test('troca explícita de camada atualiza parentesco e ordem atomicamente com verificação visual (INPUT-08)', async ({
    page,
  }) => {
    // Inicialmente: ponto (210, 150) é verde porque overlap-rect (layer-middle) sobrepõe bg-rect (layer-back)
    const initialPixel = await getPixelAt(page, 210, 150);
    expect(initialPixel!.g).toBeGreaterThan(120);
    expect(initialPixel!.b).toBeLessThan(100);

    // Move overlap-rect para layer-back no índice 0 (atrás de bg-rect)
    const result = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'node.reorder',
        id: 'overlap-rect',
        layerId: 'layer-back',
        index: 0,
      });
    });
    expect(result?.ok).toBe(true);

    // Confirma estado atômico no documento
    const snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const backLayer = snap?.document.layers.find((l) => l.id === 'layer-back');
    const middleLayer = snap?.document.layers.find((l) => l.id === 'layer-middle');

    expect(backLayer!.childIds).toEqual(['overlap-rect', 'bg-rect', 'diag-line']);
    expect(middleLayer!.childIds).toEqual(['overlap-ellipse', 'hidden-in-visible-layer']);

    // Verificação visual: no ponto (210, 150), bg-rect (azul: #2563eb) agora cobre overlap-rect!
    const updatedPixel = await getPixelAt(page, 210, 150);
    expect(updatedPixel!.b).toBeGreaterThan(200);
    expect(updatedPixel!.g).toBeLessThan(150);
    expect(updatedPixel!.r).toBeLessThan(100);
  });

  test('reordenação interna de nós filhos em grupos atualiza a ordem sem alterar camada (INPUT-08)', async ({
    page,
  }) => {
    // Cria grupo na camada intermediária
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'group.create',
        id: 'order-group',
        childIds: ['overlap-rect', 'overlap-ellipse'],
      });
    });

    // Reordena overlap-rect para o índice 1 dentro do grupo
    const reorderChild = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'node.reorder',
        id: 'overlap-rect',
        index: 1,
      });
    });
    expect(reorderChild?.ok).toBe(true);

    let snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const groupNode = snap?.document.nodes['order-group'];
    expect(groupNode?.childIds).toEqual(['overlap-ellipse', 'overlap-rect']);

    // Tentativa de mover membro do grupo para outra camada diretamente é rejeitada
    const rejectCrossLayer = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'node.reorder',
        id: 'overlap-rect',
        layerId: 'layer-back',
        index: 0,
      });
    });
    expect(rejectCrossLayer?.ok).toBe(false);

    // Mover o grupo inteiro para layer-back transfere grupo e filhos atomicamente
    const moveGroupResult = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'node.reorder',
        id: 'order-group',
        layerId: 'layer-back',
        index: 0,
      });
    });
    expect(moveGroupResult?.ok).toBe(true);

    snap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const backLayer = snap?.document.layers.find((l) => l.id === 'layer-back');
    expect(backLayer!.childIds[0]).toBe('order-group');
  });
});
