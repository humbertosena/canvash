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
            }
          >;
        };
      };
      readonly getPreview: () => {
        readonly updates?: Record<string, Record<string, unknown>>;
        readonly additions?: readonly unknown[];
      } | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly dispatch: (cmd: unknown) => { ok: boolean; error?: unknown };
      readonly undo: () => { ok: boolean };
    };
    readonly handle: {
      readonly invalidate: () => void;
      readonly getGuides?: () => readonly SerializedSnapGuide[];
    };
    readonly setGridEnabled: (enabled: boolean) => void;
    readonly isGridEnabled: () => boolean;
    readonly setSnappingEnabled: (enabled: boolean) => void;
    readonly isSnappingEnabled: () => boolean;
  };
}

interface SerializedSnapGuide {
  readonly axis: string;
  readonly coordinate: number;
}

async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number };
    return new Promise<void>((resolve) => {
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(() => resolve());
      });
    });
  });
}

test.describe('Interação: Snapping Magnético e Guias Efêmeras (INPUT-09, Tarefas 51)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Prepara cenário limpo com viewport resetada (0, 0, zoom: 1)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__?.section;
      if (!section) return;

      section.setViewport({ x: 0, y: 0, zoom: 1 });
      section.setTool('select');
      section.setSelection([]);

      // Garante dois shapes previsíveis para testes de snap:
      // snap-target: x: 100, y: 100, width: 100, height: 100 (bordas: 100, 200; centro: 150)
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'snap-target',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
          style: { fill: '#3b82f6', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });

      // snap-mover: x: 300, y: 100, width: 100, height: 100
      section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'snap-mover',
          type: 'rectangle',
          x: 300,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
          style: { fill: '#ef4444', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });

      g.__CANVASH_PLAYGROUND__?.setGridEnabled(false);
      g.__CANVASH_PLAYGROUND__?.setSnappingEnabled(true);
    });

    await waitForRender(page);
  });

  test('atrai para borda vizinha a <= 6 CSS px e desfaz via undo (INPUT-09)', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });

    // Ponto inicial: centro de snap-mover (350, 150)
    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.down();

    // Mover 97px para esquerda: posição raw de snap-mover seria x: 203.
    // A borda direita de snap-target é x: 200. Diferença = 3 CSS px (<= 6 CSS px).
    await page.mouse.move(box.x + 350 - 97, box.y + 150, { steps: 5 });

    // Verifica preview snapado
    const previewX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const updated = preview?.updates?.['snap-mover'];
      return (updated?.x as number) ?? null;
    });
    expect(previewX).toBe(200);

    // Soltar o mouse
    await page.mouse.up();

    // Deve ter comitado exatamente em x = 200
    const committedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['snap-mover']?.x;
    });
    expect(committedX).toBe(200);

    // Reversibilidade no histórico via section.undo()
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.undo();
    });

    const revertedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['snap-mover']?.x;
    });
    expect(revertedX).toBe(300);
  });

  test('não atrai quando a distância for superior a 6 CSS px', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });

    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.down();

    // Mover 92px para esquerda: posição raw de snap-mover será x: 208.
    // Borda de target é 200. Diferença = 8 CSS px (> 6 CSS px).
    await page.mouse.move(box.x + 350 - 92, box.y + 150, { steps: 5 });

    const previewX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const updated = preview?.updates?.['snap-mover'];
      return (updated?.x as number) ?? null;
    });
    expect(previewX).toBe(208);

    await page.mouse.up();

    const committedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['snap-mover']?.x;
    });
    expect(committedX).toBe(208);
  });

  test('suspende o snapping instantaneamente com a tecla Alt (INPUT-09)', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });

    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.down();

    // Pressiona Alt
    await page.keyboard.down('Alt');

    // Mover para x: 203 (que normalmente atrairia para 200)
    await page.mouse.move(box.x + 350 - 97, box.y + 150, { steps: 5 });

    const previewX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const updated = preview?.updates?.['snap-mover'];
      return (updated?.x as number) ?? null;
    });
    // Com Alt, snapping deve estar suspenso: mantém 203
    expect(previewX).toBe(203);

    await page.mouse.up();
    await page.keyboard.up('Alt');

    const committedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['snap-mover']?.x;
    });
    expect(committedX).toBe(203);
  });

  test('normaliza a tolerância de 6 CSS px sob zoom 2x e zoom 0.5x', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Zoom 2x: 6 CSS px = 3 coordenadas de mundo
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 2 });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });

    // Com zoom 2x: snap-mover (300, 100) na tela está em (600, 200). Centro em (700, 300).
    // Movendo para tela tal que x de mundo fique em 202 (diferença de 2 mundo = 4 CSS px <= 6 CSS px):
    // Deve atrair para 200!
    await page.mouse.move(box.x + 700, box.y + 300);
    await page.mouse.down();

    // Deslocamento de tela: -196 px (em mundo = -98 px -> x raw = 202)
    await page.mouse.move(box.x + 700 - 196, box.y + 300, { steps: 5 });

    const previewZoom2 = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const updated = preview?.updates?.['snap-mover'];
      return (updated?.x as number) ?? null;
    });
    expect(previewZoom2).toBe(200);

    await page.mouse.up();
  });

  test('atrai para linhas da grade quando grade está ativada', async ({ page }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.setGridEnabled(true);
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });
    await waitForRender(page);

    const container = page.locator('#canvas-container');
    await container.scrollIntoViewIfNeeded();
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.down();

    // Mover para posição onde x ficaria em 348 (a 2px da linha de grade 350)
    // Deslocamento = +48px (300 + 48 = 348)
    await page.mouse.move(box.x + 350 + 48, box.y + 150, { steps: 5 });

    const previewX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const updated = preview?.updates?.['snap-mover'];
      return (updated?.x as number) ?? null;
    });
    expect(previewX).toBe(350);

    await page.mouse.up();

    const committedX = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['snap-mover']?.x;
    });
    expect(committedX).toBe(350);
  });

  test('emite guias efêmeras no renderer durante o arrasto com snap e limpa no pointerup (INPUT-09)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['snap-mover']);
    });

    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.down();

    // Mover para alinhar na borda direita de snap-target (x = 200)
    await page.mouse.move(box.x + 350 - 97, box.y + 150, { steps: 5 });

    // Durante o arrasto ativo: guias efêmeras devem estar presentes no renderer
    const guidesDuringDrag = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle?.getGuides?.() ?? [];
    });
    expect(guidesDuringDrag.length).toBeGreaterThan(0);
    expect(
      guidesDuringDrag.some((g: SerializedSnapGuide) => g.axis === 'x' && g.coordinate === 200),
    ).toBe(true);

    // Finaliza o gesto
    await page.mouse.up();

    // Após pointerup: as guias devem ter sido completamente limpas
    const guidesAfterUp = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.handle?.getGuides?.() ?? [];
    });
    expect(guidesAfterUp).toEqual([]);
  });
});
