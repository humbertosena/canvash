import type { CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { paintItem } from './painter.js';
import { projectScene, type RenderableCross } from './scene.js';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Contexto que só registra as chamadas de método, o bastante para conferir o caminho pintado. */
function recordingContext(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push({ method: key, args });
          },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

const CROSS: RenderableCross = {
  type: 'cross',
  id: 'c1',
  layerId: 'l1',
  armRatio: 1 / 3,
  x: 10,
  y: 20,
  width: 120,
  height: 90,
  rotation: 0,
  style: { fill: '#ff8800', stroke: '#000000', strokeWidth: 2, opacity: 1 },
};

describe('cruz no renderer Canvas 2D', () => {
  it('projeta o nó em RenderableCross com armRatio e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'L', visible: true, locked: false, childIds: ['c1'] }],
      nodes: {
        c1: {
          id: 'c1',
          type: 'cross',
          x: 10,
          y: 20,
          width: 120,
          height: 90,
          rotation: 0,
          armRatio: 1 / 3,
          visible: true,
          locked: false,
          style: { fill: '#ff8800', stroke: '#000000', strokeWidth: 2, opacity: 1 },
        },
      },
    };

    expect(projectScene(document).items).toEqual([CROSS]);
  });

  it('pinta os 12 vértices do contorno, fecha o caminho e preenche e contorna', () => {
    const { context, calls } = recordingContext();
    paintItem(context, CROSS);

    const path = calls.filter((c) => c.method === 'moveTo' || c.method === 'lineTo');
    expect(path).toHaveLength(12);
    expect(path[0]).toEqual({ method: 'moveTo', args: [55, 20] });
    expect(path[3]).toEqual({ method: 'lineTo', args: [130, 50] });
    expect(path[11]).toEqual({ method: 'lineTo', args: [55, 50] });
    expect(calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(['closePath', 'fill', 'stroke']),
    );
  });

  it('gira em torno do centro da caixa antes de traçar', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...CROSS, rotation: 0.5 });

    expect(calls.filter((c) => c.method === 'translate' || c.method === 'rotate')).toEqual([
      { method: 'translate', args: [70, 65] },
      { method: 'rotate', args: [0.5] },
      { method: 'translate', args: [-70, -65] },
    ]);
  });

  it('não pinta sem preenchimento nem traço', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...CROSS, style: { ...CROSS.style, fill: null, stroke: null } });
    expect(calls).toEqual([]);
  });
});
