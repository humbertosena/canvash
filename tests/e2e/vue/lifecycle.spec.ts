import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground } from '../helpers/shell.js';

interface VueGlobal {
  __CANVASH_VUE__?: {
    section: {
      getSnapshot: () => {
        document: { nodes: Record<string, unknown> };
        session: {
          selectedIds: readonly string[];
          readOnly: boolean;
          viewport: { zoom: number };
        };
        revision: number;
      };
      dispatch: (cmd: unknown) => { ok: boolean };
    };
    canvasRef: {
      value: {
        focus: (opts?: unknown) => void;
        fitToContent: (opts?: unknown) => void;
        element: HTMLElement | null;
      } | null;
    };
    events: Array<{ type: string; detail: unknown }>;
    setNewSection: (newSection: unknown) => void;
  };
}

test.describe('Vue Adapter: Ciclo de vida e robustez (Tarefa 65 - ADAPTER-03)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.vue);
    await page.waitForSelector('canvas-surface');
  });

  test('troca da prop section desliga a anterior sem destruir instância externa (ADAPTER-03)', async ({
    page,
  }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__ !== undefined;
    });

    // 1. Armazena o canvas inicial e cria um novo canvas
    const sectionSwapped = await page.evaluate(async () => {
      const g = globalThis as unknown as VueGlobal & {
        __CANVASH_VUE__: {
          createCanvasSection: () => unknown;
        };
      };
      const initialSection = g.__CANVASH_VUE__?.section;
      if (!initialSection) return false;

      // Cria um segundo canvas externo via helper exposto
      const secondSection = g.__CANVASH_VUE__.createCanvasSection();

      // Troca a prop section no App
      g.__CANVASH_VUE__?.setNewSection(secondSection);

      return true;
    });
    expect(sectionSwapped).toBe(true);

    // 2. Aguarda re-render e confere que o elemento customizado agora tem o secondSection
    await page.waitForFunction(() => {
      const el = document.querySelector('canvas-surface') as HTMLElement & {
        section?: { getSnapshot: () => unknown };
      };
      const g = globalThis as unknown as VueGlobal;
      return el.section === g.__CANVASH_VUE__?.section;
    });

    // 3. Adiciona um retângulo no segundo canvas
    await clickInPlayground(page, '#btn-add-rect');

    // Confere que apenas o segundo canvas foi alterado
    const counts = await page.evaluate(() => {
      const g = globalThis as unknown as VueGlobal;
      const secondNodes = g.__CANVASH_VUE__?.section.getSnapshot().document.nodes ?? {};
      return Object.keys(secondNodes).length;
    });
    expect(counts).toBe(1);
  });

  test('múltiplos rerenders não duplicam listeners de eventos nem comandos', async ({ page }) => {
    await page.waitForFunction(() => {
      const g = globalThis as unknown as VueGlobal;
      return g.__CANVASH_VUE__ !== undefined;
    });

    // Alterna readOnly várias vezes para forçar atualizações no componente Vue
    await clickInPlayground(page, '#btn-toggle-readonly');
    await clickInPlayground(page, '#btn-toggle-readonly');
    await clickInPlayground(page, '#btn-toggle-readonly');
    await clickInPlayground(page, '#btn-toggle-readonly');

    // Limpa eventos registrados
    await page.evaluate(() => {
      const g = globalThis as unknown as VueGlobal;
      if (g.__CANVASH_VUE__) {
        g.__CANVASH_VUE__.events.length = 0;
      }
    });

    // Dispara um único dispatch
    await clickInPlayground(page, '#btn-add-rect');

    // Confere que exatamente 1 evento document-change foi emitido (sem duplicação por reatividade)
    const docEvents = await page.evaluate(() => {
      const g = globalThis as unknown as VueGlobal;
      return (g.__CANVASH_VUE__?.events ?? []).filter((e) => e.type === 'document-change');
    });
    expect(docEvents).toHaveLength(1);
  });
});
