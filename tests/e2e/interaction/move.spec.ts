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
              readonly locked?: boolean;
            }
          >;
        };
      };
      readonly getPreview: () => {
        readonly updates?: Record<string, Record<string, unknown>>;
        readonly marquee?: unknown;
      } | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
      readonly undo: () => { ok: boolean };
    };
  };
}

test.describe('Interação: Mover Seleção (Tarefa 33 - INPUT-02, INPUT-04)', () => {
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

  test('arrasto de shape selecionado atualiza preview em tempo real e consolida em commit único no pointerup (INPUT-02)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona 'overlap-rect' (posição original x: 180, y: 120, width: 220, height: 160)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    // Ponto de início sobre overlap-rect: (250, 180)
    await page.mouse.move(box.x + 250, box.y + 180);
    await page.mouse.down();

    // Arrasta 60px para a direita e 40px para baixo com passos discretos
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(box.x + 250 + i * 15, box.y + 180 + i * 10);
    }

    // Durante o arrasto: preview ativo e documento original NÃO mutado
    const previewState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['overlap-rect'];
      const rev = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
      return {
        hasPreview: preview?.updates !== undefined && 'overlap-rect' in (preview.updates ?? {}),
        previewX: (preview?.updates?.['overlap-rect'] as { x?: number })?.x,
        previewY: (preview?.updates?.['overlap-rect'] as { y?: number })?.y,
        docX: node?.x,
        docY: node?.y,
        rev,
      };
    });

    expect(previewState.hasPreview).toBe(true);
    expect(previewState.previewX).toBe(240); // 180 + 60
    expect(previewState.previewY).toBe(160); // 120 + 40
    expect(previewState.docX).toBe(180); // intacto
    expect(previewState.docY).toBe(120); // intacto
    expect(previewState.rev).toBe(revBefore); // sem commits intermediários (INPUT-02)

    // Solta o botão do mouse para finalizar o movimento
    await page.mouse.up();

    // Após soltar: preview limpo, documento comitado exatamente 1 vez
    const afterCommit = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const node = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().document.nodes['overlap-rect'];
      const rev = g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
      return {
        preview,
        docX: node?.x,
        docY: node?.y,
        rev,
      };
    });

    expect(afterCommit.preview).toBeNull();
    expect(afterCommit.docX).toBe(240);
    expect(afterCommit.docY).toBe(160);
    expect(afterCommit.rev).toBe(revBefore + 1); // commit atômico único
  });

  test('arrasto de múltiplos shapes preserva posições relativas e desfaz em 1 passo de undo (INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona dois shapes: bg-rect (50, 50) e overlap-rect (180, 120)
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect', 'overlap-rect']);
    });

    const initial = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const bg = snap?.document.nodes['bg-rect'];
      const ov = snap?.document.nodes['overlap-rect'];
      return {
        bgX: bg?.x ?? 0,
        bgY: bg?.y ?? 0,
        ovX: ov?.x ?? 0,
        ovY: ov?.y ?? 0,
        relDx: (ov?.x ?? 0) - (bg?.x ?? 0),
        relDy: (ov?.y ?? 0) - (bg?.y ?? 0),
        rev: snap?.revision ?? 0,
      };
    });

    // Pressiona sobre overlap-rect (x: 250, y: 180) e arrasta (+50, -30)
    await page.mouse.move(box.x + 250, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 150);
    await page.mouse.up();

    const afterMove = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const bg = snap?.document.nodes['bg-rect'];
      const ov = snap?.document.nodes['overlap-rect'];
      return {
        bgX: bg?.x ?? 0,
        bgY: bg?.y ?? 0,
        ovX: ov?.x ?? 0,
        ovY: ov?.y ?? 0,
        relDx: (ov?.x ?? 0) - (bg?.x ?? 0),
        relDy: (ov?.y ?? 0) - (bg?.y ?? 0),
        rev: snap?.revision ?? 0,
      };
    });

    expect(afterMove.bgX).toBe(initial.bgX + 50);
    expect(afterMove.bgY).toBe(initial.bgY - 30);
    expect(afterMove.ovX).toBe(initial.ovX + 50);
    expect(afterMove.ovY).toBe(initial.ovY - 30);
    // Preservação estrita das posições relativas (INPUT-04)
    expect(afterMove.relDx).toBe(initial.relDx);
    expect(afterMove.relDy).toBe(initial.relDy);
    expect(afterMove.rev).toBe(initial.rev + 1);

    // Desfaz via undo em 1 passo único
    const undoSuccess = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.undo().ok ?? false;
    });
    expect(undoSuccess).toBe(true);

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const bg = snap?.document.nodes['bg-rect'];
      const ov = snap?.document.nodes['overlap-rect'];
      return {
        bgX: bg?.x,
        bgY: bg?.y,
        ovX: ov?.x,
        ovY: ov?.y,
      };
    });

    expect(afterUndo.bgX).toBe(initial.bgX);
    expect(afterUndo.bgY).toBe(initial.bgY);
    expect(afterUndo.ovX).toBe(initial.ovX);
    expect(afterUndo.ovY).toBe(initial.ovY);
  });

  test('pressionar Escape durante o arrasto cancela a movimentação e limpa o preview sem commitar', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['overlap-rect']);
    });

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    await page.mouse.move(box.x + 250, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 250);

    // Verifica que preview estava ativo
    const hasPreview = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getPreview() !== null;
    });
    expect(hasPreview).toBe(true);

    // Cancela com Escape
    await page.keyboard.press('Escape');

    const afterEscape = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const ov = snap?.document.nodes['overlap-rect'];
      return {
        preview,
        rev: snap?.revision,
        x: ov?.x,
        y: ov?.y,
      };
    });

    expect(afterEscape.preview).toBeNull();
    expect(afterEscape.rev).toBe(revBefore);
    expect(afterEscape.x).toBe(180);
    expect(afterEscape.y).toBe(120);

    // Soltar o mouse depois de cancelado não gera commit tardio
    await page.mouse.up();
    const finalRev = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision;
    });
    expect(finalRev).toBe(revBefore);
  });
});
