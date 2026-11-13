import { expect, test } from '@playwright/test';

interface DOMGlobal {
  readonly document: {
    getElementById: (id: string) => {
      dispatchEvent: (event: unknown) => boolean;
    } | null;
  };
  readonly PointerEvent: new (
    type: string,
    eventInitDict?: {
      bubbles?: boolean;
      cancelable?: boolean;
      pointerId?: number;
      pointerType?: string;
      isPrimary?: boolean;
      pressure?: number;
      button?: number;
      buttons?: number;
      clientX?: number;
      clientY?: number;
    },
  ) => unknown;
}

interface PlaygroundGlobal extends DOMGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly revision: number;
        readonly session: {
          readonly selectedIds: readonly string[];
          readonly activeTool: string;
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
              readonly start?: { readonly x: number; readonly y: number };
              readonly end?: { readonly x: number; readonly y: number };
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

test.describe('Interação: Toque, Multitoque e Caneta Stylus (Tarefa 40 - INPUT-01, INPUT-05)', () => {
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

  test('Criação de retângulo com evento touch cria shape perfeitamente (INPUT-01)', async ({
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

    const initialIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return Object.keys(g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes ?? {});
    });

    const startX = box.x + 350;
    const startY = box.y + 120;
    const endX = box.x + 490;
    const endY = box.y + 220;

    // Simula gesto de toque via PointerEvents reais
    await page.evaluate(
      ({ sX, sY, eX, eY }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: sX,
            clientY: sY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: eX,
            clientY: eY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 10,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 0,
            clientX: eX,
            clientY: eY,
          }),
        );
      },
      { sX: startX, sY: startY, eX: endX, eY: endY },
    );

    const snapshot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    expect(snapshot).toBeDefined();
    if (!snapshot) return;

    // Localiza o nó criado comparando com os IDs iniciais
    const createdId = Object.keys(snapshot.document.nodes).find((id) => !initialIds.includes(id));
    expect(createdId).toBeDefined();
    if (!createdId) return;

    const created = snapshot.document.nodes[createdId];
    expect(created?.type).toBe('rectangle');
    expect(created?.width).toBe(140);
    expect(created?.height).toBe(100);
  });

  test('Movimentação de shape com caneta stylus (pointerType: pen) (INPUT-01)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // overlap-rect: x: 180, y: 120, width: 220, height: 160 -> ponto de início em (250, 180)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });

    const initialPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['overlap-rect'];
      return { x: node?.x, y: node?.y };
    });

    const sX = box.x + 250;
    const sY = box.y + 180;
    const dX = 80;
    const dY = 60;

    await page.evaluate(
      ({ startX, startY, deltaX, deltaY }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 20,
            pointerType: 'pen',
            pressure: 0.7,
            button: 0,
            buttons: 1,
            clientX: startX,
            clientY: startY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 20,
            pointerType: 'pen',
            pressure: 0.8,
            button: 0,
            buttons: 1,
            clientX: startX + deltaX,
            clientY: startY + deltaY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 20,
            pointerType: 'pen',
            pressure: 0,
            button: 0,
            buttons: 0,
            clientX: startX + deltaX,
            clientY: startY + deltaY,
          }),
        );
      },
      { startX: sX, startY: sY, deltaX: dX, deltaY: dY },
    );

    const finalPos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['overlap-rect'];
      return { x: node?.x, y: node?.y };
    });

    expect(finalPos.x).toBe((initialPos.x ?? 0) + dX);
    expect(finalPos.y).toBe((initialPos.y ?? 0) + dY);
  });

  test('Criação de linha com caneta stylus (pointerType: pen) (INPUT-01)', async ({ page }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setTool('line');
    });

    const sX = box.x + 300;
    const sY = box.y + 300;
    const eX = box.x + 450;
    const eY = box.y + 380;

    await page.evaluate(
      ({ startX, startY, endXPos, endYPos }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 30,
            pointerType: 'pen',
            button: 0,
            buttons: 1,
            clientX: startX,
            clientY: startY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 30,
            pointerType: 'pen',
            button: 0,
            buttons: 1,
            clientX: endXPos,
            clientY: endYPos,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 30,
            pointerType: 'pen',
            button: 0,
            buttons: 0,
            clientX: endXPos,
            clientY: endYPos,
          }),
        );
      },
      { startX: sX, startY: sY, endXPos: eX, endYPos: eY },
    );

    const snapshot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const createdLine = Object.values(snapshot?.document.nodes ?? {}).find(
      (n) => n.type === 'line' && n.id !== 'diag-line',
    );

    expect(createdLine).toBeDefined();
    expect(createdLine?.start).toBeDefined();
    expect(createdLine?.end).toBeDefined();
  });

  test('Multitoque: segundo toque durante criação descarta preview sem criar shape (INPUT-05)', async ({
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

    const initialRevision = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });

    // 1º toque inicia criação
    await page.evaluate(
      ({ startX, startY, midX, midY }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 41,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: startX,
            clientY: startY,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 41,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: midX,
            clientY: midY,
          }),
        );
      },
      {
        startX: box.x + 200,
        startY: box.y + 200,
        midX: box.x + 260,
        midY: box.y + 260,
      },
    );

    const midState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
      };
    });
    expect(midState.state).toBe('creating');
    expect(midState.hasPreview).toBe(true);

    // 2º toque entra no canvas -> deve descartar o preview e cancelar a edição (INPUT-05)
    await page.evaluate(
      ({ touch2X, touch2Y }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 42,
            pointerType: 'touch',
            isPrimary: false,
            button: 0,
            buttons: 1,
            clientX: touch2X,
            clientY: touch2Y,
          }),
        );
      },
      { touch2X: box.x + 350, touch2Y: box.y + 200 },
    );

    const postTouch2State = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        state: g.__CANVASH_PLAYGROUND__?.interaction?.getState(),
        hasPreview: g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null,
        revision: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(postTouch2State.hasPreview).toBe(false);
    expect(postTouch2State.state).toBe('idle');
    // Nenhuma mutação de documento ocorreu
    expect(postTouch2State.revision).toBe(initialRevision);

    // Finaliza os toques
    await page.evaluate(() => {
      const g = globalThis as unknown as DOMGlobal;
      const el = g.document.getElementById('canvas-container');
      if (!el) return;

      el.dispatchEvent(
        new g.PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 41,
          pointerType: 'touch',
        }),
      );
      el.dispatchEvent(
        new g.PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
        }),
      );
    });

    const finalState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getState();
    });
    expect(finalState).toBe('idle');
  });

  test('Multitoque: gesto de pinch-zoom e pan simultâneos atualiza o viewport (INPUT-05)', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const initialViewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });
    expect(initialViewport).toBeDefined();
    if (!initialViewport) return;

    // 2 toques simultâneos:
    // Toque 1 em (100, 100), Toque 2 em (300, 100) -> distância inicial = 200, centro = (200, 100)
    // Depois afastam-se: Toque 1 em (50, 100), Toque 2 em (350, 100) -> distância final = 300
    // O zoom deve aumentar por 300 / 200 = 1.5x
    await page.evaluate(
      ({ bX, bY }) => {
        const g = globalThis as unknown as DOMGlobal;
        const el = g.document.getElementById('canvas-container');
        if (!el) return;

        // Pointerdown 1
        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 51,
            pointerType: 'touch',
            clientX: bX + 100,
            clientY: bY + 100,
          }),
        );

        // Pointerdown 2
        el.dispatchEvent(
          new g.PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 52,
            pointerType: 'touch',
            clientX: bX + 300,
            clientY: bY + 100,
          }),
        );

        // Move afastando os dedos
        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 51,
            pointerType: 'touch',
            clientX: bX + 50,
            clientY: bY + 100,
          }),
        );

        el.dispatchEvent(
          new g.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 52,
            pointerType: 'touch',
            clientX: bX + 350,
            clientY: bY + 100,
          }),
        );
      },
      { bX: box.x, bY: box.y },
    );

    const updatedViewport = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.viewport;
    });

    expect(updatedViewport).toBeDefined();
    if (!updatedViewport) return;

    // Zoom deve ter aumentado de 1.0 para ~1.5
    expect(updatedViewport.zoom).toBeGreaterThan(1.4);
    expect(updatedViewport.zoom).toBeLessThan(1.6);

    // Finaliza os toques
    await page.evaluate(() => {
      const g = globalThis as unknown as DOMGlobal;
      const el = g.document.getElementById('canvas-container');
      if (!el) return;

      el.dispatchEvent(
        new g.PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 51,
          pointerType: 'touch',
        }),
      );
      el.dispatchEvent(
        new g.PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 52,
          pointerType: 'touch',
        }),
      );
    });

    const finalState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.interaction?.getState();
    });
    expect(finalState).toBe('idle');
  });
});
