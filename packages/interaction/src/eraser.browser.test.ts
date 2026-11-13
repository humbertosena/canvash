import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCanvasSection,
  inkStrokesToWorld,
  type CanvasSectionApi,
  type InkNode,
} from '@canvash/core';
import { attachInteractions, type EraserCursor, type InteractionHandle } from './index.js';

type PointerKind = 'mouse' | 'touch' | 'pen';

describe('Borracha no navegador real: mouse, toque e stylus', () => {
  let container: HTMLElement;
  let section: CanvasSectionApi;
  let handle: InteractionHandle;
  let cursors: Array<EraserCursor | null>;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '600px';
    container.style.height = '400px';
    container.style.position = 'relative';
    document.body.appendChild(container);
    section = createCanvasSection();
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    cursors = [];
    handle = attachInteractions({
      section,
      element: container,
      onEraserCursorChange: (cursor) => cursors.push(cursor),
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'k',
        type: 'ink',
        strokes: [
          {
            points: [
              { x: 50, y: 100 },
              { x: 350, y: 100 },
            ],
          },
        ],
      },
    });
    section.setTool('eraser');
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  const strokes = () => inkStrokesToWorld(section.getSnapshot().document.nodes['k'] as InkNode);

  function fire(
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerleave',
    kind: PointerKind,
    x: number,
    y: number,
    pointerId = 1,
    coalesced?: Array<{ x: number; y: number }>,
  ): void {
    const rect = container.getBoundingClientRect();
    const event = new PointerEvent(type, {
      pointerId,
      pointerType: kind,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' || type === 'pointerleave' ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
      bubbles: true,
    });
    if (coalesced) {
      const samples = coalesced.map(
        (p) =>
          new PointerEvent('pointermove', { clientX: rect.left + p.x, clientY: rect.top + p.y }),
      );
      Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples });
    }
    container.dispatchEvent(event);
  }

  function sweep(kind: PointerKind): void {
    fire('pointerdown', kind, 200, 70);
    fire('pointermove', kind, 200, 100);
    fire('pointermove', kind, 200, 130);
    fire('pointerup', kind, 200, 130);
  }

  it('apagar mostra o preview, grava ao soltar e usa o cursor invisível', () => {
    fire('pointerdown', 'mouse', 200, 70);
    expect(handle.getState()).toBe('erasing');
    expect(container.style.cursor).toBe('none');
    fire('pointermove', 'mouse', 200, 100);
    expect(section.getPreview()?.updates['k']).toBeDefined();
    fire('pointerup', 'mouse', 200, 100);
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    expect(strokes()).toHaveLength(2);
    expect(container.style.cursor).toBe('none');
  });

  it('mouse, toque e stylus apagam o mesmo trecho para o mesmo caminho', () => {
    const results: unknown[] = [];
    for (const kind of ['mouse', 'touch', 'pen'] as const) {
      sweep(kind);
      results.push(strokes().map((stroke) => stroke.points));
      section.undo();
    }
    expect(results[0]).toHaveLength(2);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('o segundo dedo cancela a passada sem histórico', () => {
    const revision = section.getSnapshot().revision;
    fire('pointerdown', 'touch', 200, 70, 1);
    fire('pointermove', 'touch', 200, 100, 1);
    expect(handle.getState()).toBe('erasing');
    fire('pointerdown', 'touch', 400, 300, 2);
    expect(handle.getState()).toBe('idle');
    expect(section.getPreview()).toBeNull();
    fire('pointerup', 'touch', 400, 300, 2);
    fire('pointerup', 'touch', 200, 100, 1);
    expect(section.getSnapshot().revision).toBe(revision);
  });

  it('pointercancel, perda de captura, blur e Esc descartam a passada', () => {
    const revision = section.getSnapshot().revision;
    const start = () => {
      fire('pointerdown', 'mouse', 200, 70);
      fire('pointermove', 'mouse', 200, 100);
    };
    start();
    fire('pointercancel', 'mouse', 200, 100);
    expect(handle.getState()).toBe('idle');

    start();
    container.dispatchEvent(
      new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }),
    );
    expect(handle.getState()).toBe('idle');

    start();
    window.dispatchEvent(new Event('blur'));
    expect(handle.getState()).toBe('idle');

    start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(handle.getState()).toBe('idle');

    expect(section.getPreview()).toBeNull();
    expect(section.getSnapshot().revision).toBe(revision);
    expect(strokes()).toHaveLength(1);
  });

  it('usa as amostras coalescidas da passada', () => {
    fire('pointerdown', 'pen', 60, 130);
    fire('pointermove', 'pen', 340, 130, 1, [
      { x: 120, y: 70 },
      { x: 180, y: 130 },
      { x: 240, y: 70 },
      { x: 300, y: 130 },
      { x: 340, y: 130 },
    ]);
    fire('pointerup', 'pen', 340, 130);
    expect(strokes().length).toBeGreaterThanOrEqual(3);
  });

  it('o indicador acompanha o ponteiro e some ao sair da superfície', () => {
    fire('pointermove', 'mouse', 120, 90);
    expect(cursors.at(-1)).toEqual({ x: 120, y: 90, radius: 8 });
    fire('pointerleave', 'mouse', 120, 90);
    expect(cursors.at(-1)).toBeNull();
  });

  it('setEraserSize pelo handle muda o raio da próxima passada e do indicador', () => {
    expect(handle.getEraserSize()).toBe('medium');
    handle.setEraserSize('thick');
    expect(handle.getEraserSize()).toBe('thick');
    fire('pointermove', 'mouse', 120, 90);
    expect(cursors.at(-1)).toEqual({ x: 120, y: 90, radius: 16 });
    sweep('mouse');
    const [left, right] = strokes();
    expect(right!.points[0]!.x - left!.points[1]!.x).toBeCloseTo(32, 6);
  });

  it('destruir o handle no meio da passada limpa o preview e esconde o indicador', () => {
    fire('pointerdown', 'mouse', 200, 70);
    fire('pointermove', 'mouse', 200, 100);
    handle.destroy();
    expect(section.getPreview()).toBeNull();
    expect(cursors.at(-1)).toBeNull();
    expect(strokes()).toHaveLength(1);
  });
});
