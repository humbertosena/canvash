import type { CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { paintItem } from './painter.js';
import { projectScene, type RenderableChevron } from './scene.js';

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

const CHEVRON: RenderableChevron = {
  type: 'chevron',
  id: 'v1',
  layerId: 'l1',
  direction: 'right',
  notchDepth: 0.25,
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  rotation: 0,
  style: { fill: '#3b82f6', stroke: '#1e3a8a', strokeWidth: 2, opacity: 1 },
};

describe('chevron no renderer Canvas 2D', () => {
  it('projeta o nó em RenderableChevron com direção, profundidade e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'L', visible: true, locked: false, childIds: ['v1'] }],
      nodes: {
        v1: {
          id: 'v1',
          type: 'chevron',
          x: 10,
          y: 20,
          width: 100,
          height: 60,
          rotation: 0,
          direction: 'right',
          notchDepth: 0.25,
          visible: true,
          locked: false,
          style: { fill: '#3b82f6', stroke: '#1e3a8a', strokeWidth: 2, opacity: 1 },
        },
      },
    };
    expect(projectScene(document).items).toEqual([CHEVRON]);
  });

  it('pinta os 6 vértices do contorno, fecha o caminho e preenche e contorna', () => {
    const { context, calls } = recordingContext();
    paintItem(context, CHEVRON);

    const path = calls.filter((c) => c.method === 'moveTo' || c.method === 'lineTo');
    expect(path.map((c) => c.args)).toEqual([
      [10, 20],
      [85, 20],
      [110, 50],
      [85, 80],
      [10, 80],
      [35, 50],
    ]);
    expect(calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(['closePath', 'fill', 'stroke']),
    );
  });

  it('muda o contorno com a direção e gira em torno do centro', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...CHEVRON, direction: 'down', rotation: 0.5 });

    const path = calls.filter((c) => c.method === 'moveTo' || c.method === 'lineTo');
    expect(path.map((c) => c.args)).toEqual([
      [10, 20],
      [60, 35],
      [110, 20],
      [110, 65],
      [60, 80],
      [10, 65],
    ]);
    expect(calls.filter((c) => c.method === 'rotate')).toEqual([{ method: 'rotate', args: [0.5] }]);
  });
});
