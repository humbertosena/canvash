import { expect, test } from '@playwright/test';

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
              readonly start?: { readonly x: number; readonly y: number };
              readonly end?: { readonly x: number; readonly y: number };
            }
          >;
        };
      };
      readonly getPreview: () => {
        readonly updates?: Record<string, Record<string, unknown>>;
      } | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly undo: () => { ok: boolean };
    };
  };
}

test.describe('Interação: Resize de Shape Única (Tarefa 34 - INPUT-02, INPUT-04)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta select e desmarca seleção
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('redimensiona handle se com âncora nw fixa, atualiza preview em tempo real e comita 1 vez (INPUT-02)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect (x: 50, y: 50, width: 300, height: 200, rotation: 0)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    // Handle se está em (50 + 300, 50 + 200) = (350, 250)
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();

    // Arrasta para (400, 300) com passos intermediários
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(box.x + 350 + i * 10, box.y + 250 + i * 10);
    }

    // Enquanto arrasta: preview ativo, documento original inalterado
    const previewState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      const rev = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
      return {
        hasPreview: preview?.updates !== undefined && 'bg-rect' in (preview.updates ?? {}),
        previewW: (preview?.updates?.['bg-rect'] as { width?: number })?.width,
        previewH: (preview?.updates?.['bg-rect'] as { height?: number })?.height,
        docW: node?.width,
        docH: node?.height,
        rev,
      };
    });

    expect(previewState.hasPreview).toBe(true);
    expect(previewState.previewW).toBeCloseTo(350, 0); // 300 + 50
    expect(previewState.previewH).toBeCloseTo(250, 0); // 200 + 50
    expect(previewState.docW).toBe(300); // documento intacto
    expect(previewState.docH).toBe(200);
    expect(previewState.rev).toBe(revBefore);

    // Finaliza gesto no pointerup
    await page.mouse.up();

    const afterCommit = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      const rev = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
      return {
        preview,
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        rev,
      };
    });

    expect(afterCommit.preview).toBeNull();
    // Âncora oposta nw permaneceu fixa em (50, 50)
    expect(afterCommit.x).toBeCloseTo(50, 0);
    expect(afterCommit.y).toBeCloseTo(50, 0);
    expect(afterCommit.width).toBeCloseTo(350, 0);
    expect(afterCommit.height).toBeCloseTo(250, 0);
    expect(afterCommit.rev).toBe(revBefore + 1); // exatamente 1 commit
  });

  test('redimensionamento com Shift preserva proporção original', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    // Pressiona Shift e arrasta handle se
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 350);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const result = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        width: node?.width ?? 0,
        height: node?.height ?? 0,
      };
    });

    // Proporção original: 300 / 200 = 1.5
    expect(result.width / result.height).toBeCloseTo(1.5, 3);
  });

  test('cruzar a âncora fixa limita no mínimo de 1 unidade sem flip', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    // Arrasta handle se (350, 250) para bem antes de nw (50, 50), em (10, 10)
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
      };
    });

    // Sem flip: dimensões limitadas em 1 unidade e âncora nw intacta em (50, 50)
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  test('desfazer restaura a dimensão original em 1 passo e Escape cancela sem histórico', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    // 1. Testa cancelamento com Escape
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const afterEscape = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return {
        rev: snap?.revision,
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        width: snap?.document.nodes['bg-rect']?.width,
      };
    });

    expect(afterEscape.preview).toBeNull();
    expect(afterEscape.rev).toBe(revBefore);
    expect(afterEscape.width).toBe(300);

    // 2. Realiza alteração confirmada e desfaz com undo (INPUT-04)
    await page.mouse.move(box.x + 350, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 270);
    await page.mouse.up();

    // Executa undo
    const undoRes = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.undo().ok ?? false;
    });
    expect(undoRes).toBe(true);

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['bg-rect'];
      return {
        width: node?.width,
        height: node?.height,
      };
    });

    expect(afterUndo.width).toBe(300);
    expect(afterUndo.height).toBe(200);
  });

  test('redimensiona endpoint de linha preservando o endpoint oposto fixo', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona diag-line (start: 40, 40; end: 360, 260)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['diag-line']);
    });

    // Endpoint end está em (360, 260). Arrasta para (400, 300)
    await page.mouse.move(box.x + 360, box.y + 260);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.up();

    const afterLineMove = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const line = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['diag-line'];
      return {
        start: line?.start,
        end: line?.end,
      };
    });

    // Start permaneceu intacto em (40, 40) e end foi atualizado
    expect(afterLineMove.start).toEqual({ x: 40, y: 40 });
    expect(afterLineMove.end?.x).toBeCloseTo(400, 0);
    expect(afterLineMove.end?.y).toBeCloseTo(300, 0);
  });
});
