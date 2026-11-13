import type { CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { paintItem } from './painter.js';
import { projectScene, type RenderableBrace } from './scene.js';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

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

const BRACE: RenderableBrace = {
  type: 'brace',
  id: 'b1',
  layerId: 'l1',
  orientation: 'left',
  tipPosition: 0.5,
  curvature: 1,
  x: 10,
  y: 20,
  width: 100,
  height: 200,
  rotation: 0,
  style: { fill: null, stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
};

describe('chave no renderer Canvas 2D', () => {
  it('projeta o nó em RenderableBrace, sem preenchimento', () => {
    const document: CanvasDocument = {
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'L', visible: true, locked: false, childIds: ['b1'] }],
      nodes: {
        b1: {
          id: 'b1',
          type: 'brace',
          x: 10,
          y: 20,
          width: 100,
          height: 200,
          rotation: 0,
          orientation: 'left',
          tipPosition: 0.5,
          curvature: 1,
          visible: true,
          locked: false,
          style: { stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
        },
      },
    };
    expect(projectScene(document).items).toEqual([BRACE]);
  });

  it('pinta o contorno com linhas e cúbicas, só traço, sem fechar o caminho', () => {
    const { context, calls } = recordingContext();
    paintItem(context, BRACE);

    const methods = calls.map((c) => c.method);
    expect(methods.filter((m) => m === 'moveTo')).toHaveLength(1);
    expect(methods.filter((m) => m === 'lineTo')).toHaveLength(4);
    expect(methods.filter((m) => m === 'bezierCurveTo')).toHaveLength(4);
    expect(methods).toContain('stroke');
    expect(methods).not.toContain('fill');
    expect(methods).not.toContain('closePath');
    expect(calls.find((c) => c.method === 'moveTo')).toEqual({ method: 'moveTo', args: [110, 20] });
    // A ponta, em (10, 120), é o destino da segunda cúbica do contorno.
    expect(calls.filter((c) => c.method === 'bezierCurveTo')[1]!.args.slice(4)).toEqual([10, 120]);
  });

  it('gira em torno do centro da caixa e respeita a ausência de traço', () => {
    const turned = recordingContext();
    paintItem(turned.context, { ...BRACE, rotation: 0.5 });
    expect(turned.calls.filter((c) => c.method === 'translate' || c.method === 'rotate')).toEqual([
      { method: 'translate', args: [60, 120] },
      { method: 'rotate', args: [0.5] },
      { method: 'translate', args: [-60, -120] },
    ]);

    const hidden = recordingContext();
    paintItem(hidden.context, { ...BRACE, style: { ...BRACE.style, stroke: null } });
    expect(hidden.calls).toEqual([]);
  });
});
