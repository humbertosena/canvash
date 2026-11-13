import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground } from '../helpers/shell.js';

interface SemanticSummary {
  nodeCount: number;
  shapes: Array<{
    type: string;
    width: number;
    height: number;
  }>;
  layerCount: number;
  revision: number;
}

async function runParityScript(page: Page, url: string): Promise<SemanticSummary> {
  await page.goto(url);
  await page.waitForSelector('canvas-surface');

  // Aguarda que o elemento e o shadow dom estejam prontos
  await page.waitForFunction(() => {
    const el = document.querySelector('canvas-surface');
    return el !== null && el.shadowRoot !== null;
  });

  // 1. Clica no botão de adicionar retângulo
  await clickInPlayground(page, '#btn-add-rect');

  // 2. Aguarda atualização e confere presença do canvas renderizado
  await page.waitForFunction(() => {
    const el = document.querySelector('canvas-surface');
    const canvas = el?.shadowRoot?.querySelector('canvas');
    return canvas !== null && canvas !== undefined;
  });

  // 3. Alterna o modo readOnly
  await clickInPlayground(page, '#btn-toggle-readonly');

  // 4. Extrai snapshot semântico via elemento canvas-surface
  const summary = await page.evaluate(() => {
    const el = document.querySelector('canvas-surface') as HTMLElement & {
      section?: {
        getSnapshot: () => {
          document: {
            nodes: Record<string, { type: string; width?: number; height?: number }>;
            layers: unknown[];
          };
          revision: number;
        };
      };
    };

    const snap = el.section?.getSnapshot();
    if (!snap) {
      throw new Error('Canvas snapshot não disponível no elemento');
    }

    const nodes = Object.values(snap.document.nodes);
    return {
      nodeCount: nodes.length,
      shapes: nodes.map((n) => ({
        type: n.type,
        width: n.width ?? 0,
        height: n.height ?? 0,
      })),
      layerCount: snap.document.layers.length,
      revision: snap.revision,
    };
  });

  return summary;
}

test.describe('Paridade entre Implementações: Vanilla vs React vs Vue (ADAPTER-01, ADAPTER-02)', () => {
  test('executa o mesmo roteiro nas três implementações e valida igualdade semântica', async ({
    page,
  }) => {
    // 1. Executa no Vanilla Web Components
    const vanillaSummary = await runParityScript(page, EXAMPLE_URLS.wc);

    // 2. Executa no React Adapter
    const reactSummary = await runParityScript(page, EXAMPLE_URLS.react);

    // 3. Executa no Vue Adapter
    const vueSummary = await runParityScript(page, EXAMPLE_URLS.vue);

    // Validação de paridade estrita
    expect(vanillaSummary.nodeCount).toBe(1);
    expect(reactSummary.nodeCount).toBe(1);
    expect(vueSummary.nodeCount).toBe(1);

    expect(vanillaSummary.shapes).toEqual([{ type: 'rectangle', width: 150, height: 100 }]);
    expect(reactSummary.shapes).toEqual(vanillaSummary.shapes);
    expect(vueSummary.shapes).toEqual(vanillaSummary.shapes);

    expect(vanillaSummary.layerCount).toBe(1);
    expect(reactSummary.layerCount).toBe(1);
    expect(vueSummary.layerCount).toBe(1);

    expect(vanillaSummary.revision).toBe(1);
    expect(reactSummary.revision).toBe(1);
    expect(vueSummary.revision).toBe(1);
  });
});
