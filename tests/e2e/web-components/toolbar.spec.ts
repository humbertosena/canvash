/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { EXAMPLE_URLS } from '../helpers/canvas.js';
import { clickInPlayground, useClassicToolbar } from '../helpers/shell.js';

interface TestCanvasSection {
  getSnapshot: () => {
    document: { nodes: Record<string, unknown> };
    session: {
      selectedIds: readonly string[];
      activeTool: string;
      viewport: { x: number; y: number; zoom: number };
    };
    history: {
      canUndo: boolean;
      canRedo: boolean;
    };
    revision: number;
  };
  dispatch: (cmd: unknown) => { ok: boolean };
  setTool: (tool: string) => { ok: boolean };
  undo: () => { ok: boolean };
  redo: () => { ok: boolean };
}

interface WcGlobal {
  __CANVASH_WC__?: {
    canvas: {
      section?: TestCanvasSection;
    };
    toolbar?: {
      section?: TestCanvasSection;
    };
    createCanvasSection: () => TestCanvasSection;
  };
}

test.describe('Web Components: <canvas-toolbar> (Tarefa 57 - WC-02)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URLS.wc);
    await page.waitForSelector('canvas-surface');
    await page.waitForSelector('canvas-toolbar');
    await page.waitForFunction(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.toolbar?.section !== undefined;
    });
    await useClassicToolbar(page);
  });

  test('seleciona ferramentas e reflete aria-pressed na toolbar (WC-02)', async ({ page }) => {
    const toolbar = page.locator('canvas-toolbar');

    // Botão retângulo na shadow DOM da toolbar
    // O clique também abre a ilha, que tem um item `rectangle`: o botão do grupo é o primeiro.
    const rectBtn = toolbar.locator('button[data-tool="rectangle"]').first();
    await rectBtn.click();

    // Confere atributo reativo aria-pressed
    await expect(rectBtn).toHaveAttribute('aria-pressed', 'true');

    // Confere ferramenta ativa no canvas
    const activeTool = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.activeTool;
    });
    expect(activeTool).toBe('rectangle');

    // O clique no retângulo também fixou a ilha: fecha, para o clique seguinte abri-la de novo.
    await page.keyboard.press('Escape');

    // Alterna para ferramenta elipse
    // A elipse mora no menu "Formas": abre o menu e escolhe o item. Depois, o botão principal
    // mostra a elipse.
    const ellipseBtn = toolbar.locator('button[data-tool="ellipse"]');
    await toolbar.locator('[data-action="open-shapes"]').click();
    await toolbar.locator('[role="menuitemradio"][data-tool="ellipse"]').click();
    await expect(ellipseBtn).toHaveAttribute('aria-pressed', 'true');
    // O host pode atribuir a última forma: devolve o retângulo ao botão principal, agora sem
    // estar ativo.
    await toolbar.evaluate((el) => {
      (el as unknown as { lastShape: string }).lastShape = 'rectangle';
    });
    await expect(rectBtn).toHaveAttribute('aria-pressed', 'false');

    const activeTool2 = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.activeTool;
    });
    expect(activeTool2).toBe('ellipse');
  });

  test('botão mão vem após a seleção, tem ícone SVG e faz pan no canvas', async ({ page }) => {
    const toolbar = page.locator('canvas-toolbar');
    const tools = toolbar.locator('button[data-tool]');
    await expect(tools.nth(0)).toHaveAttribute('data-tool', 'select');
    await expect(tools.nth(1)).toHaveAttribute('data-tool', 'hand');

    const handBtn = toolbar.locator('button[data-tool="hand"]');
    await expect(handBtn).toHaveAttribute('aria-label', 'Mão');
    await expect(handBtn).toHaveAttribute('part', 'tool-button tool-hand');

    // Todo botão de ferramenta desenha um ícone SVG visível, sem texto próprio.
    const count = await tools.count();
    for (let i = 0; i < count; i++) {
      const icon = tools.nth(i).locator('svg[aria-hidden="true"]');
      await expect(icon).toBeVisible();
      await expect(tools.nth(i)).toHaveText('');
    }

    await handBtn.click();
    await expect(handBtn).toHaveAttribute('aria-pressed', 'true');

    const box = await page.locator('canvas-surface').boundingBox();
    if (!box) throw new Error('canvas-surface sem caixa');
    const before = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      const snapshot = g.__CANVASH_WC__?.canvas.section?.getSnapshot();
      return { ...snapshot?.session.viewport, nodes: Object.keys(snapshot?.document.nodes ?? {}) };
    });
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 4 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return g.__CANVASH_WC__?.canvas.section?.getSnapshot();
    });
    expect(after?.session.activeTool).toBe('hand');
    expect(after?.session.viewport.x).toBeCloseTo((before?.x ?? 0) + 60, 0);
    expect(after?.session.viewport.y).toBeCloseTo((before?.y ?? 0) + 40, 0);
    // O pan não cria nem move figuras.
    expect(Object.keys(after?.document.nodes ?? {})).toEqual(before.nodes);
  });

  test('aciona undo e redo através dos botões da toolbar (WC-02)', async ({ page }) => {
    const toolbar = page.locator('canvas-toolbar');
    const undoBtn = toolbar.locator('button[part*="action-undo"]');
    const redoBtn = toolbar.locator('button[part*="action-redo"]');

    // Inicialmente sem histórico: undo e redo desabilitados
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Cria uma forma clicando no botão do exemplo
    await clickInPlayground(page, '#btn-add-rect');

    // Agora undo deve estar habilitado
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();

    // Clica em undo na toolbar
    await undoBtn.click();

    // Documento deve ter nó desfeito e redo deve estar habilitado
    await expect(redoBtn).toBeEnabled();
    const nodeCountAfterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return Object.keys(g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {})
        .length;
    });
    expect(nodeCountAfterUndo).toBe(0);

    // Clica em redo na toolbar
    await redoBtn.click();
    await expect(redoBtn).toBeDisabled();
    await expect(undoBtn).toBeEnabled();

    const nodeCountAfterRedo = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal;
      return Object.keys(g.__CANVASH_WC__?.canvas.section?.getSnapshot().document.nodes ?? {})
        .length;
    });
    expect(nodeCountAfterRedo).toBe(1);
  });

  test('controles de zoom na toolbar alteram viewport (WC-02)', async ({ page }) => {
    const toolbar = page.locator('canvas-toolbar');
    const zoomInBtn = toolbar.locator('button[data-action="zoom-in"]');
    const zoomOutBtn = toolbar.locator('button[data-action="zoom-out"]');
    const zoomIndicator = toolbar.locator('button[data-action="zoom-reset"]');

    await expect(zoomIndicator).toHaveText('100%');

    // Clica no zoom-in
    await zoomInBtn.click();
    await expect(zoomIndicator).toHaveText('120%');

    // Clica no zoom-out
    await zoomOutBtn.click();
    await expect(zoomIndicator).toHaveText('100%');

    // Mais zoom-in e depois reset
    await zoomInBtn.click();
    await zoomInBtn.click();
    await expect(zoomIndicator).toHaveText('144%');

    // Clica no indicador para redefinir para 100%
    await zoomIndicator.click();
    await expect(zoomIndicator).toHaveText('100%');
  });

  test('dois canvas e duas toolbars funcionam de forma 100% isolada (WC-02)', async ({ page }) => {
    // Monta um segundo conjunto (Canvas B + Toolbar B) na mesma página
    await page.evaluate(async () => {
      const g = globalThis as unknown as WcGlobal & {
        __sectionB?: TestCanvasSection;
      };
      const sectionB = g.__CANVASH_WC__!.createCanvasSection();
      g.__sectionB = sectionB;

      const container = document.createElement('div');
      container.id = 'suite-b';
      container.style.cssText =
        'position: absolute; bottom: 0; left: 0; width: 300px; height: 200px;';

      const toolbarB = document.createElement('canvas-toolbar') as HTMLElement & {
        section: unknown;
        id: string;
      };
      toolbarB.id = 'toolbar-b';
      toolbarB.section = sectionB;

      const canvasB = document.createElement('canvas-surface') as HTMLElement & {
        section: unknown;
        id: string;
      };
      canvasB.id = 'canvas-b';
      canvasB.section = sectionB;

      container.appendChild(toolbarB);
      container.appendChild(canvasB);
      document.body.appendChild(container);
    });

    const toolbarA = page.locator('#wc-toolbar');
    const toolbarB = page.locator('#toolbar-b');

    // 1. Altera ferramenta na Toolbar A para 'rectangle'
    await toolbarA.locator('button[data-tool="rectangle"]').click();
    // O clique abriu a ilha de figuras de A; fechada, o botão do grupo volta a ser o único.
    await page.keyboard.press('Escape');

    // 2. Confere isolamento: Canvas A é 'rectangle', Canvas B permanece 'select'
    const tools = await page.evaluate(() => {
      const g = globalThis as unknown as WcGlobal & { __sectionB?: TestCanvasSection };
      return {
        toolA: g.__CANVASH_WC__?.canvas.section?.getSnapshot().session.activeTool,
        toolB: g.__sectionB?.getSnapshot().session.activeTool,
      };
    });
    expect(tools.toolA).toBe('rectangle');
    expect(tools.toolB).toBe('select');

    // 3. Toolbar B indica select como ativo, enquanto Toolbar A indica rectangle
    await expect(toolbarA.locator('button[data-tool="rectangle"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(toolbarB.locator('button[data-tool="select"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(toolbarB.locator('button[data-tool="rectangle"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // 4. Zoom na Toolbar A não afeta Toolbar B
    await toolbarA.locator('button[data-action="zoom-in"]').click();
    await expect(toolbarA.locator('button[data-action="zoom-reset"]')).toHaveText('120%');
    await expect(toolbarB.locator('button[data-action="zoom-reset"]')).toHaveText('100%');

    // 5. Histórico e undo isolados: cria forma em canvas B
    await page.evaluate(() => {
      const g = globalThis as unknown as { __sectionB?: TestCanvasSection };
      g.__sectionB?.dispatch({
        type: 'shape.create',
        shape: {
          id: 'b-shape',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 30,
          height: 30,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      });
    });

    // Toolbar B deve ter undo habilitado, Toolbar A deve continuar desabilitado (se canvas A não tiver histórico)
    await expect(toolbarB.locator('button[part*="action-undo"]')).toBeEnabled();
    await expect(toolbarA.locator('button[part*="action-undo"]')).toBeDisabled();
  });
});
