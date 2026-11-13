import type { CanvasDocument, InkKind, InkWidth } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { paintItem } from './painter.js';
import { projectScene, type RenderableInk } from './scene.js';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Contexto que registra chamadas de método e atribuições de propriedade, na ordem. */
function recordingContext(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push({ method: key, args });
            return undefined;
          },
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push({ method: `set ${key}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

function ink(extra: Partial<RenderableInk> = {}): RenderableInk {
  return {
    type: 'ink',
    id: 'k1',
    layerId: 'l1',
    x: 100,
    y: 200,
    width: 50,
    height: 20,
    rotation: 0,
    strokes: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
          { x: 1, y: 0 },
        ],
        color: '#1f2937',
        kind: 'pen',
        width: 'medium',
      },
    ],
    style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
    ...extra,
  };
}

const sets = (calls: readonly Call[], property: string): unknown[] =>
  calls.filter((call) => call.method === `set ${property}`).map((call) => call.args[0]);
const named = (calls: readonly Call[], method: string): Call[] =>
  calls.filter((call) => call.method === method);

describe('traço à mão livre no renderer Canvas 2D', () => {
  it('projeta o nó em RenderableInk com os traços locais e só a opacidade', () => {
    const document: CanvasDocument = {
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'L', visible: true, locked: false, childIds: ['k1'] }],
      nodes: {
        k1: {
          id: 'k1',
          type: 'ink',
          x: 100,
          y: 200,
          width: 50,
          height: 20,
          rotation: 0.2,
          strokes: ink().strokes,
          visible: true,
          locked: false,
          style: { opacity: 0.5 },
        },
      },
    };
    const [item] = projectScene(document).items;
    expect(item).toMatchObject({
      type: 'ink',
      id: 'k1',
      layerId: 'l1',
      x: 100,
      rotation: 0.2,
      style: { fill: null, stroke: null, strokeWidth: 0, opacity: 0.5 },
    });
    expect((item as RenderableInk).strokes).toEqual(ink().strokes);
  });

  it('pinta a curva por pontos médios, com pontas e juntas redondas', () => {
    const { context, calls } = recordingContext();
    paintItem(context, ink());
    expect(sets(calls, 'lineCap')).toEqual(['round']);
    expect(sets(calls, 'lineJoin')).toEqual(['round']);
    expect(sets(calls, 'strokeStyle')).toEqual(['#1f2937']);
    expect(sets(calls, 'lineWidth')).toEqual([4]);
    expect(named(calls, 'moveTo')[0]!.args).toEqual([100, 200]);
    // Controle no ponto do meio (125, 220); destino no ponto médio até o último (137.5, 210).
    expect(named(calls, 'quadraticCurveTo')[0]!.args).toEqual([125, 220, 137.5, 210]);
    expect(named(calls, 'lineTo')[0]!.args).toEqual([150, 200]);
    expect(named(calls, 'stroke')).toHaveLength(1);
    expect(named(calls, 'fill')).toHaveLength(0);
  });

  it.each([
    ['pen', 'thin', 2],
    ['pen', 'medium', 4],
    ['pen', 'thick', 8],
    ['marker', 'thin', 4],
    ['marker', 'medium', 8],
    ['marker', 'thick', 16],
    ['highlighter', 'thin', 6],
    ['highlighter', 'medium', 12],
    ['highlighter', 'thick', 24],
  ] as Array<[InkKind, InkWidth, number]>)(
    'tipo %s, espessura %s: linha de %d',
    (kind, width, thickness) => {
      const { context, calls } = recordingContext();
      paintItem(context, ink({ strokes: [{ ...ink().strokes[0]!, kind, width }] }));
      expect(sets(calls, 'lineWidth')).toEqual([thickness]);
    },
  );

  it('só o marca-texto é semitransparente, multiplicado pela opacidade do elemento', () => {
    const alphaOf = (kind: InkKind, opacity: number): unknown[] => {
      const { context, calls } = recordingContext();
      paintItem(
        context,
        ink({
          strokes: [{ ...ink().strokes[0]!, kind }],
          style: { fill: null, stroke: null, strokeWidth: 0, opacity },
        }),
      );
      return sets(calls, 'globalAlpha');
    };
    expect(alphaOf('pen', 1)).toEqual([1]);
    expect(alphaOf('marker', 1)).toEqual([1]);
    expect(alphaOf('highlighter', 1)).toEqual([0.4]);
    expect(alphaOf('highlighter', 0.5)).toEqual([0.2]);
  });

  it('um ponto único vira um círculo cheio do tamanho da espessura', () => {
    const { context, calls } = recordingContext();
    paintItem(
      context,
      ink({
        strokes: [
          { points: [{ x: 0.5, y: 0.5 }], color: '#ef4444', kind: 'marker', width: 'thick' },
        ],
      }),
    );
    expect(named(calls, 'arc')[0]!.args).toEqual([125, 210, 8, 0, 2 * Math.PI]);
    expect(named(calls, 'fill')).toHaveLength(1);
    expect(sets(calls, 'fillStyle')).toEqual(['#ef4444']);
    expect(named(calls, 'stroke')).toHaveLength(0);
  });

  it('dois pontos viram uma linha reta', () => {
    const { context, calls } = recordingContext();
    paintItem(
      context,
      ink({
        strokes: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            color: '#000000',
            kind: 'pen',
            width: 'thin',
          },
        ],
      }),
    );
    expect(named(calls, 'quadraticCurveTo')).toHaveLength(0);
    expect(named(calls, 'moveTo')[0]!.args).toEqual([100, 200]);
    expect(named(calls, 'lineTo')[0]!.args).toEqual([150, 220]);
  });

  it('pinta um traço por vez, cada um com a própria cor, e isola o estado', () => {
    const { context, calls } = recordingContext();
    paintItem(
      context,
      ink({
        strokes: [
          { ...ink().strokes[0]!, color: '#ef4444' },
          { ...ink().strokes[0]!, color: '#3b82f6' },
        ],
      }),
    );
    expect(sets(calls, 'strokeStyle')).toEqual(['#ef4444', '#3b82f6']);
    expect(named(calls, 'save').length).toBe(named(calls, 'restore').length);
  });

  it('gira em torno do centro da caixa quando há rotação', () => {
    const { context, calls } = recordingContext();
    paintItem(context, ink({ rotation: 0.5 }));
    expect(named(calls, 'translate').map((call) => call.args)).toEqual([
      [125, 210],
      [-125, -210],
    ]);
    expect(named(calls, 'rotate')[0]!.args).toEqual([0.5]);
  });

  it('opacidade zero não pinta nada', () => {
    const { context, calls } = recordingContext();
    paintItem(context, ink({ style: { fill: null, stroke: null, strokeWidth: 0, opacity: 0 } }));
    expect(calls).toHaveLength(0);
  });
});
