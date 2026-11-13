import type { CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { paintItem } from './painter.js';
import { projectScene, type RenderableSticky } from './scene.js';

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
            // A medição devolve uma largura proporcional ao texto, como um contexto de verdade.
            return key === 'measureText' ? { width: String(args[0]).length * 8 } : undefined;
          },
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push({ method: `set ${key}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

const STICKY: RenderableSticky = {
  type: 'sticky',
  id: 'n1',
  layerId: 'l1',
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  rotation: 0,
  text: 'Olá\nmundo',
  fontSize: 20,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  textAlign: 'left',
  lineHeight: 1.25,
  style: { fill: '#fff59d', stroke: null, strokeWidth: 0, opacity: 1 },
};

const methods = (calls: readonly Call[]): string[] => calls.map((call) => call.method);

describe('nota adesiva no renderer Canvas 2D', () => {
  it('projeta o nó em RenderableSticky com o texto e a cor da nota', () => {
    const document: CanvasDocument = {
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l1', name: 'L', visible: true, locked: false, childIds: ['n1'] }],
      nodes: {
        n1: {
          id: 'n1',
          type: 'sticky',
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          rotation: 0,
          text: 'Olá\nmundo',
          fontSize: 20,
          fontSizeMode: 'fixed',
          fontFamily: 'sans-serif',
          fontWeight: 'normal',
          textAlign: 'left',
          lineHeight: 1.25,
          visible: true,
          locked: false,
          style: { fill: '#fff59d', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      },
    };
    expect(projectScene(document).items).toEqual([STICKY]);
  });

  it('pinta a sombra, o corpo com o canto dobrado, a dobra e o texto, nessa ordem', () => {
    const { context, calls } = recordingContext();
    paintItem(context, STICKY);

    const sequence = methods(calls);
    expect(sequence.indexOf('set shadowBlur')).toBeLessThan(sequence.indexOf('fill'));
    expect(calls).toContainEqual({ method: 'set shadowColor', args: ['rgba(0, 0, 0, 0.18)'] });
    expect(calls).toContainEqual({ method: 'set shadowBlur', args: [6] });
    expect(calls).toContainEqual({ method: 'set shadowOffsetY', args: [2] });

    // Corpo: cinco vértices, com o canto inferior direito cortado pela dobra de 24.
    const firstPath = calls.slice(0, calls.findIndex((call) => call.method === 'closePath') + 1);
    expect(
      firstPath
        .filter((call) => call.method === 'moveTo' || call.method === 'lineTo')
        .map((call) => call.args),
    ).toEqual([
      [10, 20],
      [210, 20],
      [210, 96],
      [186, 120],
      [10, 120],
    ]);

    // Dobra: triângulo dentro da nota, na cor 12% mais escura.
    expect(calls).toContainEqual({ method: 'set fillStyle', args: ['#e0d88a'] });
    expect(calls).toContainEqual({ method: 'lineTo', args: [186, 120] });

    // Texto: recortado pela caixa da nota, na cor escura derivada do fundo claro.
    expect(calls).toContainEqual({ method: 'rect', args: [10, 20, 200, 100] });
    expect(methods(calls)).toContain('clip');
    expect(calls).toContainEqual({ method: 'set fillStyle', args: ['#1f2937'] });
    const texts = calls.filter((call) => call.method === 'fillText');
    expect(texts.map((call) => call.args[0])).toEqual(['Olá', 'mundo']);
    // Origem do texto: canto da nota mais a margem de 12; a segunda linha 25 abaixo (20 × 1,25).
    expect(texts[0]!.args.slice(1)).toEqual([22, 32]);
    expect(texts[1]!.args.slice(1)).toEqual([22, 57]);
  });

  it('o texto é claro sobre um fundo escuro', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...STICKY, style: { ...STICKY.style, fill: '#4c1d95' } });
    expect(calls).toContainEqual({ method: 'set fillStyle', args: ['#ffffff'] });
  });

  it('desenha o contorno só quando há traço visível', () => {
    const plain = recordingContext();
    paintItem(plain.context, STICKY);
    expect(methods(plain.calls)).not.toContain('stroke');

    const outlined = recordingContext();
    paintItem(outlined.context, {
      ...STICKY,
      style: { fill: '#fff59d', stroke: '#1e3a8a', strokeWidth: 2, opacity: 1 },
    });
    expect(methods(outlined.calls)).toContain('stroke');
    expect(outlined.calls).toContainEqual({ method: 'set strokeStyle', args: ['#1e3a8a'] });
    expect(outlined.calls).toContainEqual({ method: 'set lineWidth', args: [2] });
  });

  it('gira em torno do centro e aplica a opacidade do item', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...STICKY, rotation: 0.5, style: { ...STICKY.style, opacity: 0.5 } });
    expect(calls.filter((call) => call.method === 'translate' || call.method === 'rotate')).toEqual(
      [
        { method: 'translate', args: [110, 70] },
        { method: 'rotate', args: [0.5] },
        { method: 'translate', args: [-110, -70] },
      ],
    );
    expect(calls).toContainEqual({ method: 'set globalAlpha', args: [0.5] });
  });

  it('a dobra encolhe numa nota pequena', () => {
    const { context, calls } = recordingContext();
    paintItem(context, { ...STICKY, width: 40, height: 40 });
    // Dobra de 10 (um quarto do lado): o corpo termina em (40, 60) e sobe até (50, 50).
    expect(calls).toContainEqual({ method: 'lineTo', args: [40, 60] });
    expect(calls).toContainEqual({ method: 'lineTo', args: [50, 50] });
  });
});
