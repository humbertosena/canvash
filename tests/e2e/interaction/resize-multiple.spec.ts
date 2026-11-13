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
              readonly rotation?: number;
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

test.describe('Interação: Resize de Seleção Múltipla (Tarefa 35 - INPUT-02, INPUT-04)', () => {
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

  test('redimensiona múltiplos shapes uniformemente via handle se, com preview reativo e commit único (INPUT-02, INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect e overlap-rect
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect', 'overlap-rect']);
    });

    const initialInfo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const r1 = snap.document.nodes['bg-rect'];
      const r2 = snap.document.nodes['overlap-rect'];
      if (!r1 || !r2) throw new Error('Nodes bg-rect ou overlap-rect ausentes');

      // Bounding box agregada
      const computeCorners = (node: NonNullable<typeof r1>) => {
        const cx = (node.x ?? 0) + (node.width ?? 0) / 2;
        const cy = (node.y ?? 0) + (node.height ?? 0) / 2;
        const hw = (node.width ?? 0) / 2;
        const hh = (node.height ?? 0) / 2;
        const rot = node.rotation ?? 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        return [
          { x: cx + (cos * -hw - sin * -hh), y: cy + (sin * -hw + cos * -hh) },
          { x: cx + (cos * hw - sin * -hh), y: cy + (sin * hw + cos * -hh) },
          { x: cx + (cos * hw - sin * hh), y: cy + (sin * hw + cos * hh) },
          { x: cx + (cos * -hw - sin * hh), y: cy + (sin * -hw + cos * hh) },
        ];
      };

      const pts = [...computeCorners(r1), ...computeCorners(r2)];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      return {
        rev: snap.revision,
        seHandle: { x: maxX, y: maxY },
        nwAnchor: { x: minX, y: minY },
        boundsW: maxX - minX,
        boundsH: maxY - minY,
        r1X: r1.x ?? 0,
        r1Y: r1.y ?? 0,
        r1W: r1.width ?? 0,
        r1H: r1.height ?? 0,
        r2X: r2.x ?? 0,
        r2Y: r2.y ?? 0,
        r2W: r2.width ?? 0,
        r2H: r2.height ?? 0,
        r2Rot: r2.rotation ?? 0,
      };
    });

    const revBefore = initialInfo.rev;
    const { seHandle } = initialInfo;

    // Posiciona o mouse exatamente no handle SE coletivo
    await page.mouse.move(box.x + seHandle.x, box.y + seHandle.y);
    await page.mouse.down();

    // Arrasta 60px para a direita e 60px para baixo
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(box.x + seHandle.x + i * 10, box.y + seHandle.y + i * 10);
    }

    // Enquanto arrasta: preview ativo para ambos os shapes; documento intacto
    const previewState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return {
        hasBgPreview: preview?.updates !== undefined && 'bg-rect' in (preview.updates ?? {}),
        hasOverlapPreview:
          preview?.updates !== undefined && 'overlap-rect' in (preview.updates ?? {}),
        docBgW: snap?.document.nodes['bg-rect']?.width,
        docOverlapW: snap?.document.nodes['overlap-rect']?.width,
        rev: snap?.revision,
      };
    });

    expect(previewState.hasBgPreview).toBe(true);
    expect(previewState.hasOverlapPreview).toBe(true);
    expect(previewState.docBgW).toBe(initialInfo.r1W);
    expect(previewState.docOverlapW).toBe(initialInfo.r2W);
    expect(previewState.rev).toBe(revBefore);

    // Finaliza no pointerup
    await page.mouse.up();

    const afterCommit = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const r1 = snap?.document.nodes['bg-rect'];
      const r2 = snap?.document.nodes['overlap-rect'];
      return {
        preview,
        rev: snap?.revision ?? 0,
        r1W: r1?.width ?? 0,
        r1H: r1?.height ?? 0,
        r2W: r2?.width ?? 0,
        r2H: r2?.height ?? 0,
        r2Rot: r2?.rotation ?? 0,
        r1X: r1?.x ?? 0,
        r2X: r2?.x ?? 0,
      };
    });

    // 1. Preview limpo
    expect(afterCommit.preview).toBeNull();
    // 2. Commit único atômico
    expect(afterCommit.rev).toBe(revBefore + 1);
    // 3. Ambos os shapes foram ampliados
    expect(afterCommit.r1W).toBeGreaterThan(initialInfo.r1W);
    expect(afterCommit.r1H).toBeGreaterThan(initialInfo.r1H);
    expect(afterCommit.r2W).toBeGreaterThan(initialInfo.r2W);
    expect(afterCommit.r2H).toBeGreaterThan(initialInfo.r2H);

    // 4. Sem skew: forma rotacionada preserva exatamente sua rotação
    expect(afterCommit.r2Rot).toBeCloseTo(initialInfo.r2Rot, 5);

    // 5. Distância relativa entre os nós escalou proporcionalmente (INPUT-04)
    const initialDist = initialInfo.r2X - initialInfo.r1X;
    const finalDist = afterCommit.r2X - afterCommit.r1X;
    const scaleFactor = afterCommit.r1W / initialInfo.r1W;
    expect(finalDist / initialDist).toBeCloseTo(scaleFactor, 2);
  });

  test('desfaz o redimensionamento múltiplo em 1 único passo de undo (INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect', 'overlap-rect']);
    });

    const before = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const r1 = snap?.document.nodes['bg-rect'];
      const r2 = snap?.document.nodes['overlap-rect'];
      return {
        r1W: r1?.width,
        r1H: r1?.height,
        r2W: r2?.width,
        r2H: r2?.height,
      };
    });

    // Pega o handle SE exato da bounding box agregada
    const handlePos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const r1 = snap.document.nodes['bg-rect'];
      const r2 = snap.document.nodes['overlap-rect'];
      if (!r1 || !r2) throw new Error('Nodes indisponíveis');

      const computeCorners = (node: typeof r1) => {
        const cx = (node.x ?? 0) + (node.width ?? 0) / 2;
        const cy = (node.y ?? 0) + (node.height ?? 0) / 2;
        const hw = (node.width ?? 0) / 2;
        const hh = (node.height ?? 0) / 2;
        const rot = node.rotation ?? 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        return [
          { x: cx + (cos * -hw - sin * -hh), y: cy + (sin * -hw + cos * -hh) },
          { x: cx + (cos * hw - sin * -hh), y: cy + (sin * hw + cos * -hh) },
          { x: cx + (cos * hw - sin * hh), y: cy + (sin * hw + cos * hh) },
          { x: cx + (cos * -hw - sin * hh), y: cy + (sin * -hw + cos * hh) },
        ];
      };

      const pts = [...computeCorners(r1), ...computeCorners(r2)];
      const maxX = Math.max(...pts.map((p) => p.x));
      const maxY = Math.max(...pts.map((p) => p.y));
      return { x: maxX, y: maxY };
    });

    await page.mouse.move(box.x + handlePos.x, box.y + handlePos.y);
    await page.mouse.down();
    await page.mouse.move(box.x + handlePos.x + 50, box.y + handlePos.y + 50);
    await page.mouse.up();

    // Executa 1 único undo
    const undoRes = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.undo();
    });

    expect(undoRes?.ok).toBe(true);

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const r1 = snap?.document.nodes['bg-rect'];
      const r2 = snap?.document.nodes['overlap-rect'];
      return {
        r1W: r1?.width,
        r1H: r1?.height,
        r2W: r2?.width,
        r2H: r2?.height,
      };
    });

    expect(afterUndo.r1W).toBe(before.r1W);
    expect(afterUndo.r1H).toBe(before.r1H);
    expect(afterUndo.r2W).toBe(before.r2W);
    expect(afterUndo.r2H).toBe(before.r2H);
  });

  test('cancelamento com Escape durante o redimensionamento descarta preview e não comita (INPUT-05)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect', 'overlap-rect']);
    });

    const revBefore = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision ?? 0;
    });

    const handlePos = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const r1 = snap.document.nodes['bg-rect'];
      const r2 = snap.document.nodes['overlap-rect'];
      if (!r1 || !r2) throw new Error('Nodes indisponíveis');

      const computeCorners = (node: typeof r1) => {
        const cx = (node.x ?? 0) + (node.width ?? 0) / 2;
        const cy = (node.y ?? 0) + (node.height ?? 0) / 2;
        const hw = (node.width ?? 0) / 2;
        const hh = (node.height ?? 0) / 2;
        const rot = node.rotation ?? 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        return [
          { x: cx + (cos * -hw - sin * -hh), y: cy + (sin * -hw + cos * -hh) },
          { x: cx + (cos * hw - sin * -hh), y: cy + (sin * hw + cos * -hh) },
          { x: cx + (cos * hw - sin * hh), y: cy + (sin * hw + cos * hh) },
          { x: cx + (cos * -hw - sin * hh), y: cy + (sin * -hw + cos * hh) },
        ];
      };

      const pts = [...computeCorners(r1), ...computeCorners(r2)];
      const maxX = Math.max(...pts.map((p) => p.x));
      const maxY = Math.max(...pts.map((p) => p.y));
      return { x: maxX, y: maxY };
    });

    await page.mouse.move(box.x + handlePos.x, box.y + handlePos.y);
    await page.mouse.down();
    await page.mouse.move(box.x + handlePos.x + 40, box.y + handlePos.y + 40);

    // Cancela com Escape
    await page.keyboard.press('Escape');

    // Solta o mouse
    await page.mouse.up();

    const afterCancel = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        rev: g.__CANVASH_PLAYGROUND__?.section.getSnapshot().revision,
      };
    });

    expect(afterCancel.preview).toBeNull();
    expect(afterCancel.rev).toBe(revBefore);
  });
});
