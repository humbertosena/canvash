import { expect, test } from '@playwright/test';

interface PlaygroundGlobal {
  readonly __CANVASH_PLAYGROUND__?: {
    readonly section: {
      readonly getSnapshot: () => {
        readonly session: {
          readonly selectedIds: readonly string[];
        };
      };
      readonly getPreview: () => {
        readonly marquee?: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        } | null;
      } | null;
      readonly setViewport: (vp: { x: number; y: number; zoom: number }) => void;
      readonly setTool: (tool: string) => void;
      readonly setSelection: (ids: readonly string[]) => void;
    };
  };
}

test.describe('Interação: Seleção por Marquee (Tarefa 32 - INPUT-03)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?layout=classic');
    await page.waitForSelector('#canvas-container');

    // Reseta viewport para (0, 0, 1), ferramenta para select e seleção vazia
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 0, y: 0, zoom: 1 });
      g.__CANVASH_PLAYGROUND__?.section.setTool('select');
      g.__CANVASH_PLAYGROUND__?.section.setSelection([]);
    });
  });

  test('arrasto da esquerda para a direita (Window) exige contenção estrita e limpa preview no pointerup', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Inicia arrasto em área vazia (10, 10)
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();

    // Move para a direita até (380, 275), cobrindo bg-rect (50..350, 50..250) e diag-line (37..363)
    // mas sem conter overlap-rect (180..400, 120..280) completamente
    await page.mouse.move(box.x + 380, box.y + 275);

    // Verifica que o preview de marquee está ativo
    const hasPreview = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      const preview = g.__CANVASH_PLAYGROUND__?.section.getPreview();
      return preview?.marquee !== undefined && preview?.marquee !== null;
    });
    expect(hasPreview).toBe(true);

    // Solta o mouse
    await page.mouse.up();

    // Verifica que o preview foi limpo
    const previewAfter = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getPreview();
    });
    expect(previewAfter).toBeNull();

    // Verifica a seleção resultante
    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // bg-rect e diag-line estão contidos; overlap-rect ultrapassa a caixa (400 > 380)
    expect(selectedIds).toContain('bg-rect');
    expect(selectedIds).toContain('diag-line');
    expect(selectedIds).not.toContain('overlap-rect');
  });

  test('arrasto da direita para a esquerda (Crossing) aceita interseção geométrica', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // overlap-rect fica em x: 180, y: 120, width: 220, height: 160 (180..400, 120..280)
    // Inicia arrasto no espaço vazio (x: 550, y: 220) e move para a esquerda até (x: 350, y: 260)
    // A caixa do marquee será x: 350..550, y: 220..260
    // Como overlap-rect cobre x: 180..400 e y: 120..280, ele intersecta a caixa
    await page.mouse.move(box.x + 550, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 260);
    await page.mouse.up();

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // Em modo Crossing (direita para esquerda), overlap-rect foi intersectado e deve ser selecionado
    expect(selectedIds).toContain('overlap-rect');
  });

  test('Shift durante marquee adiciona shapes à seleção existente', async ({ page }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 1. Seleciona bg-rect previamente
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    // 2. Com Shift pressionado, faz marquee crossing sobre overlap-ellipse
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 480, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 150);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    // bg-rect deve ter sido preservado e overlap-ellipse adicionado
    expect(selectedIds).toContain('bg-rect');
    expect(selectedIds).toContain('overlap-ellipse');
  });

  test('Escape cancela o marquee e limpa preview sem alterar a seleção prévia', async ({
    page,
  }) => {
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 1. Pré-seleciona bg-rect
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setSelection(['bg-rect']);
    });

    // 2. Inicia marquee
    await page.mouse.move(box.x + 450, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 250);

    // 3. Cancela com Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // Preview deve estar limpo
    const previewAfter = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getPreview();
    });
    expect(previewAfter).toBeNull();

    // Seleção original deve ser preservada
    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });
    expect(selectedIds).toEqual(['bg-rect']);
  });

  test('marquee respeita viewport com zoom', async ({ page }) => {
    await page.locator('#canvas-container').scrollIntoViewIfNeeded();
    const box = await page.locator('#canvas-container').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Configura viewport com zoom 2 e pan
    await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      g.__CANVASH_PLAYGROUND__?.section.setViewport({ x: 50, y: 50, zoom: 2 });
    });

    // Em zoom 2 e pan (50, 50):
    // tela = mundo * 2 + 50
    // Para cobrir mundo (10, 10) a (360, 260):
    // tela = (70, 70) a (770, 570)
    await page.mouse.move(box.x + 70, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 770, box.y + 570, { steps: 5 });
    await page.mouse.up();

    const selectedIds = await page.evaluate(() => {
      const g = globalThis as unknown as PlaygroundGlobal;
      return g.__CANVASH_PLAYGROUND__?.section.getSnapshot().session.selectedIds;
    });

    expect(selectedIds).toContain('bg-rect');
  });
});
