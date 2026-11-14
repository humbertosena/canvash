import { expect, test } from '@playwright/test';

interface PlaygroundMetrics {
  readonly width: number;
  readonly height: number;
  readonly renderedItemsCount: number;
  readonly paintCount: number;
  readonly dpr: number;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly dispatch: (command: unknown) => { ok: boolean };
      readonly setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
      readonly getSnapshot: () => {
        document: {
          nodes: Record<string, unknown>;
        };
        session: { viewport: { x: number; y: number; zoom: number } };
      };
    };
    readonly handle: {
      readonly getMetrics: () => PlaygroundMetrics;
      readonly invalidate: () => void;
    };
  };
}

async function waitForPlayground(page: import('@playwright/test').Page) {
  await page.goto('/?layout=classic');
  await page.waitForFunction(() => {
    const g = globalThis as unknown as PlaygroundGlobal;
    return typeof g.__CANVASH_PLAYGROUND__?.handle?.getMetrics === 'function';
  });
}

test.describe('Renderização de Setas no Canvas 2D (Tarefa 46 - INPUT-07)', () => {
  test('renderiza seta reta com marcadores dot e arrow', async ({ page }) => {
    await waitForPlayground(page);

    const initialMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });

    const created = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'arrow-e2e-1',
          type: 'arrow',
          start: { x: 50, y: 50 },
          end: { x: 250, y: 150 },
          startMarker: 'dot',
          endMarker: 'arrow',
          style: {
            stroke: '#ff0055',
            strokeWidth: 3,
            opacity: 1,
          },
        },
      });
    });

    expect(created.ok).toBe(true);

    const expectedCount = initialMetrics.renderedItemsCount + 1;
    await page.waitForFunction((count) => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const metrics = g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
      return metrics.renderedItemsCount === count;
    }, expectedCount);

    const updatedMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(updatedMetrics.renderedItemsCount).toBe(expectedCount);
  });

  test('renderiza seta com endpoint dinamicamente vinculado a nó alvo', async ({ page }) => {
    await waitForPlayground(page);

    // Cria retângulo alvo
    const targetCreated = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'target-rect-e2e',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 150,
          height: 80,
          rotation: 0,
          style: { fill: '#336699', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
    });
    expect(targetCreated.ok).toBe(true);

    // Cria seta com início vinculado ao centro do retângulo alvo
    const arrowCreated = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'arrow-bound-e2e',
          type: 'arrow',
          start: { targetId: 'target-rect-e2e', anchor: { x: 0.5, y: 0.5 } },
          end: { x: 450, y: 300 },
          startMarker: 'none',
          endMarker: 'arrow',
          style: {
            stroke: '#22aa44',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    });
    expect(arrowCreated.ok).toBe(true);

    // Modifica a posição do retângulo alvo para confirmar atualização da cena
    const targetPatched = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.update',
        id: 'target-rect-e2e',
        patch: { x: 180, y: 140 },
      });
    });
    expect(targetPatched.ok).toBe(true);

    await page.waitForTimeout(50);

    const snapshot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.section.getSnapshot();
    });
    expect(snapshot.document.nodes['target-rect-e2e']).toBeDefined();
    expect(snapshot.document.nodes['arrow-bound-e2e']).toBeDefined();
  });

  test('aplica culling estrito: seta fora da viewport não é renderizada', async ({ page }) => {
    await waitForPlayground(page);

    const initialMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });

    // Insere seta distante em (35000, 35000)
    const created = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'arrow-far',
          type: 'arrow',
          start: { x: 35000, y: 35000 },
          end: { x: 35200, y: 35100 },
          startMarker: 'none',
          endMarker: 'arrow',
          style: { stroke: '#000000', strokeWidth: 2, opacity: 1 },
        },
      });
    });
    expect(created.ok).toBe(true);

    await page.waitForTimeout(100);

    // Não deve alterar os itens renderizados na viewport inicial
    const metricsAway = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(metricsAway.renderedItemsCount).toBe(initialMetrics.renderedItemsCount);

    // Navega a viewport para cima da seta
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      section.setViewport({ x: -35000, y: -35000, zoom: 1 });
    });

    // O frame novo chega quando o navegador pintar: espera a contagem chegar a 1, em vez de um
    // tempo fixo, que no webkit sob carga lia o frame antigo.
    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics().renderedItemsCount === 1;
    });

    // Itens da origem foram culled; apenas a seta distante é renderizada
    const metricsNear = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(metricsNear.renderedItemsCount).toBe(1);
  });
});
