import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { shapeBounds } from './geometry/bounds.js';
import { shapeOutline, worldShapeOutline } from './geometry/outline.js';
import type { CrossNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

function addCross(section: CanvasSectionApi, extra: Record<string, unknown> = {}): CrossNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'cross-1',
      type: 'cross',
      x: 10,
      y: 20,
      width: 120,
      height: 90,
      rotation: 0,
      ...extra,
    } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['cross-1'] as CrossNode;
}

const FILLED = { fill: '#ff8800', stroke: '#000000', strokeWidth: 2, opacity: 1 };
const HOLLOW = { fill: null, stroke: '#000000', strokeWidth: 4, opacity: 1 };

describe('CrossNode', () => {
  it('cria com braço de 1/3 e o estilo padrão das figuras fechadas', () => {
    const section = newSection();
    const node = addCross(section);

    expect(node).toMatchObject({
      type: 'cross',
      armRatio: 1 / 3,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
  });

  it('guarda o armRatio dado e aceita os dois extremos da faixa', () => {
    const section = newSection();
    expect(addCross(section, { armRatio: 0.05 }).armRatio).toBe(0.05);
    section.dispatch({ type: 'shape.remove', id: 'cross-1' });
    expect(addCross(section, { armRatio: 1 }).armRatio).toBe(1);
  });

  it.each([
    ['abaixo do mínimo', 0.04, 'range'],
    ['acima de 1', 1.01, 'range'],
    ['negativo', -0.2, 'range'],
    ['não finito', Number.NaN, 'finite'],
    ['texto', '0.5', 'type'],
  ])('recusa armRatio %s na criação, sem alterar o documento', (_label, armRatio, rule) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'cross-1',
        type: 'cross',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        armRatio,
      } as never,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { issues: [{ path: ['shape', 'armRatio'], rule }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa campo de outra figura na criação', () => {
    const section = newSection();
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'cross',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        sides: 5,
      } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['shape', 'sides'], rule: 'unknown-field' }] } },
    });
  });

  it('atualiza armRatio, geometria e estilo, e desfaz e refaz', () => {
    const section = newSection();
    addCross(section);

    const updated = section.dispatch({
      type: 'shape.update',
      id: 'cross-1',
      patch: { armRatio: 0.5, width: 200, style: { fill: '#ef4444' } },
    });
    expect(updated.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['cross-1']).toMatchObject({
      armRatio: 0.5,
      width: 200,
      height: 90,
      style: { fill: '#ef4444' },
    });

    section.undo();
    expect(section.getSnapshot().document.nodes['cross-1']).toMatchObject({
      armRatio: 1 / 3,
      width: 120,
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['cross-1']).toMatchObject({
      armRatio: 0.5,
      width: 200,
    });
  });

  it('um patch de estilo não mexe no armRatio', () => {
    const section = newSection();
    addCross(section, { armRatio: 0.4 });
    section.dispatch({ type: 'shape.update', id: 'cross-1', patch: { style: { strokeWidth: 3 } } });
    expect(section.getSnapshot().document.nodes['cross-1']).toMatchObject({ armRatio: 0.4 });
  });

  it('recusa armRatio fora da faixa no patch e campo de outro tipo, sem mudar o documento', () => {
    const section = newSection();
    addCross(section);
    const before = section.getSnapshot();

    expect(
      section.dispatch({ type: 'shape.update', id: 'cross-1', patch: { armRatio: 2 } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'armRatio'], rule: 'range' }] } },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'cross-1', patch: { sides: 6 } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'sides'], rule: 'unknown-field' }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa armRatio em figura que não é cruz', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'r', patch: { armRatio: 0.5 } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'armRatio'], rule: 'unknown-field' }] } },
    });
  });

  it('round-trip pelo documento preserva a cruz e a carga recusa armRatio inválido', () => {
    const section = newSection();
    addCross(section, { armRatio: 0.25, rotation: 0.5 });

    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['cross-1']).toMatchObject({
      type: 'cross',
      armRatio: 0.25,
      rotation: 0.5,
    });

    doc.nodes['cross-1']!['armRatio'] = 3;
    const broken = newSection();
    expect(broken.replaceDocument(doc)).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [
            expect.objectContaining({ path: ['nodes', 'cross-1', 'armRatio'], rule: 'range' }),
          ],
        },
      },
    });

    delete doc.nodes['cross-1']!['armRatio'];
    expect(newSection().replaceDocument(doc)).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [expect.objectContaining({ path: ['nodes', 'cross-1', 'armRatio'] })],
        },
      },
    });
  });

  it('aceita a cruz como preview', () => {
    const section = newSection();
    const result = section.setPreview({
      additions: [{ id: 'p', type: 'cross', x: 0, y: 0, width: 40, height: 40, rotation: 0 }],
    });
    expect(result.ok).toBe(true);
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'cross', id: 'p' });
  });
});

describe('contorno da cruz', () => {
  const base = { type: 'cross', rotation: 0 } as const;

  it('tem 12 vértices, no sentido horário, a partir do topo do braço vertical', () => {
    // t = 1/3 × min(120, 90) = 30; centro (70, 65); meia espessura 15.
    expect(
      shapeOutline({ ...base, x: 10, y: 20, width: 120, height: 90, armRatio: 1 / 3 }),
    ).toEqual([
      { x: 55, y: 20 },
      { x: 85, y: 20 },
      { x: 85, y: 50 },
      { x: 130, y: 50 },
      { x: 130, y: 80 },
      { x: 85, y: 80 },
      { x: 85, y: 110 },
      { x: 55, y: 110 },
      { x: 55, y: 80 },
      { x: 10, y: 80 },
      { x: 10, y: 50 },
      { x: 55, y: 50 },
    ]);
  });

  it('a espessura do braço acompanha o lado menor, também com a caixa em pé', () => {
    const vertices = shapeOutline({ ...base, x: 0, y: 0, width: 60, height: 200, armRatio: 0.5 });
    // t = 0,5 × 60 = 30; centro (30, 100).
    expect(vertices[0]).toEqual({ x: 15, y: 0 });
    expect(vertices[1]).toEqual({ x: 45, y: 0 });
    expect(vertices[2]).toEqual({ x: 45, y: 85 });
    expect(vertices[3]).toEqual({ x: 60, y: 85 });
  });

  it('com armRatio 1 os vértices ficam todos na borda da caixa', () => {
    const vertices = shapeOutline({ ...base, x: 0, y: 0, width: 100, height: 40, armRatio: 1 });
    for (const v of vertices) {
      expect(v.x === 0 || v.x === 100 || v.y === 0 || v.y === 40).toBe(true);
    }
  });

  it('gira o contorno em torno do centro da caixa', () => {
    const node = { ...base, x: 0, y: 0, width: 100, height: 100, armRatio: 0.2 };
    const turned = worldShapeOutline({ ...node, rotation: Math.PI / 2 });
    const local = shapeOutline(node);
    // Um quarto de volta no sentido horário leva (x, y) a (100 − y, x).
    local.forEach((p, i) => {
      expect(turned[i]!.x).toBeCloseTo(100 - p.y, 9);
      expect(turned[i]!.y).toBeCloseTo(p.x, 9);
    });
  });

  it('os limites cobrem o contorno girado mais meio traço', () => {
    const node: CrossNode = {
      id: 'c',
      type: 'cross',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: Math.PI / 4,
      armRatio: 0.2,
      visible: true,
      locked: false,
      style: { ...FILLED, strokeWidth: 0 },
    };
    const bounds = shapeBounds(node);
    // Os cantos da ponta de um braço ficam a (±10, ±50) do centro; girados 45°, o alcance em cada
    // eixo é (10 + 50) / √2, e não a metade da diagonal da caixa.
    expect(bounds.width).toBeCloseTo((2 * 60) / Math.SQRT2, 9);
    expect(bounds.height).toBeCloseTo((2 * 60) / Math.SQRT2, 9);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(50, 9);
  });
});

describe('hit-test e marquee da cruz (contorno côncavo)', () => {
  function sectionWith(style: Record<string, unknown>, rotation = 0): CanvasSectionApi {
    const section = newSection();
    addCross(section, { x: 0, y: 0, width: 90, height: 90, rotation, armRatio: 1 / 3, style });
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

  it('atinge o centro e as pontas dos braços, mas não os cantos vazios da caixa', () => {
    const section = sectionWith(FILLED);
    expect(hit(section, 45, 45)).toBe('cross-1');
    expect(hit(section, 45, 3)).toBe('cross-1');
    expect(hit(section, 87, 45)).toBe('cross-1');
    expect(hit(section, 5, 5)).toBeUndefined();
    expect(hit(section, 85, 85)).toBeUndefined();
    expect(hit(section, 5, 85)).toBeUndefined();
    expect(hit(section, 85, 5)).toBeUndefined();
  });

  it('com rotação, o canto vazio segue o contorno girado', () => {
    const section = sectionWith(FILLED, Math.PI / 4);
    // Girada 45°, a ponta do braço de cima sai pela diagonal; o centro continua atingido.
    expect(hit(section, 45, 45)).toBe('cross-1');
    // O ponto (45, 3) era a ponta do braço de cima sem rotação: agora está no vazio entre braços.
    expect(hit(section, 45, 3)).toBeUndefined();
    // Sobre a diagonal, a ponta girada está a ~38 do centro em cada eixo.
    expect(hit(section, 45 + 30, 45 - 30)).toBe('cross-1');
  });

  it('sem preenchimento só atinge a faixa do traço', () => {
    const section = sectionWith(HOLLOW);
    // O miolo do cruzamento está vazio.
    expect(hit(section, 45, 45)).toBeUndefined();
    // Sobre a aresta do braço de cima (x = 30).
    expect(hit(section, 30, 15)).toBe('cross-1');
    // Dentro do braço, longe das arestas.
    expect(hit(section, 45, 10)).toBeUndefined();
  });

  it('marquee por interseção ignora o canto vazio e pega o braço e o traço', () => {
    const filled = sectionWith(FILLED);
    expect(marquee(filled, 0, 0, 20, 20, 'intersect')).toEqual([]);
    expect(marquee(filled, 35, 0, 20, 20, 'intersect')).toEqual(['cross-1']);
    // Um retângulo dentro do cruzamento toca a área preenchida.
    expect(marquee(filled, 40, 40, 10, 10, 'intersect')).toEqual(['cross-1']);
    // Um retângulo que só cobre o canto vazio, mas encosta no recorte do braço, seleciona.
    expect(marquee(filled, 0, 0, 31, 31, 'intersect')).toEqual(['cross-1']);

    const hollow = sectionWith(HOLLOW);
    // Dentro do cruzamento, sem encostar no traço: nada pintado.
    expect(marquee(hollow, 40, 40, 10, 10, 'intersect')).toEqual([]);
    // Cobrindo um vértice do traço.
    expect(marquee(hollow, 25, 25, 10, 10, 'intersect')).toEqual(['cross-1']);
    // Dentro de um braço, sem encostar nas arestas.
    expect(marquee(hollow, 40, 5, 10, 10, 'intersect')).toEqual([]);
  });

  it('marquee por contenção usa a caixa dos limites', () => {
    const section = sectionWith(FILLED);
    expect(marquee(section, -5, -5, 100, 100, 'contain')).toEqual(['cross-1']);
    expect(marquee(section, 0, 0, 80, 80, 'contain')).toEqual([]);
  });
});
