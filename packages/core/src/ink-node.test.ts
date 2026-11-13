import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { appendInkStroke, INK_LIMITS } from './ink.js';
import type { InkNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

const WORLD = [
  { x: 10, y: 10 },
  { x: 60, y: 40 },
];

function addInk(section: CanvasSectionApi, extra: Record<string, unknown> = {}): InkNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id: 'ink-1', type: 'ink', strokes: [{ points: WORLD }], ...extra } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['ink-1'] as InkNode;
}

const node = (section: CanvasSectionApi): InkNode =>
  section.getSnapshot().document.nodes['ink-1'] as InkNode;

function issuesOf(result: { ok: boolean }): Array<{ path: unknown[]; rule: string }> {
  const failed = result as unknown as {
    error: { details: { issues: Array<{ path: unknown[]; rule: string }> } };
  };
  return failed.error.details.issues;
}

describe('InkNode: criação', () => {
  it('a partir de pontos de mundo calcula a caixa, normaliza e aplica os padrões', () => {
    const created = addInk(newSection());
    expect(created).toMatchObject({
      type: 'ink',
      x: 8,
      y: 8,
      width: 54,
      height: 34,
      rotation: 0,
      visible: true,
      locked: false,
      style: { opacity: 1 },
    });
    expect(created.strokes).toHaveLength(1);
    expect(created.strokes[0]).toMatchObject({ color: '#1f2937', kind: 'pen', width: 'medium' });
    expect(created.strokes[0]!.points).toEqual([
      { x: 2 / 54, y: 2 / 34 },
      { x: 52 / 54, y: 32 / 34 },
    ]);
  });

  it('guarda cor, tipo, espessura e opacidade dados, com a cor em minúsculas', () => {
    const created = addInk(newSection(), {
      strokes: [{ points: WORLD, color: '#EF4444', kind: 'highlighter', width: 'thick' }],
      style: { opacity: 0.5 },
      metadata: { 'app:a': 1 },
    });
    expect(created.strokes[0]).toMatchObject({
      color: '#ef4444',
      kind: 'highlighter',
      width: 'thick',
    });
    expect(created.style.opacity).toBe(0.5);
    expect(created.metadata).toEqual({ 'app:a': 1 });
    // Marca-texto grosso: margem de 12.
    expect(created.x).toBe(-2);
  });

  it('um pingo (um ponto) cria um elemento com caixa válida', () => {
    const created = addInk(newSection(), { strokes: [{ points: [{ x: 5, y: 5 }] }] });
    expect(created.width).toBeGreaterThanOrEqual(1);
    expect(created.height).toBeGreaterThanOrEqual(1);
    expect(created.strokes[0]!.points).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('com caixa explícita, os pontos já são locais e a rotação vale', () => {
    const created = addInk(newSection(), {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0.4,
      strokes: [{ points: [{ x: 0.1, y: 0.9 }] }],
    });
    expect(created).toMatchObject({ x: 10, y: 20, width: 100, height: 50, rotation: 0.4 });
    expect(created.strokes[0]!.points).toEqual([{ x: 0.1, y: 0.9 }]);
    expect(created.strokes[0]!.kind).toBe('pen');
  });

  it('recusa caixa pela metade, rotação sem caixa e campos de outras figuras', () => {
    const section = newSection();
    const partial = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ink', x: 0, strokes: [{ points: WORLD }] } as never,
    });
    expect(partial.ok).toBe(false);
    const rotated = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ink', rotation: 1, strokes: [{ points: WORLD }] } as never,
    });
    expect(issuesOf(rotated)).toContainEqual(
      expect.objectContaining({ path: ['shape', 'rotation'], rule: 'invalid-geometry' }),
    );
    const other = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ink', fill: '#fff', strokes: [{ points: WORLD }] } as never,
    });
    expect(issuesOf(other)).toContainEqual(
      expect.objectContaining({ path: ['shape', 'fill'], rule: 'unknown-field' }),
    );
    const styled = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ink', style: { fill: '#fff' }, strokes: [{ points: WORLD }] } as never,
    });
    expect(issuesOf(styled)).toContainEqual(
      expect.objectContaining({ path: ['shape', 'style', 'fill'], rule: 'unknown-field' }),
    );
  });

  it('recusa pontos de mundo tão distantes que a caixa não cabe', () => {
    const result = newSection().dispatch({
      type: 'shape.create',
      shape: {
        type: 'ink',
        strokes: [
          {
            points: [
              { x: -1.7e308, y: 0 },
              { x: 1.7e308, y: 0 },
            ],
          },
        ],
      } as never,
    });
    expect(result.ok).toBe(false);
  });
});

describe('InkNode: limites e validação', () => {
  const create = (strokes: unknown) =>
    newSection().dispatch({ type: 'shape.create', shape: { type: 'ink', strokes } as never });
  const points = (count: number) => Array.from({ length: count }, (_, i) => ({ x: i, y: 0 }));

  it('exige de 1 a 500 traços', () => {
    expect(issuesOf(create([]))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes'], rule: 'range' }),
    );
    expect(create(Array.from({ length: 500 }, () => ({ points: [{ x: 0, y: 0 }] }))).ok).toBe(true);
    expect(
      issuesOf(create(Array.from({ length: 501 }, () => ({ points: points(1) })))),
    ).toContainEqual(expect.objectContaining({ path: ['shape', 'strokes'], rule: 'range' }));
    expect(issuesOf(create('x'))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes'], rule: 'type' }),
    );
  });

  it('exige de 1 a 2.000 pontos por traço', () => {
    expect(create([{ points: points(2_000) }]).ok).toBe(true);
    expect(issuesOf(create([{ points: points(2_001) }]))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'points'], rule: 'range' }),
    );
    expect(issuesOf(create([{ points: [] }]))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'points'], rule: 'range' }),
    );
    expect(issuesOf(create([{ points: 3 }]))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'points'], rule: 'type' }),
    );
  });

  it('limita o total a 20.000 pontos', () => {
    const ok = Array.from({ length: 10 }, () => ({
      points: points(INK_LIMITS.maxPointsPerStroke),
    }));
    expect(create(ok).ok).toBe(true);
    const over = [...ok, { points: points(1) }];
    expect(issuesOf(create(over))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes'], rule: 'range' }),
    );
  });

  it('recusa cor, tipo e espessura inválidos no caminho do traço', () => {
    const result = create([
      { points: points(1), color: 'red', kind: 'brush', width: 'huge' },
      { points: [{ x: 'a', y: 0 }] },
      { points: [{ x: 0, y: 0, z: 1 }] },
      7,
    ]);
    const issues = issuesOf(result);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'color'], rule: 'format' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'kind'], rule: 'format' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'width'], rule: 'format' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 1, 'points', 0, 'x'], rule: 'type' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: ['shape', 'strokes', 2, 'points', 0, 'z'],
        rule: 'unknown-field',
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 3], rule: 'type' }),
    );
  });

  it('uma cor nula é recusada (o traço sempre tem cor)', () => {
    expect(issuesOf(create([{ points: points(1), color: null }]))).toContainEqual(
      expect.objectContaining({ path: ['shape', 'strokes', 0, 'color'], rule: 'type' }),
    );
  });

  it('aceita cor com alfa', () => {
    expect(create([{ points: points(1), color: '#11223380' }]).ok).toBe(true);
  });

  it('o limite de coordenadas do canvas vale para a caixa', () => {
    const section = createCanvasSection({ limits: { maxCoordinate: 100 } });
    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'ink', strokes: [{ points: [{ x: 500, y: 0 }] }] } as never,
    });
    expect(result.ok).toBe(false);
  });
});

describe('InkNode: patch', () => {
  it('mover, redimensionar e rotacionar não mexem nos pontos locais', () => {
    const section = newSection();
    const created = addInk(section);
    expect(
      section.dispatch({
        type: 'shape.update',
        id: 'ink-1',
        patch: { x: 100, y: 100, width: 200, height: 80, rotation: 0.5 },
      }).ok,
    ).toBe(true);
    expect(node(section)).toMatchObject({ x: 100, y: 100, width: 200, height: 80, rotation: 0.5 });
    expect(node(section).strokes).toEqual(created.strokes);
  });

  it('opacidade é o único estilo; fill e stroke são recusados', () => {
    const section = newSection();
    addInk(section);
    expect(
      section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { style: { opacity: 0.3 } } })
        .ok,
    ).toBe(true);
    expect(node(section).style).toEqual({ opacity: 0.3 });
    const bad = section.dispatch({
      type: 'shape.update',
      id: 'ink-1',
      patch: { style: { stroke: '#000000' } },
    });
    expect(issuesOf(bad)).toContainEqual(
      expect.objectContaining({ path: ['patch', 'style', 'stroke'], rule: 'unknown-field' }),
    );
  });

  it('strokes substitui a lista inteira, e a lista vazia ou fora de [0, 1] é recusada', () => {
    const section = newSection();
    addInk(section);
    const replacement = [
      { points: [{ x: 0.5, y: 0.5 }], color: '#3b82f6', kind: 'marker', width: 'thin' },
    ];
    expect(
      section.dispatch({
        type: 'shape.update',
        id: 'ink-1',
        patch: { strokes: replacement } as never,
      }).ok,
    ).toBe(true);
    expect(node(section).strokes).toEqual(replacement);

    const empty = section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { strokes: [] } });
    expect(issuesOf(empty)).toContainEqual(
      expect.objectContaining({ path: ['patch', 'strokes'], rule: 'range' }),
    );
    const outside = section.dispatch({
      type: 'shape.update',
      id: 'ink-1',
      patch: {
        strokes: [{ ...replacement[0], points: [{ x: 0.2, y: 1.2 }] }],
      } as never,
    });
    expect(issuesOf(outside)).toContainEqual(
      expect.objectContaining({ path: ['patch', 'strokes', 0, 'points', 0, 'y'], rule: 'range' }),
    );
  });

  it('o patch strokes não aceita os campos que só a entrada de criação aceita sem cor', () => {
    const section = newSection();
    addInk(section);
    const result = section.dispatch({
      type: 'shape.update',
      id: 'ink-1',
      patch: { strokes: [{ points: [{ x: 0, y: 0 }] }] } as never,
    });
    // No patch os pontos são locais e cor, tipo e espessura são obrigatórios.
    expect(result.ok).toBe(false);
  });

  it('campo de outra figura no patch é recusado', () => {
    const section = newSection();
    addInk(section);
    const result = section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { text: 'x' } });
    expect(issuesOf(result)).toContainEqual(
      expect.objectContaining({ path: ['patch', 'text'], rule: 'unknown-field' }),
    );
  });
});

describe('InkNode: um traço por entrada de histórico', () => {
  function stroke(section: CanvasSectionApi, worldPoints: Array<{ x: number; y: number }>): void {
    const patch = appendInkStroke(node(section), {
      color: '#1f2937',
      kind: 'pen',
      width: 'medium',
      worldPoints,
    });
    expect(section.dispatch({ type: 'shape.update', id: 'ink-1', patch }).ok).toBe(true);
  }

  it('o primeiro traço cria o elemento e os seguintes o atualizam, cada um em uma entrada', () => {
    const section = newSection();
    addInk(section);
    const afterFirst = section.getSnapshot().revision;
    stroke(section, [{ x: 200, y: 200 }]);
    stroke(section, [{ x: -50, y: 30 }]);
    expect(node(section).strokes).toHaveLength(3);
    expect(section.getSnapshot().revision).toBe(afterFirst + 2);
  });

  it('desfazer remove o último traço, depois o anterior, e por fim o elemento; refazer restaura', () => {
    const section = newSection();
    addInk(section);
    const first = node(section);
    stroke(section, [{ x: 200, y: 200 }]);
    const second = node(section);
    stroke(section, [{ x: -50, y: 30 }]);
    const third = node(section);

    section.undo();
    expect(node(section)).toEqual(second);
    section.undo();
    expect(node(section)).toEqual(first);
    section.undo();
    expect(section.getSnapshot().document.nodes['ink-1']).toBeUndefined();

    section.redo();
    expect(node(section)).toEqual(first);
    section.redo();
    expect(node(section)).toEqual(second);
    section.redo();
    expect(node(section)).toEqual(third);
  });
});

describe('InkNode: carga do documento', () => {
  it('round-trip preserva o elemento', () => {
    const section = newSection();
    addInk(section, {
      strokes: [
        { points: WORLD, color: '#ec4899', kind: 'marker', width: 'thick' },
        { points: [{ x: 90, y: 90 }] },
      ],
    });
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as unknown;
    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['ink-1']).toEqual(node(section));
  });

  function documentWith(patch: (ink: Record<string, unknown>) => void): unknown {
    const section = newSection();
    addInk(section);
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    patch(doc.nodes['ink-1']!);
    return doc;
  }

  it.each([
    [
      'strokes ausente',
      (ink: Record<string, unknown>) => delete ink['strokes'],
      ['strokes'],
      'type',
    ],
    [
      'strokes vazio',
      (ink: Record<string, unknown>) => (ink['strokes'] = []),
      ['strokes'],
      'range',
    ],
    [
      'ponto fora de [0, 1]',
      (ink: Record<string, unknown>) =>
        (ink['strokes'] = [
          { points: [{ x: 1.5, y: 0 }], color: '#000000', kind: 'pen', width: 'thin' },
        ]),
      ['strokes', 0, 'points', 0, 'x'],
      'range',
    ],
    [
      'tipo desconhecido',
      (ink: Record<string, unknown>) =>
        (ink['strokes'] = [
          { points: [{ x: 0, y: 0 }], color: '#000000', kind: 'brush', width: 'thin' },
        ]),
      ['strokes', 0, 'kind'],
      'format',
    ],
    [
      'cor ausente',
      (ink: Record<string, unknown>) =>
        (ink['strokes'] = [{ points: [{ x: 0, y: 0 }], kind: 'pen', width: 'thin' }]),
      ['strokes', 0, 'color'],
      'type',
    ],
    ['largura da caixa', (ink: Record<string, unknown>) => (ink['width'] = 0), ['width'], 'range'],
    [
      'estilo com contorno',
      (ink: Record<string, unknown>) => (ink['style'] = { opacity: 1, stroke: '#000000' }),
      ['style', 'stroke'],
      'unknown-field',
    ],
  ])('recusa %s na carga, no caminho do campo', (_name, mutate, path, rule) => {
    const result = newSection().replaceDocument(documentWith(mutate));
    expect(result.ok).toBe(false);
    expect(issuesOf(result)).toContainEqual(
      expect.objectContaining({ path: ['nodes', 'ink-1', ...path], rule }),
    );
  });
});

describe('InkNode: preview', () => {
  it('aceita o traço em andamento como adição, em mundo e com caixa explícita', () => {
    const section = newSection();
    expect(
      section.setPreview({
        additions: [{ id: 'p', type: 'ink', strokes: [{ points: WORLD }] }],
      }).ok,
    ).toBe(true);
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'ink', id: 'p' });
    expect(
      section.setPreview({
        additions: [
          {
            id: 'q',
            type: 'ink',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
            strokes: [
              { points: [{ x: 0.5, y: 0.5 }], color: '#000000', kind: 'pen', width: 'thin' },
            ],
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it('aceita a geometria provisória de um elemento existente', () => {
    const section = newSection();
    const created = addInk(section);
    expect(
      section.setPreview({
        updates: [
          {
            id: 'ink-1',
            type: 'ink',
            x: created.x + 30,
            y: created.y,
            width: created.width,
            height: created.height,
            rotation: 0,
            strokes: created.strokes,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(section.getBounds(['ink-1'], { includePreview: true, stroke: false })?.x).toBe(
      created.x + 30,
    );
  });
});

describe('InkNode: consultas', () => {
  // Traço horizontal de (50, 100) a (250, 100), caneta média (espessura 4).
  function lineInk(section: CanvasSectionApi, extra: Record<string, unknown> = {}): void {
    addInk(section, {
      strokes: [
        {
          points: [
            { x: 50, y: 100 },
            { x: 250, y: 100 },
          ],
        },
      ],
      ...extra,
    });
  }
  const hit = (section: CanvasSectionApi, x: number, y: number, tolerance = 0) =>
    section.hitTest({ x, y }, { includePreview: false, tolerance });

  it('atinge a menos de meia espessura do traço e não atinge o vazio da caixa', () => {
    const section = newSection();
    lineInk(section);
    expect(hit(section, 150, 100)).toBe('ink-1');
    expect(hit(section, 150, 101.9)).toBe('ink-1');
    expect(hit(section, 150, 102.5)).toBeUndefined();
    // A caixa tem meia espessura de margem: fora do traço, ainda dentro dela, não atinge.
    expect(hit(section, 150, 101)).toBe('ink-1');
    expect(node(section).height).toBe(4);
  });

  it('a tolerância alarga o alcance', () => {
    const section = newSection();
    lineInk(section);
    expect(hit(section, 150, 105)).toBeUndefined();
    expect(hit(section, 150, 105, 4)).toBe('ink-1');
  });

  it('não atinge o vazio de uma caixa grande de traços afastados', () => {
    const section = newSection();
    addInk(section, {
      strokes: [{ points: [{ x: 0, y: 0 }] }, { points: [{ x: 200, y: 200 }] }],
    });
    expect(hit(section, 0, 0)).toBe('ink-1');
    expect(hit(section, 200, 200)).toBe('ink-1');
    expect(hit(section, 100, 100)).toBeUndefined();
    expect(hit(section, 0, 200)).toBeUndefined();
  });

  it('com rotação, o traço atingido é o girado', () => {
    const section = newSection();
    lineInk(section);
    // Gira 90° em torno do centro (150, 100): o traço fica vertical em x = 150, y de 0 a 200.
    section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { rotation: Math.PI / 2 } });
    expect(hit(section, 150, 20)).toBe('ink-1');
    expect(hit(section, 150, 180)).toBe('ink-1');
    expect(hit(section, 70, 100)).toBeUndefined();
  });

  it('um pingo é atingido num círculo da espessura', () => {
    const section = newSection();
    addInk(section, { strokes: [{ points: [{ x: 50, y: 50 }], kind: 'marker', width: 'thick' }] });
    expect(hit(section, 50, 50)).toBe('ink-1');
    expect(hit(section, 57, 50)).toBe('ink-1');
    expect(hit(section, 59, 50)).toBeUndefined();
  });

  it('o marquee por interseção pega o traço, e o vazio da caixa não', () => {
    const section = newSection();
    addInk(section, {
      strokes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
        },
        {
          points: [
            { x: 0, y: 200 },
            { x: 200, y: 200 },
          ],
        },
      ],
    });
    const marquee = (rect: { x: number; y: number; width: number; height: number }) =>
      section.queryMarquee(rect, { includePreview: false, mode: 'intersect' });
    expect(marquee({ x: 90, y: -5, width: 20, height: 10 })).toEqual(['ink-1']);
    expect(marquee({ x: 90, y: 195, width: 20, height: 10 })).toEqual(['ink-1']);
    // O meio da caixa, entre os dois traços, está vazio.
    expect(marquee({ x: 90, y: 90, width: 20, height: 20 })).toEqual([]);
  });

  it('o marquee por interseção segue a rotação e o por contenção usa a caixa', () => {
    const section = newSection();
    lineInk(section);
    section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { rotation: Math.PI / 2 } });
    expect(
      section.queryMarquee(
        { x: 145, y: 10, width: 10, height: 10 },
        { includePreview: false, mode: 'intersect' },
      ),
    ).toEqual(['ink-1']);
    expect(
      section.queryMarquee(
        { x: -1000, y: -1000, width: 3000, height: 3000 },
        { includePreview: false, mode: 'contain' },
      ),
    ).toEqual(['ink-1']);
    expect(
      section.queryMarquee(
        { x: 140, y: 0, width: 20, height: 50 },
        { includePreview: false, mode: 'contain' },
      ),
    ).toEqual([]);
  });

  it('o marquee por interseção pega o pingo e a junta entre trechos', () => {
    const section = newSection();
    addInk(section, {
      strokes: [
        { points: [{ x: 50, y: 50 }], kind: 'marker', width: 'thick' },
        {
          points: [
            { x: 120, y: 0 },
            { x: 120, y: 60 },
            { x: 180, y: 60 },
          ],
        },
      ],
    });
    const marquee = (x: number, y: number) =>
      section.queryMarquee(
        { x, y, width: 2, height: 2 },
        { includePreview: false, mode: 'intersect' },
      );
    expect(marquee(56, 49)).toEqual(['ink-1']);
    expect(marquee(119, 59)).toEqual(['ink-1']);
    expect(marquee(150, 59)).toEqual(['ink-1']);
    expect(marquee(150, 30)).toEqual([]);
  });

  it('um elemento oculto ou travado se comporta como as outras figuras', () => {
    const section = newSection();
    lineInk(section);
    section.dispatch({ type: 'shape.update', id: 'ink-1', patch: { visible: false } });
    expect(hit(section, 150, 100)).toBeUndefined();
  });
});
