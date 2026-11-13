import { expect, test } from '@playwright/test';

interface NodeSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly text?: string;
  readonly rotation?: number;
}

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly dispatch: (command: unknown) => { ok: boolean };
      readonly undo: () => { ok: boolean };
      readonly redo: () => { ok: boolean };
      readonly getSnapshot: () => {
        readonly document: {
          readonly nodes: Record<string, NodeSnapshot>;
        };
        readonly session: {
          readonly viewport: {
            readonly x: number;
            readonly y: number;
            readonly zoom: number;
          };
          readonly activeTool: string;
          readonly selectedIds: readonly string[];
        };
        readonly history: {
          readonly canUndo: boolean;
          readonly canRedo: boolean;
        };
        readonly revision: number;
      };
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
    };
    readonly interaction?: {
      readonly cancel: () => void;
      readonly destroy: () => void;
      readonly getState: () => string;
    };
  };
}

test.describe('Editor de texto: Sessão em textarea sobre o canvas (Tarefa 43 - INPUT-06)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1) e ferramenta para select
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
    });
  });

  test('ferramenta de texto cria a caixa e abre textarea; confirmação gera 1 entrada de histórico', async ({
    page,
  }) => {
    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();

    // 1. Clica na ferramenta de texto
    const btnText = page.locator('#btn-tool-text');
    await btnText.click();

    const toolBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.activeTool;
    });
    expect(toolBefore).toBe('text');

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });

    // 2. Clica e arrasta no canvas para definir largura
    const startX = containerBox!.x + 150;
    const startY = containerBox!.y + 120;
    const endX = containerBox!.x + 350;
    const endY = containerBox!.y + 120;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    // 3. O textarea aparece sobre o canvas e está visível e focado
    const editorTextarea = page.locator('[data-testid="canvash-text-editor"]');
    await expect(editorTextarea).toBeVisible();

    // 4. Digita texto multilinha com caracteres acentuados
    await editorTextarea.fill('Canvash Texto Multilinha\nSegunda linha: ação e café');

    // 5. Confirma com Ctrl+Enter
    await page.keyboard.press('Control+Enter');

    // 6. Textarea deve fechar
    await expect(editorTextarea).not.toBeVisible();

    // 7. O nó de texto existe no canvas com exatamente 1 revisão adicionada
    const snapshot = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    expect(snapshot?.revision).toBe(revBefore! + 1);
    expect(snapshot?.session.activeTool).toBe('select');

    const selectedIds = snapshot?.session.selectedIds;
    expect(selectedIds?.length).toBe(1);

    const createdNode = snapshot?.document.nodes[selectedIds![0]!];
    expect(createdNode?.type).toBe('text');
    expect(createdNode?.text).toBe('Canvash Texto Multilinha\nSegunda linha: ação e café');
    expect(createdNode?.width).toBe(200); // 350 - 150
  });

  test('duplo clique em nó de texto abre textarea; blur confirma edição', async ({ page }) => {
    // 1. Cria nó de texto prévio via dispatch em camada visível
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-dblclick',
          type: 'text',
          x: 200,
          y: 200,
          width: 250,
          text: 'Texto Antes do Duplo Clique',
          fontSize: 18,
        },
      });
    });

    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();

    // 2. Duplo clique sobre as coordenadas do texto
    const clickX = containerBox!.x + 250;
    const clickY = containerBox!.y + 215;

    await page.mouse.dblclick(clickX, clickY);

    // 3. O textarea aparece aberto com o texto existente
    const editorTextarea = page.locator('[data-testid="canvash-text-editor"]');
    await expect(editorTextarea).toBeVisible();
    await expect(editorTextarea).toHaveValue('Texto Antes do Duplo Clique');

    // 4. Edita o texto
    await editorTextarea.fill('Texto Modificado com Sucesso');

    // 5. Clica fora (blur) para confirmar
    await page.mouse.click(containerBox!.x + 50, containerBox!.y + 50);

    // 6. Textarea fechou e texto foi atualizado no nó
    await expect(editorTextarea).not.toBeVisible();

    const textAfter = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-dblclick'];
      return node?.text;
    });
    expect(textAfter).toBe('Texto Modificado com Sucesso');

    // 7. Undo atômico restaura o texto original
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.undo();
    });

    const textReverted = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-dblclick'];
      return node?.text;
    });
    expect(textReverted).toBe('Texto Antes do Duplo Clique');
  });

  test('escape cancela a edição restaurando o texto original', async ({ page }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-escape',
          type: 'text',
          x: 250,
          y: 250,
          width: 200,
          text: 'Texto Seguro',
          fontSize: 16,
        },
      });
    });

    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();
    const clickX = containerBox!.x + 280;
    const clickY = containerBox!.y + 260;

    await page.mouse.dblclick(clickX, clickY);

    const editorTextarea = page.locator('[data-testid="canvash-text-editor"]');
    await expect(editorTextarea).toBeVisible();

    // Digita rascunho
    await editorTextarea.fill('Não quero salvar isso');

    // Pressiona Escape
    await page.keyboard.press('Escape');

    await expect(editorTextarea).not.toBeVisible();

    // Texto original preservado intacto
    const nodeText = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-escape'];
      return node?.text;
    });
    expect(nodeText).toBe('Texto Seguro');
  });

  test('textarea alinha perfeitamente com rotação e zoom do canvas', async ({ page }) => {
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      // Aplica zoom 1.5 e pan
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 50, y: 30, zoom: 1.5 });
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-rotated-e2e',
          type: 'text',
          x: 100,
          y: 100,
          width: 200,
          height: 50,
          rotation: 0.5, // ~28.6 graus
          text: 'Texto Inclinado',
          fontSize: 20,
        },
      });
    });

    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();

    // Ponto aproximado do texto com zoom 1.5 e pan:
    // cx = (100 + 100) * 1.5 + 50 = 350
    // cy = (100 + 25) * 1.5 + 30 = 217.5
    const clickX = containerBox!.x + 350;
    const clickY = containerBox!.y + 218;

    await page.mouse.dblclick(clickX, clickY);

    const editorTextarea = page.locator('[data-testid="canvash-text-editor"]');
    await expect(editorTextarea).toBeVisible();

    // Inspeciona estilo transform do textarea
    const transform = await editorTextarea.evaluate((el) => el.style.transform);
    expect(transform).toContain('rotate(0.5rad)');
    expect(transform).toContain('translate');

    // Font-size deve ser 20 * 1.5 = 30px
    const fontSize = await editorTextarea.evaluate((el) => el.style.fontSize);
    expect(fontSize).toBe('30px');

    await page.keyboard.press('Escape');
    await expect(editorTextarea).not.toBeVisible();
  });

  test('redimensionamento horizontal refaz layout e recalcula altura no canvas (Tarefa 44)', async ({
    page,
  }) => {
    // 1. Cria nó de texto largo
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-resize-e2e',
          type: 'text',
          x: 100,
          y: 100,
          width: 300,
          text: 'Primeira palavra segunda palavra terceira palavra quarta palavra quinta palavra',
          fontSize: 16,
        },
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['text-resize-e2e']);
    });

    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();

    const heightBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node =
        g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-resize-e2e'];
      return node?.height;
    });

    // 2. O handle 'e' está em x = 400 (100 + 300), y = 100 + height/2
    const handleX = containerBox!.x + 400;
    const handleY = containerBox!.y + 100 + (heightBefore ?? 24) / 2;

    // 3. Arrasta o handle 'e' para a esquerda (x=220) para reduzir a largura a 120px
    await page.mouse.move(handleX, handleY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(containerBox!.x + 220, handleY);
    await page.mouse.up({ button: 'left' });

    // 4. Verifica que a largura diminuiu e a altura aumentou por conta do reflow
    const { widthAfter, heightAfter, fontSizeAfter } = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node =
        g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-resize-e2e'];
      return {
        widthAfter: node?.width,
        heightAfter: node?.height,
        fontSizeAfter: (node as { fontSize?: number })?.fontSize,
      };
    });

    expect(widthAfter).toBe(120);
    expect(heightAfter).toBeGreaterThan(heightBefore!);
    expect(fontSizeAfter).toBe(16); // fontSize inalterado
  });

  test('escala uniforme de canto ajusta caixa e tamanho da fonte (Tarefa 44)', async ({ page }) => {
    // 1. Cria nó de texto
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.dispatch({
        type: 'shape.create',
        layerId: 'layer-middle',
        shape: {
          id: 'text-scale-e2e',
          type: 'text',
          x: 100,
          y: 100,
          width: 150,
          height: 30,
          text: 'Texto para Escala',
          fontSize: 16,
        },
      });
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['text-scale-e2e']);
    });

    const container = page.locator('#canvas-container');
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();

    // 2. Handle 'se' está em x = 250 (100 + 150), y = 130 (100 + 30)
    const handleX = containerBox!.x + 250;
    const handleY = containerBox!.y + 130;

    // 3. Arrasta o handle 'se' para dobrar a escala (x = 400, y = 160 -> scale = 2)
    await page.mouse.move(handleX, handleY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(containerBox!.x + 400, containerBox!.y + 160);
    await page.mouse.up({ button: 'left' });

    // 4. Verifica que largura, altura e fontSize escalaram proporcionalmente
    const { widthAfter, heightAfter, fontSizeAfter } = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['text-scale-e2e'];
      return {
        widthAfter: node?.width,
        heightAfter: node?.height,
        fontSizeAfter: (node as { fontSize?: number })?.fontSize,
      };
    });

    expect(widthAfter).toBe(300); // 150 * 2
    expect(heightAfter).toBe(60); // 30 * 2
    expect(fontSizeAfter).toBe(32); // 16 * 2
  });
});
