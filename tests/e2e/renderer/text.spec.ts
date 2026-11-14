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

test.describe('Renderização de Texto no Canvas 2D (Tarefa 42 - RENDER-03)', () => {
  test('renderiza nó de texto com métricas e quebra de linha', async ({ page }) => {
    await waitForPlayground(page);

    // Cria nó de texto no canvas em camada visível
    const created = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-node-e2e',
          type: 'text',
          x: 100,
          y: 100,
          width: 300,
          text: 'Canvash\nTexto Multilinha E2E',
          fontSize: 20,
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textAlign: 'center',
          lineHeight: 1.5,
          style: {
            fill: '#0066cc',
            stroke: null,
            strokeWidth: 0,
            opacity: 1,
          },
        },
      });
    });

    expect(created.ok).toBe(true);

    // Aguarda frame de renderização
    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const metrics = g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
      return metrics.renderedItemsCount === 5;
    });

    const metrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });

    expect(metrics.renderedItemsCount).toBe(5);
  });

  test('aplica culling estrito: texto fora da viewport não é renderizado', async ({ page }) => {
    await waitForPlayground(page);

    // Contagem inicial de itens na origem (4 itens visíveis na fixture)
    const initialMetrics = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(initialMetrics.renderedItemsCount).toBe(4);

    // Insere texto bem longe da viewport atual (em 20000, 20000) em camada visível
    const created = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-far',
          type: 'text',
          x: 20000,
          y: 20000,
          width: 200,
          text: 'Texto Longe',
          fontSize: 16,
          style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });
    });
    expect(created.ok).toBe(true);

    await page.waitForTimeout(100);

    // Com viewport em (0, 0), o texto em (20000, 20000) é descartado pelo culling; a contagem não aumentou
    const metricsAway = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(metricsAway.renderedItemsCount).toBe(4);

    // Agora navega a viewport exatamente para cima do texto em (20000, 20000)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      section.setViewport({ x: -20000, y: -20000, zoom: 1 });
    });

    // O frame novo chega quando o navegador pintar: espera a contagem chegar a 1, em vez de um
    // tempo fixo, que no webkit sob carga lia o frame antigo.
    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics().renderedItemsCount === 1;
    });

    // As formas da origem agora estão culled; apenas o texto em (20000, 20000) é renderizado
    const metricsNear = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics();
    });
    expect(metricsNear.renderedItemsCount).toBe(1);
  });

  test('renderiza texto com rotação e alinhamento', async ({ page }) => {
    await waitForPlayground(page);

    const res = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const section = g.__CANVASH_PLAYGROUND__!.section;
      return section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-rotated',
          type: 'text',
          x: 150,
          y: 150,
          width: 200,
          height: 60,
          rotation: Math.PI / 4,
          text: 'Texto Inclinado',
          fontSize: 18,
          textAlign: 'right',
          style: { fill: '#ff0055', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      });
    });

    expect(res.ok).toBe(true);

    await page.waitForFunction(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__!.handle.getMetrics().renderedItemsCount === 5;
    });
  });
});
