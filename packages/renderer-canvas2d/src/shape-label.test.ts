import {
  createCanvasSection,
  shapeLabelArea,
  shapeLabelColor,
  type ShapeLabel,
  type ShapeNode,
} from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { paintItem, paintScene } from './painter.js';
import {
  projectScene,
  type ProjectedScene,
  type RenderableItem,
  type RenderableRectangle,
} from './scene.js';
import {
  clearShapeLabelCache,
  layoutShapeLabel,
  paintShapeLabel,
  shapeLabelLayoutCount,
} from './shape-label.js';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Contexto que registra chamadas e atribuições, na ordem; mede 8 px por caractere. */
function recordingContext(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push({ method: key, args });
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

const LABEL: ShapeLabel = {
  text: 'Olá',
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  color: null,
  textAlign: 'center',
  verticalAlign: 'middle',
};

const NONE = { fill: null, stroke: null, strokeWidth: 0, opacity: 1 } as const;
const FILLED = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 } as const;

const rectangle = (
  label: Partial<ShapeLabel> | undefined,
  extra: Partial<RenderableRectangle> = {},
): RenderableRectangle => ({
  type: 'rectangle',
  id: 'r',
  layerId: 'l',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  style: FILLED,
  ...(label === undefined ? {} : { label: { ...LABEL, ...label } }),
  ...extra,
});

const callsOf = (calls: readonly Call[], method: string) =>
  calls.filter((call) => call.method === method);

beforeEach(() => clearShapeLabelCache());

describe('layoutShapeLabel: posição e alinhamento (US-SL.5)', () => {
  // Área do retângulo 200 × 100: (8, 8, 184, 84). Relativa ao centro (100, 50): (-92, -42).
  // "Olá" mede 24 px; a linha tem 20 px (16 × 1,25).
  const cases = [
    ['top', 'left', -92, -42],
    ['top', 'center', -12, -42],
    ['top', 'right', 68, -42],
    ['middle', 'left', -92, -10],
    ['middle', 'center', -12, -10],
    ['middle', 'right', 68, -10],
    ['bottom', 'left', -92, 22],
    ['bottom', 'center', -12, 22],
    ['bottom', 'right', 68, 22],
  ] as const;

  it.each(cases)(
    'verticalAlign %s × textAlign %s põe a primeira linha em (%d, %d)',
    (v, h, x, y) => {
      const { context } = recordingContext();
      const layout = layoutShapeLabel(rectangle({ verticalAlign: v, textAlign: h }), context);

      expect(layout?.lines[0]).toMatchObject({ text: 'Olá', x, y });
    },
  );

  it('com excesso vertical, o bloco começa no topo da área em qualquer verticalAlign', () => {
    const { context } = recordingContext();
    const text = Array.from({ length: 10 }, () => 'linha').join('\n');

    for (const verticalAlign of ['top', 'middle', 'bottom'] as const) {
      const layout = layoutShapeLabel(rectangle({ text, verticalAlign }), context);
      expect(layout?.lines).toHaveLength(10);
      expect(layout?.lines[0]?.y).toBe(-42);
    }
  });

  it('sem texto ou sem área, não há layout', () => {
    const { context } = recordingContext();

    expect(layoutShapeLabel(rectangle({ text: '' }), context)).toBeNull();
    expect(layoutShapeLabel(rectangle(undefined), context)).toBeNull();
    expect(layoutShapeLabel(rectangle({}, { width: 10, height: 10 }), context)).toBeNull();
  });
});

describe('paintShapeLabel: quebra e recorte (US-SL.6)', () => {
  it('quebra por palavra na largura da área', () => {
    const { context } = recordingContext();
    // 184 px / 8 = 23 caracteres por linha.
    const text = 'um dois tres quatro cinco seis sete oito nove dez onze';

    const layout = layoutShapeLabel(rectangle({ text }), context)!;

    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) expect(line.text.length * 8).toBeLessThanOrEqual(184);
    expect(layout.lines.map((l) => l.text).join(' ')).toBe(text);
  });

  it('uma palavra maior que a largura quebra por caractere, e \\n força a quebra', () => {
    const { context } = recordingContext();

    const long = layoutShapeLabel(rectangle({ text: 'x'.repeat(60) }), context)!;
    const forced = layoutShapeLabel(rectangle({ text: 'a\nb\n\nc' }), context)!;

    expect(long.lines.length).toBeGreaterThan(2);
    expect(long.lines.map((l) => l.text).join('')).toBe('x'.repeat(60));
    expect(forced.lines.map((l) => l.text)).toEqual(['a', 'b', '', 'c']);
  });

  it('recorta no retângulo da área com clip()', () => {
    const { context, calls } = recordingContext();

    paintShapeLabel(context, rectangle({}));

    const names = calls.map((call) => call.method);
    expect(names.indexOf('clip')).toBeGreaterThan(names.indexOf('rect'));
    expect(callsOf(calls, 'rect')[0]?.args).toEqual([-92, -42, 184, 84]);
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('fillText'));
    expect(names[0]).toBe('save');
    expect(names.at(-1)).toBe('restore');
  });
});

describe('paintItem: o texto depois da forma (US-SL.7)', () => {
  it('pinta o texto logo depois da forma', () => {
    const { context, calls } = recordingContext();

    paintItem(context, rectangle({}));

    const names = calls.map((call) => call.method);
    expect(names.indexOf('fillRect')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('fillRect')).toBeLessThan(names.indexOf('fillText'));
    expect(callsOf(calls, 'fillText')).toHaveLength(1);
  });

  it('sem preenchimento e sem contorno, ainda pinta o texto; sem texto, não pinta nada', () => {
    const withText = recordingContext();
    const without = recordingContext();

    paintItem(withText.context, rectangle({}, { style: NONE }));
    paintItem(without.context, rectangle({ text: '' }, { style: NONE }));

    expect(callsOf(withText.calls, 'fillText')).toHaveLength(1);
    expect(without.calls).toEqual([]);
  });

  it('a opacidade da forma vale para o texto', () => {
    const { context, calls } = recordingContext();

    paintShapeLabel(context, rectangle({}, { style: { ...FILLED, opacity: 0.5 } }));

    expect(callsOf(calls, 'set globalAlpha').map((c) => c.args[0])).toEqual([0.5]);
  });

  it('forma totalmente transparente não pinta o texto', () => {
    const { context, calls } = recordingContext();

    paintItem(context, rectangle({}, { style: { ...FILLED, opacity: 0 } }));

    expect(calls).toEqual([]);
  });

  it('usa a cor automática do contraste e a explícita quando dada', () => {
    const dark = recordingContext();
    const given = recordingContext();

    paintShapeLabel(dark.context, rectangle({}, { style: { ...FILLED, fill: '#000000' } }));
    paintShapeLabel(given.context, rectangle({ color: '#ff0000' }));

    expect(callsOf(dark.calls, 'set fillStyle').map((c) => c.args[0])).toEqual(['#ffffff']);
    expect(callsOf(given.calls, 'set fillStyle').map((c) => c.args[0])).toEqual(['#ff0000']);
  });

  it.each([
    ['retângulo', rectangle({}, { rotation: Math.PI / 6 })],
    [
      'polígono',
      {
        type: 'polygon',
        id: 'p',
        layerId: 'l',
        sides: 6,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: Math.PI / 6,
        style: FILLED,
        label: LABEL,
      } as RenderableItem,
    ],
    [
      'elipse',
      {
        type: 'ellipse',
        id: 'e',
        layerId: 'l',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: Math.PI / 6,
        style: FILLED,
        label: LABEL,
      } as RenderableItem,
    ],
  ])('%s girado: o texto recebe uma única rotação, a da forma', (_name, item) => {
    const { context, calls } = recordingContext();

    paintShapeLabel(context, item as RenderableRectangle);

    expect(callsOf(calls, 'rotate').map((c) => c.args[0])).toEqual([Math.PI / 6]);
    expect(callsOf(calls, 'translate')).toHaveLength(1);
  });

  it('na elipse girada, a pintura completa gira o texto uma vez só (a elipse gira pelo argumento)', () => {
    const { context, calls } = recordingContext();
    const ellipse = {
      type: 'ellipse',
      id: 'e',
      layerId: 'l',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: Math.PI / 6,
      style: FILLED,
      label: LABEL,
    } as RenderableItem;

    paintItem(context, ellipse);

    expect(callsOf(calls, 'rotate')).toHaveLength(1);
    expect(callsOf(calls, 'ellipse')[0]?.args[4]).toBe(Math.PI / 6);
  });

  it('sem rotação, não chama rotate', () => {
    const { context, calls } = recordingContext();

    paintShapeLabel(context, rectangle({}));

    expect(callsOf(calls, 'rotate')).toEqual([]);
  });
});

describe('cache do layout por valor (US-SL.16)', () => {
  const scene = (label: ShapeLabel): ProjectedScene => ({
    items: [rectangle({}, { label })],
  });

  it('duas pinturas da mesma cena fazem um layout só', () => {
    const { context } = recordingContext();
    const projected = scene(LABEL);
    const before = shapeLabelLayoutCount();

    paintScene(context, projected);
    paintScene(context, projected);

    expect(shapeLabelLayoutCount() - before).toBe(1);
  });

  it('uma cópia do label com os mesmos valores também não refaz o layout', () => {
    const { context } = recordingContext();
    paintScene(context, scene(LABEL));
    const before = shapeLabelLayoutCount();

    paintScene(context, scene({ ...LABEL }));

    expect(shapeLabelLayoutCount() - before).toBe(0);
  });

  it('muda o texto, a fonte, o alinhamento horizontal ou a largura da área: refaz', () => {
    const { context } = recordingContext();
    paintScene(context, scene(LABEL));
    const base = shapeLabelLayoutCount();

    paintScene(context, scene({ ...LABEL, text: 'Outro' }));
    paintScene(context, scene({ ...LABEL, fontSize: 20 }));
    paintScene(context, scene({ ...LABEL, textAlign: 'left' }));
    paintItem(context, rectangle({}, { width: 300 }));

    expect(shapeLabelLayoutCount() - base).toBe(4);
  });

  it('verticalAlign e cor não entram na chave: só mudam a posição e a tinta', () => {
    const { context } = recordingContext();
    paintScene(context, scene(LABEL));
    const base = shapeLabelLayoutCount();

    paintScene(context, scene({ ...LABEL, verticalAlign: 'top', color: '#ff0000' }));

    expect(shapeLabelLayoutCount() - base).toBe(0);
  });
});

describe('o cache sobrevive ao que refaz o documento (US-SL.16)', () => {
  /** Uma seção com três formas com texto, como a cena do benchmark em miniatura. */
  function labeledSection() {
    const section = createCanvasSection();
    for (let i = 0; i < 3; i += 1) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `s${i}`,
          type: 'rectangle',
          x: i * 300,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          style: FILLED,
          label: { text: `Texto ${i}` },
        },
      });
    }
    return section;
  }

  it('replaceDocument com o mesmo conteúdo (o update remoto) não refaz nenhum layout', () => {
    const { context } = recordingContext();
    const section = labeledSection();
    paintScene(context, projectScene(section.getSnapshot()));
    const before = shapeLabelLayoutCount();
    expect(before).toBe(3);

    const copy = structuredClone(section.getSnapshot().document);
    expect(section.replaceDocument(copy).ok).toBe(true);
    paintScene(context, projectScene(section.getSnapshot()));

    expect(shapeLabelLayoutCount() - before).toBe(0);
  });

  it('um quadro de arrasto, que só muda x e y na prévia, não refaz layout', () => {
    const { context } = recordingContext();
    const section = labeledSection();
    const { document } = section.getSnapshot();
    paintScene(context, projectScene(document));
    const before = shapeLabelLayoutCount();

    const moved: Record<string, ShapeNode> = {};
    for (const node of Object.values(document.nodes)) {
      if (node.type === 'rectangle') moved[node.id] = { ...node, x: node.x + 25 };
    }
    paintScene(
      context,
      projectScene(document, { preview: { updates: moved, additions: [], marquee: null } }),
    );

    expect(shapeLabelLayoutCount() - before).toBe(0);
  });

  it('só o texto que mudou refaz o layout', () => {
    const { context } = recordingContext();
    const section = labeledSection();
    paintScene(context, projectScene(section.getSnapshot()));
    const before = shapeLabelLayoutCount();

    section.dispatch({ type: 'shape.update', id: 's1', patch: { label: { text: 'Mudou' } } });
    paintScene(context, projectScene(section.getSnapshot()));

    expect(shapeLabelLayoutCount() - before).toBe(1);
  });
});

describe('tipos: área e cor aceitam o Renderable sem cast (US-SL.4)', () => {
  it('shapeLabelArea e shapeLabelColor leem um RenderableRectangle', () => {
    const item = rectangle({});

    expect(shapeLabelArea(item)).toEqual({ x: 8, y: 8, width: 184, height: 84 });
    expect(shapeLabelColor(item)).toBe('#1f2937');
  });
});
