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

test.describe('Interação: Rotação de Seleção Única e Múltipla (Tarefa 36 - INPUT-04)', () => {
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

  test('rotaciona shape único arrastando o handle de rotação com preview e commit atômico no pointerup (INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Seleciona bg-rect (x: 50, y: 50, width: 300, height: 200, rotation: 0)
    // Centro: (200, 150). Handle de rotação: x = 200, y = 50 - 24 = 26
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialInfo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const node = snap.document.nodes['bg-rect'];
      if (!node) throw new Error('bg-rect indisponível');
      return {
        revision: snap.revision,
        x: node.x!,
        y: node.y!,
        width: node.width!,
        height: node.height!,
        rotation: node.rotation ?? 0,
      };
    });

    // Posição do handle de rotação na tela: (box.x + 200, box.y + 26)
    const handleScreenX = box.x + 200;
    const handleScreenY = box.y + 26;

    await page.mouse.move(handleScreenX, handleScreenY);
    await page.mouse.down();

    // Arrasta para a direita e para baixo: ex: x: 300, y: 150
    // Vetor inicial do centro (200, 150) ao handle (200, 26) é (0, -124) -> -π/2 (-90°)
    // Vetor para (300, 150) é (100, 0) -> 0 rad (0°)
    // Variação esperada ~ +π/2 rad (+90°)
    const targetScreenX = box.x + 300;
    const targetScreenY = box.y + 150;
    await page.mouse.move(targetScreenX, targetScreenY, { steps: 5 });

    // Durante o arrasto, deve haver preview ativo e revisão do documento não alterada
    const duringDrag = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return {
        hasPreview: preview !== null && preview !== undefined,
        revision: snap?.revision,
      };
    });

    expect(duringDrag.hasPreview).toBe(true);
    expect(duringDrag.revision).toBe(initialInfo.revision);

    // Finaliza gesto
    await page.mouse.up();

    const afterRotate = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const node = snap.document.nodes['bg-rect'];
      if (!node) throw new Error('bg-rect indisponível');
      return {
        revision: snap.revision,
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
        x: node.x!,
        y: node.y!,
        width: node.width!,
        height: node.height!,
        rotation: node.rotation ?? 0,
      };
    });

    // Preview deve ter sido limpo e exatamente 1 commit gerado
    expect(afterRotate.preview).toBeNull();
    expect(afterRotate.revision).toBe(initialInfo.revision + 1);

    // Dimensões mantidas
    expect(afterRotate.width).toBe(initialInfo.width);
    expect(afterRotate.height).toBe(initialInfo.height);

    // Centro mantido em (200, 150)
    const newCenterX = afterRotate.x + afterRotate.width / 2;
    const newCenterY = afterRotate.y + afterRotate.height / 2;
    expect(newCenterX).toBeCloseTo(200, 1);
    expect(newCenterY).toBeCloseTo(150, 1);

    // Rotação alterada significativamente (próxima de 1.57 rad / 90°)
    expect(afterRotate.rotation).toBeGreaterThan(0.5);

    // Testa undo em 1 passo atômico
    const undoRes = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.undo().ok ?? false;
    });
    expect(undoRes).toBe(true);

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const node = snap?.document.nodes['bg-rect'];
      return {
        rotation: node?.rotation ?? 0,
        x: node?.x,
        y: node?.y,
      };
    });

    expect(afterUndo.rotation).toBeCloseTo(initialInfo.rotation, 4);
    expect(afterUndo.x).toBeCloseTo(initialInfo.x, 1);
    expect(afterUndo.y).toBeCloseTo(initialInfo.y, 1);
  });

  test('rotaciona com tecla Shift limitando o ângulo a passos discretos de 15 graus (π/12 rad) (INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const handleScreenX = box.x + 200;
    const handleScreenY = box.y + 26;

    await page.mouse.move(handleScreenX, handleScreenY);
    await page.mouse.down();

    // Pressiona Shift durante o arrasto
    await page.keyboard.down('Shift');

    // Arrasta para uma posição arbitrária
    await page.mouse.move(box.x + 280, box.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const rotatedAngle = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      return snap?.document.nodes['bg-rect']?.rotation ?? 0;
    });

    // Passo de 15 graus em radianos
    const step = Math.PI / 12;
    const quotient = rotatedAngle / step;
    const nearestInt = Math.round(quotient);

    // A rotação deve ser estritamente um múltiplo de 15°
    expect(Math.abs(quotient - nearestInt)).toBeLessThan(1e-4);
  });

  test('rotaciona seleção múltipla preservando distâncias relativas entre formas e aplicando mesma variação angular (INPUT-04)', async ({
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
      const r1 = snap.document.nodes['bg-rect']!;
      const r2 = snap.document.nodes['overlap-rect']!;

      const c1 = { x: r1.x! + r1.width! / 2, y: r1.y! + r1.height! / 2 };
      const c2 = { x: r2.x! + r2.width! / 2, y: r2.y! + r2.height! / 2 };
      const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

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
        revision: snap.revision,
        dist,
        rot1: r1.rotation ?? 0,
        rot2: r2.rotation ?? 0,
        rotHandle: {
          x: (minX + maxX) / 2,
          y: minY - 24,
        },
      };
    });

    const handleScreenX = box.x + initialInfo.rotHandle.x;
    const handleScreenY = box.y + initialInfo.rotHandle.y;

    await page.mouse.move(handleScreenX, handleScreenY);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 165, { steps: 5 });
    await page.mouse.up();

    const afterRotate = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      if (!snap) throw new Error('Snapshot indisponível');
      const r1 = snap.document.nodes['bg-rect']!;
      const r2 = snap.document.nodes['overlap-rect']!;

      const c1 = { x: r1.x! + r1.width! / 2, y: r1.y! + r1.height! / 2 };
      const c2 = { x: r2.x! + r2.width! / 2, y: r2.y! + r2.height! / 2 };
      const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

      return {
        revision: snap.revision,
        dist,
        rot1: r1.rotation ?? 0,
        rot2: r2.rotation ?? 0,
      };
    });

    // Exatamente 1 commit atômico gerado
    expect(afterRotate.revision).toBe(initialInfo.revision + 1);

    // Distância relativa entre os centros dos nós foi preservada
    expect(afterRotate.dist).toBeCloseTo(initialInfo.dist, 1);

    // Ambas as formas sofreram a mesma variação angular Δθ
    const delta1 = afterRotate.rot1 - initialInfo.rot1;
    const delta2 = afterRotate.rot2 - initialInfo.rot2;
    expect(delta1).toBeCloseTo(delta2, 3);
    expect(Math.abs(delta1)).toBeGreaterThan(0.2);

    // Desfaz via undo em 1 passo
    const undoRes = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.undo().ok ?? false;
    });
    expect(undoRes).toBe(true);

    const afterUndo = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const snap = g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
      const r1 = snap?.document.nodes['bg-rect'];
      const r2 = snap?.document.nodes['overlap-rect'];
      return {
        rot1: r1?.rotation ?? 0,
        rot2: r2?.rotation ?? 0,
      };
    });

    expect(afterUndo.rot1).toBeCloseTo(initialInfo.rot1, 4);
    expect(afterUndo.rot2).toBeCloseTo(initialInfo.rot2, 4);
  });

  test('cancela rotação em andamento com Escape sem comitar alterações no documento (INPUT-04)', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    const initialSnap = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot();
    });

    const handleScreenX = box.x + 200;
    const handleScreenY = box.y + 26;

    await page.mouse.move(handleScreenX, handleScreenY);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 200, { steps: 5 });

    // Pressiona Escape durante o arrasto
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const finalState = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return {
        snap: g.__CANVASH_PLAYGROUND__?.section.getSnapshot(),
        preview: g.__CANVASH_PLAYGROUND__?.section.getPreview(),
      };
    });

    expect(finalState.preview).toBeNull();
    expect(finalState.snap?.revision).toBe(initialSnap?.revision);
    expect(finalState.snap?.document.nodes['bg-rect']?.rotation).toBe(
      initialSnap?.document.nodes['bg-rect']?.rotation,
    );
  });
});
