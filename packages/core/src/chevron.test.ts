import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { shapeBounds } from './geometry/bounds.js';
import { shapeOutline, worldShapeOutline } from './geometry/outline.js';
import type { ChevronNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

function addChevron(section: CanvasSectionApi, extra: Record<string, unknown> = {}): ChevronNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'chev-1',
      type: 'chevron',
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 0,
      ...extra,
    } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['chev-1'] as ChevronNode;
}

const FILLED = { fill: '#3b82f6', stroke: '#000000', strokeWidth: 2, opacity: 1 };
const HOLLOW = { fill: null, stroke: '#000000', strokeWidth: 4, opacity: 1 };

describe('ChevronNode', () => {
  it('cria apontando para a direita, com entalhe de 0,25 e o estilo padrão', () => {
    const node = addChevron(newSection());
    expect(node).toMatchObject({
      type: 'chevron',
      direction: 'right',
      notchDepth: 0.25,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
  });

  it('guarda a direção e a profundidade dadas, inclusive os extremos da faixa', () => {
    const section = newSection();
    expect(addChevron(section, { direction: 'up', notchDepth: 0 })).toMatchObject({
      direction: 'up',
      notchDepth: 0,
    });
    section.dispatch({ type: 'shape.remove', id: 'chev-1' });
    expect(addChevron(section, { direction: 'left', notchDepth: 0.5 })).toMatchObject({
      direction: 'left',
      notchDepth: 0.5,
    });
  });

  it.each([
    ['direction', 'diagonal', 'format'],
    ['direction', 3, 'format'],
    ['notchDepth', 0.51, 'range'],
    ['notchDepth', -0.01, 'range'],
    ['notchDepth', Number.NaN, 'finite'],
    ['notchDepth', '0.2', 'type'],
  ])('recusa %s = %s na criação, sem alterar o documento', (field, value, rule) => {
    const section = newSection();
    const before = section.getSnapshot();
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'chevron',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        [field]: value,
      } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { issues: [{ path: ['shape', field], rule }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa campo de outra figura', () => {
    const section = newSection();
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'chevron',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          armRatio: 0.5,
        } as never,
      }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['shape', 'armRatio'], rule: 'unknown-field' }] } },
    });
  });

  it('mudar a direção preserva a caixa, e o patch desfaz e refaz', () => {
    const section = newSection();
    addChevron(section);

    expect(
      section.dispatch({
        type: 'shape.update',
        id: 'chev-1',
        patch: { direction: 'down', notchDepth: 0.4, style: { fill: '#ef4444' } },
      }).ok,
    ).toBe(true);
    expect(section.getSnapshot().document.nodes['chev-1']).toMatchObject({
      direction: 'down',
      notchDepth: 0.4,
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      style: { fill: '#ef4444' },
    });

    section.undo();
    expect(section.getSnapshot().document.nodes['chev-1']).toMatchObject({
      direction: 'right',
      notchDepth: 0.25,
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['chev-1']).toMatchObject({
      direction: 'down',
      notchDepth: 0.4,
    });
  });

  it('um patch só de estilo não mexe na direção nem no entalhe', () => {
    const section = newSection();
    addChevron(section, { direction: 'left', notchDepth: 0.3 });
    section.dispatch({ type: 'shape.update', id: 'chev-1', patch: { style: { strokeWidth: 3 } } });
    expect(section.getSnapshot().document.nodes['chev-1']).toMatchObject({
      direction: 'left',
      notchDepth: 0.3,
    });
  });

  it('recusa valores inválidos no patch e campo de outro tipo, sem mudar o documento', () => {
    const section = newSection();
    addChevron(section);
    const before = section.getSnapshot();

    expect(
      section.dispatch({ type: 'shape.update', id: 'chev-1', patch: { notchDepth: 1 } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'notchDepth'], rule: 'range' }] } },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'chev-1', patch: { direction: 'x' as never } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'direction'], rule: 'format' }] } },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'chev-1', patch: { armRatio: 0.5 } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'armRatio'], rule: 'unknown-field' }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa direction e notchDepth em figura que não é chevron', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'r', patch: { direction: 'left' } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'direction'], rule: 'unknown-field' }] } },
    });
  });

  it('round-trip pelo documento e recusa de campos inválidos na carga', () => {
    const section = newSection();
    addChevron(section, { direction: 'up', notchDepth: 0.1, rotation: 0.5 });
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };

    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['chev-1']).toMatchObject({
      type: 'chevron',
      direction: 'up',
      notchDepth: 0.1,
      rotation: 0.5,
    });

    doc.nodes['chev-1']!['notchDepth'] = 0.9;
    expect(newSection().replaceDocument(doc)).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [
            expect.objectContaining({ path: ['nodes', 'chev-1', 'notchDepth'], rule: 'range' }),
          ],
        },
      },
    });
    doc.nodes['chev-1']!['notchDepth'] = 0.1;
    doc.nodes['chev-1']!['direction'] = 'sideways';
    expect(newSection().replaceDocument(doc)).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [
            expect.objectContaining({ path: ['nodes', 'chev-1', 'direction'], rule: 'format' }),
          ],
        },
      },
    });
  });

  it('aceita o chevron como preview', () => {
    const section = newSection();
    expect(
      section.setPreview({
        additions: [
          {
            id: 'p',
            type: 'chevron',
            x: 0,
            y: 0,
            width: 40,
            height: 40,
            rotation: 0,
            direction: 'left',
          },
        ],
      }).ok,
    ).toBe(true);
    expect(section.getPreview()?.additions[0]).toMatchObject({
      type: 'chevron',
      direction: 'left',
    });
  });
});

describe('contorno do chevron', () => {
  const base = { type: 'chevron', x: 10, y: 20, width: 100, height: 60, rotation: 0 } as const;

  it('direita: ponta na borda leste e entalhe na oeste, em sentido horário', () => {
    expect(shapeOutline({ ...base, direction: 'right', notchDepth: 0.25 })).toEqual([
      { x: 10, y: 20 },
      { x: 85, y: 20 },
      { x: 110, y: 50 },
      { x: 85, y: 80 },
      { x: 10, y: 80 },
      { x: 35, y: 50 },
    ]);
  });

  it('esquerda: o espelho, com a profundidade medida na largura', () => {
    expect(shapeOutline({ ...base, direction: 'left', notchDepth: 0.25 })).toEqual([
      { x: 85, y: 50 },
      { x: 110, y: 80 },
      { x: 35, y: 80 },
      { x: 10, y: 50 },
      { x: 35, y: 20 },
      { x: 110, y: 20 },
    ]);
  });

  it('para baixo: a profundidade é medida na altura', () => {
    expect(shapeOutline({ ...base, direction: 'down', notchDepth: 0.25 })).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 35 },
      { x: 110, y: 20 },
      { x: 110, y: 65 },
      { x: 60, y: 80 },
      { x: 10, y: 65 },
    ]);
  });

  it('para cima: ponta na borda norte', () => {
    expect(shapeOutline({ ...base, direction: 'up', notchDepth: 0.25 })).toEqual([
      { x: 60, y: 20 },
      { x: 110, y: 35 },
      { x: 110, y: 80 },
      { x: 60, y: 65 },
      { x: 10, y: 80 },
      { x: 10, y: 35 },
    ]);
  });

  it('com profundidade zero os vértices ficam nos lados da caixa', () => {
    const vertices = shapeOutline({ ...base, direction: 'right', notchDepth: 0 });
    for (const v of vertices) {
      expect(v.x === 10 || v.x === 110 || v.y === 20 || v.y === 80).toBe(true);
    }
  });

  it('gira o contorno em torno do centro da caixa', () => {
    const node = { ...base, x: 0, y: 0, width: 100, height: 100 } as const;
    const chevron = { ...node, direction: 'right', notchDepth: 0.25 } as const;
    const turned = worldShapeOutline({ ...chevron, rotation: Math.PI / 2 });
    shapeOutline(chevron).forEach((p, i) => {
      expect(turned[i]!.x).toBeCloseTo(100 - p.y, 9);
      expect(turned[i]!.y).toBeCloseTo(p.x, 9);
    });
  });

  it('os limites seguem o contorno girado', () => {
    const node: ChevronNode = {
      id: 'c',
      type: 'chevron',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: Math.PI / 2,
      direction: 'right',
      notchDepth: 0.25,
      visible: true,
      locked: false,
      style: { ...FILLED, strokeWidth: 0 },
    };
    const bounds = shapeBounds(node);
    expect(bounds.x).toBeCloseTo(0, 9);
    expect(bounds.width).toBeCloseTo(100, 9);
  });
});

describe('hit-test e marquee do chevron (contorno côncavo)', () => {
  function sectionWith(
    style: Record<string, unknown>,
    direction = 'right',
    rotation = 0,
  ): CanvasSectionApi {
    const section = newSection();
    addChevron(section, {
      x: 0,
      y: 0,
      width: 90,
      height: 90,
      rotation,
      direction,
      notchDepth: 0.25,
      style,
    });
    return section;
  }
  const hit = (section: CanvasSectionApi, x: number, y: number): string | undefined =>
    section.hitTest({ x, y }, { includePreview: false, tolerance: 0 });
  const marquee = (
    section: CanvasSectionApi,
    x: number,
    y: number,
    w: number,
    h: number,
    mode: string,
  ) =>
    section.queryMarquee(
      { x, y, width: w, height: h },
      { includePreview: false, mode: mode as 'intersect' },
    );

  it('atinge o corpo e a ponta, mas não o entalhe nem os cantos fora da ponta', () => {
    const section = sectionWith(FILLED);
    expect(hit(section, 10, 10)).toBe('chev-1');
    expect(hit(section, 85, 45)).toBe('chev-1');
    // O entalhe da borda oeste está vazio.
    expect(hit(section, 10, 45)).toBeUndefined();
    // Os cantos leste ficam fora da ponta.
    expect(hit(section, 85, 5)).toBeUndefined();
    expect(hit(section, 85, 85)).toBeUndefined();
  });

  it('para baixo, o entalhe fica na borda norte e a ponta na sul', () => {
    const section = sectionWith(FILLED, 'down');
    expect(hit(section, 45, 5)).toBeUndefined();
    expect(hit(section, 5, 5)).toBe('chev-1');
    expect(hit(section, 45, 85)).toBe('chev-1');
    expect(hit(section, 5, 85)).toBeUndefined();
  });

  it('com rotação, o vazio acompanha o contorno girado', () => {
    // Girado meia volta, a ponta passa para a borda oeste e o entalhe para a leste.
    const section = sectionWith(FILLED, 'right', Math.PI);
    expect(hit(section, 5, 45)).toBe('chev-1');
    expect(hit(section, 80, 45)).toBeUndefined();
  });

  it('sem preenchimento só atinge a faixa do traço', () => {
    const section = sectionWith(HOLLOW);
    expect(hit(section, 30, 45)).toBeUndefined();
    // Sobre a aresta superior.
    expect(hit(section, 30, 1)).toBe('chev-1');
  });

  it('marquee por interseção ignora o entalhe e pega o corpo', () => {
    const filled = sectionWith(FILLED);
    expect(marquee(filled, 0, 40, 8, 10, 'intersect')).toEqual([]);
    expect(marquee(filled, 0, 0, 8, 8, 'intersect')).toEqual(['chev-1']);
    expect(marquee(filled, 40, 40, 10, 10, 'intersect')).toEqual(['chev-1']);

    const hollow = sectionWith(HOLLOW);
    // Dentro do corpo, longe das arestas.
    expect(marquee(hollow, 30, 30, 5, 5, 'intersect')).toEqual([]);
    // Cobrindo a aresta de cima.
    expect(marquee(hollow, 30, 0, 5, 5, 'intersect')).toEqual(['chev-1']);
  });

  it('marquee por contenção usa a caixa dos limites', () => {
    const section = sectionWith(FILLED);
    expect(marquee(section, -5, -5, 100, 100, 'contain')).toEqual(['chev-1']);
    expect(marquee(section, 0, 0, 80, 80, 'contain')).toEqual([]);
  });
});
