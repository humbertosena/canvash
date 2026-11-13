import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly revision: number;
        readonly session: {
          readonly selectedIds: readonly string[];
          readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
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
              readonly locked?: boolean;
            }
          >;
        };
      };
      readonly getPreview: () => unknown | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
    };
    readonly interaction?: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
      readonly getData: () => { readonly pointerId?: number; readonly name: string };
    };
  };
}

test.describe('Interação: Cancelamento de Gestos (Tarefa 38 - INPUT-02, INPUT-05)', () => {
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

  test('Escape durante criação descarta preview sem criar shape nem alterar documento (INPUT-02)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    const initialRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });

    // Inicia arrasto de criação no centro do canvas
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 350, { steps: 5 });

    // Verifica que está no modo creating e preview ativo
    const stateDuring = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(stateDuring.state).toBe('creating');
    expect(stateDuring.hasPreview).toBe(true);

    // Pressiona Escape para cancelar o gesto
    await page.keyboard.press('Escape');

    // Verifica que o estado voltou para idle e preview foi descartado
    const stateAfterEscape = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });
    expect(stateAfterEscape.state).toBe('idle');
    expect(stateAfterEscape.preview).toBeNull();

    // Solta o botão do mouse
    await page.mouse.up();

    // Verifica que nenhum nó foi adicionado e a revisão do documento não foi alterada
    const afterSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
        nodeCount: Object.keys(g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {})
          .length,
      };
    });
    expect(afterSnap.revision).toBe(initialRev);
  });

  test('Escape durante movimentação restaura posição original sem gerar histórico (INPUT-02)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect (x: 40, y: 40, width: 220, height: 140)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        x: node?.x,
        y: node?.y,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    // Ponto dentro do bg-rect: (40 + 50, 40 + 50) = (90, 90)
    await page.mouse.move(box.x + 90, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 180, { steps: 5 });

    const stateMoving = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(stateMoving.state).toBe('moving');
    expect(stateMoving.hasPreview).toBe(true);

    // Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        x: node?.x,
        y: node?.y,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
      };
    });

    expect(afterPos.state).toBe('idle');
    expect(afterPos.preview).toBeNull();
    expect(afterPos.x).toBe(initialPos.x);
    expect(afterPos.y).toBe(initialPos.y);
    expect(afterPos.revision).toBe(initialPos.revision);
  });

  test('Escape durante redimensionamento mantém dimensões originais (INPUT-02)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect: x: 40, y: 40, width: 220, height: 140 -> se handle em (260, 180)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialDims = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        width: node?.width,
        height: node?.height,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    // Clica no handle SE (350, 250)
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 320, { steps: 5 });

    const stateResizing = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(stateResizing.state).toBe('resizing');
    expect(stateResizing.hasPreview).toBe(true);

    // Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterDims = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        width: node?.width,
        height: node?.height,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
      };
    });

    expect(afterDims.state).toBe('idle');
    expect(afterDims.preview).toBeNull();
    expect(afterDims.width).toBe(initialDims.width);
    expect(afterDims.height).toBe(initialDims.height);
    expect(afterDims.revision).toBe(initialDims.revision);
  });

  test('Escape durante rotação mantém ângulo original (INPUT-02)', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect: x: 50, y: 50, width: 300, height: 200
    // Centro: (200, 150). Handle de rotação no topo: x = 200, y = 50 - 24 = 26
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialRot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        rotation: node?.rotation ?? 0,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    await page.mouse.move(box.x + 200, box.y + 26);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 90, { steps: 5 });

    const stateRotating = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(stateRotating.state).toBe('rotating');
    expect(stateRotating.hasPreview).toBe(true);

    // Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterRot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        rotation: node?.rotation ?? 0,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
      };
    });

    expect(afterRot.state).toBe('idle');
    expect(afterRot.preview).toBeNull();
    expect(afterRot.rotation).toBe(initialRot.rotation);
    expect(afterRot.revision).toBe(initialRot.revision);
  });

  test('Escape durante marquee descarta preview e mantém seleção anterior (INPUT-03)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });

    // Inicia marquee no vazio: (500, 300)
    await page.mouse.move(box.x + 500, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 650, box.y + 450, { steps: 5 });

    const stateMarquee = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(stateMarquee.state).toBe('marquee');
    expect(stateMarquee.hasPreview).toBe(true);

    // Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterMarquee = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        selectedIds: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds,
      };
    });

    expect(afterMarquee.state).toBe('idle');
    expect(afterMarquee.preview).toBeNull();
    expect(afterMarquee.selectedIds).toEqual([]);
  });

  test('Escape durante pan restaura o viewport original', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('hand');
    });

    const initialViewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    // Pan arrastando no meio do canvas
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 400, { steps: 5 });

    const statePanning = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getState();
    });
    expect(statePanning).toBe('panning');

    // Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterViewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        viewport: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport,
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
      };
    });

    expect(afterViewport.state).toBe('idle');
    expect(afterViewport.viewport).toEqual(initialViewport);
  });

  test('pointercancel descarta preview e restaura o estado para idle (INPUT-05)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 4 });

    const activePointerId = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getData().pointerId ?? 1;
    });

    expect(
      await page.evaluate(() => {
        const g = globalThis as unknown as PlaygroundGlobal;
        return g.__CANVASH_PLAYGROUND__?.interaction?.getState();
      }),
    ).toBe('creating');

    // Dispara pointercancel diretamente no elemento container com o pointerId real
    await page.evaluate((pid) => {
      const g = globalThis as unknown as {
        document: {
          getElementById: (id: string) => { dispatchEvent: (e: unknown) => void } | null;
        };
        PointerEvent: new (type: string, init?: unknown) => unknown;
      };
      const el = g.document.getElementById('canvas-container');
      el?.dispatchEvent(
        new g.PointerEvent('pointercancel', {
          pointerId: pid,
          bubbles: true,
        }),
      );
    }, activePointerId);

    const afterCancel = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(afterCancel.state).toBe('idle');
    expect(afterCancel.preview).toBeNull();
    await page.mouse.up();
  });

  test('perda de captura (lostpointercapture) cancela gesto sem travar preview (INPUT-05)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 4 });

    const activePointerId = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getData().pointerId ?? 1;
    });

    // Dispara lostpointercapture com o pointerId real
    await page.evaluate((pid) => {
      const g = globalThis as unknown as {
        document: {
          getElementById: (id: string) => { dispatchEvent: (e: unknown) => void } | null;
        };
        PointerEvent: new (type: string, init?: unknown) => unknown;
      };
      const el = g.document.getElementById('canvas-container');
      el?.dispatchEvent(
        new g.PointerEvent('lostpointercapture', {
          pointerId: pid,
          bubbles: true,
        }),
      );
    }, activePointerId);

    const afterLoss = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(afterLoss.state).toBe('idle');
    expect(afterLoss.preview).toBeNull();
    await page.mouse.up();
  });

  test('perda de foco da janela (window.blur) cancela gesto ativo (INPUT-05)', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 4 });

    expect(
      await page.evaluate(() => {
        const g = globalThis as unknown as PlaygroundGlobal;
        return g.__CANVASH_PLAYGROUND__?.interaction?.getState();
      }),
    ).toBe('creating');

    // Dispara window.blur
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        window: { dispatchEvent: (e: unknown) => void };
        Event: new (type: string) => unknown;
      };
      g.window.dispatchEvent(new g.Event('blur'));
    });

    const afterBlur = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(afterBlur.state).toBe('idle');
    expect(afterBlur.preview).toBeNull();
    await page.mouse.up();
  });

  test('ponteiro que sai dos limites sem captura cancela e não deixa preview preso (INPUT-05)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('rectangle');
    });

    // Simula pointerdown
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 280, box.y + 280, { steps: 4 });

    const activePointerId = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getData().pointerId ?? 1;
    });

    // Força pointerleave sem captura com o pointerId real
    await page.evaluate((pid) => {
      const g = globalThis as unknown as {
        document: {
          getElementById: (id: string) => {
            hasPointerCapture?: (id: number) => boolean;
            dispatchEvent: (e: unknown) => void;
          } | null;
        };
        PointerEvent: new (type: string, init?: unknown) => unknown;
      };
      const el = g.document.getElementById('canvas-container');
      if (el) {
        el.hasPointerCapture = () => false;
        el.dispatchEvent(new g.PointerEvent('pointerleave', { pointerId: pid, bubbles: true }));
      }
    }, activePointerId);

    const afterLeave = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(afterLeave.state).toBe('idle');
    expect(afterLeave.preview).toBeNull();
    await page.mouse.up();
  });
});
