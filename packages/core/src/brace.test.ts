import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { shapeBounds } from './geometry/bounds.js';
import type { BraceNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

function addBrace(section: CanvasSectionApi, extra: Record<string, unknown> = {}): BraceNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'brace-1',
      type: 'brace',
      x: 10,
      y: 20,
      width: 40,
      height: 160,
      rotation: 0,
      ...extra,
    } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['brace-1'] as BraceNode;
}

describe('BraceNode', () => {
  it('cria `{` com ponta no meio, curvatura 0,5 e o estilo padrão só de traço', () => {
    const node = addBrace(newSection());
    expect(node).toMatchObject({
      type: 'brace',
      orientation: 'left',
      tipPosition: 0.5,
      curvature: 0.5,
      visible: true,
      locked: false,
      style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
    });
    expect('fill' in node.style).toBe(false);
  });

  it('guarda os parâmetros dados, inclusive os extremos das faixas', () => {
    const section = newSection();
    expect(
      addBrace(section, {
        orientation: 'down',
        tipPosition: 0,
        curvature: 1,
        style: { strokeWidth: 3 },
      }),
    ).toMatchObject({
      orientation: 'down',
      tipPosition: 0,
      curvature: 1,
      style: { stroke: '#000000', strokeWidth: 3 },
    });
    section.dispatch({ type: 'shape.remove', id: 'brace-1' });
    expect(addBrace(section, { orientation: 'right', tipPosition: 1, curvature: 0 })).toMatchObject(
      {
        orientation: 'right',
        tipPosition: 1,
        curvature: 0,
      },
    );
  });

  it.each([
    ['orientation', 'diagonal', 'format'],
    ['orientation', 7, 'format'],
    ['tipPosition', 1.1, 'range'],
    ['tipPosition', -0.1, 'range'],
    ['curvature', 2, 'range'],
    ['curvature', Number.NaN, 'finite'],
    ['curvature', '0.5', 'type'],
  ])('recusa %s = %s na criação, sem alterar o documento', (field, value, rule) => {
    const section = newSection();
    const before = section.getSnapshot();
    const result = section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'brace',
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
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: ['shape', field], rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa preenchimento e campos de outras figuras', () => {
    const section = newSection();
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'brace',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          style: { fill: '#ffffff' },
        } as never,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        details: { issues: [{ path: ['shape', 'style', 'fill'], rule: 'unknown-field' }] },
      },
    });
    expect(
      section.dispatch({
        type: 'shape.create',
        shape: {
          type: 'brace',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          armRatio: 0.3,
        } as never,
      }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['shape', 'armRatio'], rule: 'unknown-field' }] } },
    });
  });

  it('atualiza parâmetros, caixa e traço, e desfaz e refaz', () => {
    const section = newSection();
    addBrace(section);

    expect(
      section.dispatch({
        type: 'shape.update',
        id: 'brace-1',
        patch: {
          orientation: 'up',
          tipPosition: 0.25,
          curvature: 0.9,
          width: 200,
          style: { strokeWidth: 4 },
        },
      }).ok,
    ).toBe(true);
    expect(section.getSnapshot().document.nodes['brace-1']).toMatchObject({
      orientation: 'up',
      tipPosition: 0.25,
      curvature: 0.9,
      width: 200,
      height: 160,
      style: { stroke: '#000000', strokeWidth: 4 },
    });

    section.undo();
    expect(section.getSnapshot().document.nodes['brace-1']).toMatchObject({
      orientation: 'left',
      tipPosition: 0.5,
      curvature: 0.5,
      width: 40,
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['brace-1']).toMatchObject({
      orientation: 'up',
      curvature: 0.9,
    });
  });

  it('um patch só de estilo não mexe nos parâmetros', () => {
    const section = newSection();
    addBrace(section, { orientation: 'right', tipPosition: 0.3, curvature: 0.7 });
    section.dispatch({ type: 'shape.update', id: 'brace-1', patch: { style: { opacity: 0.5 } } });
    expect(section.getSnapshot().document.nodes['brace-1']).toMatchObject({
      orientation: 'right',
      tipPosition: 0.3,
      curvature: 0.7,
    });
  });

  it('recusa patches inválidos, sem mudar o documento', () => {
    const section = newSection();
    addBrace(section);
    const before = section.getSnapshot();
    const refuse = (patch: Record<string, unknown>, path: string, rule: string) =>
      expect(
        section.dispatch({ type: 'shape.update', id: 'brace-1', patch: patch as never }),
      ).toMatchObject({
        ok: false,
        error: { details: { issues: [{ path: ['patch', ...path.split('.')], rule }] } },
      });

    refuse({ tipPosition: 2 }, 'tipPosition', 'range');
    refuse({ curvature: -1 }, 'curvature', 'range');
    refuse({ orientation: 'x' }, 'orientation', 'format');
    refuse({ style: { fill: '#fff' } }, 'style.fill', 'unknown-field');
    refuse({ armRatio: 0.5 }, 'armRatio', 'unknown-field');
    expect(section.getSnapshot()).toBe(before);
  });

  it('recusa orientation em figura que não é chave', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'r', patch: { orientation: 'left' } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'orientation'], rule: 'unknown-field' }] } },
    });
  });

  it('round-trip pelo documento e recusa de campos inválidos na carga', () => {
    const section = newSection();
    addBrace(section, { orientation: 'down', tipPosition: 0.2, curvature: 0.6, rotation: 0.4 });
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };

    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['brace-1']).toMatchObject({
      type: 'brace',
      orientation: 'down',
      tipPosition: 0.2,
      curvature: 0.6,
      rotation: 0.4,
    });

    for (const [field, value, rule] of [
      ['tipPosition', 9, 'range'],
      ['curvature', -1, 'range'],
      ['orientation', 'sideways', 'format'],
    ] as const) {
      const broken = structuredClone(doc);
      broken.nodes['brace-1']![field] = value;
      expect(newSection().replaceDocument(broken)).toMatchObject({
        ok: false,
        error: {
          details: {
            issues: [expect.objectContaining({ path: ['nodes', 'brace-1', field], rule })],
          },
        },
      });
    }

    const withFill = structuredClone(doc);
    (withFill.nodes['brace-1']!['style'] as Record<string, unknown>)['fill'] = '#fff';
    expect(newSection().replaceDocument(withFill).ok).toBe(false);
  });

  it('aceita a chave como preview', () => {
    const section = newSection();
    expect(
      section.setPreview({
        additions: [
          { id: 'p', type: 'brace', x: 0, y: 0, width: 40, height: 100, rotation: 0, curvature: 1 },
        ],
      }).ok,
    ).toBe(true);
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'brace', curvature: 1 });
  });

  it('os limites são a caixa mais meio traço, também com rotação', () => {
    const node: BraceNode = {
      id: 'b',
      type: 'brace',
      x: 0,
      y: 0,
      width: 40,
      height: 100,
      rotation: 0,
      orientation: 'left',
      tipPosition: 0.5,
      curvature: 0.5,
      visible: true,
      locked: false,
      style: { stroke: '#000000', strokeWidth: 4, opacity: 1 },
    };
    expect(shapeBounds(node)).toEqual({ x: -2, y: -2, width: 44, height: 104 });
    const turned = shapeBounds({ ...node, rotation: Math.PI / 2 });
    expect(turned.width).toBeCloseTo(104, 9);
    expect(turned.height).toBeCloseTo(44, 9);
  });
});

describe('hit-test e marquee da chave (só o traço)', () => {
  // Caixa 100 × 200, `{` com curvatura 1: o raio é 50, os arcos se encontram em (50, 50) e
  // (50, 150), a ponta fica em (0, 100) e as pontas das pernas em (100, 0) e (100, 200). O traço
  // tem 4 de largura (meio traço 2).
  function sectionWith(extra: Record<string, unknown> = {}): CanvasSectionApi {
    const section = newSection();
    addBrace(section, {
      x: 0,
      y: 0,
      width: 100,
      height: 200,
      curvature: 1,
      style: { stroke: '#000000', strokeWidth: 4 },
      ...extra,
    });
    return section;
  }
  const hit = (
    section: CanvasSectionApi,
    x: number,
    y: number,
    tolerance = 0,
  ): string | undefined => section.hitTest({ x, y }, { includePreview: false, tolerance });
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

  it('atinge a ponta, a espinha e as pontas das pernas', () => {
    const section = sectionWith();
    expect(hit(section, 0, 100)).toBe('brace-1');
    expect(hit(section, 100, 0)).toBe('brace-1');
    expect(hit(section, 100, 200)).toBe('brace-1');
    expect(hit(section, 50, 60)).toBe('brace-1');
    expect(hit(section, 47.5, 60)).toBe('brace-1');
    // Fora do alcance de meio traço do arco.
    expect(hit(section, 52.5, 60)).toBeUndefined();
  });

  it('com curvatura menor a espinha reta e as pernas existem e são atingidas', () => {
    // Curvatura 0,5: raio 25, espinha em x = 25 de y = 25 a 75, pernas de x = 50 a x = 100.
    const section = sectionWith({ curvature: 0.5 });
    expect(hit(section, 25, 50)).toBe('brace-1');
    expect(hit(section, 75, 0)).toBe('brace-1');
    expect(hit(section, 75, 200)).toBe('brace-1');
    expect(hit(section, 75, 100)).toBeUndefined();
  });

  it('não atinge o vazio dentro da caixa nem o canto da caixa', () => {
    const section = sectionWith();
    expect(hit(section, 30, 60)).toBeUndefined();
    expect(hit(section, 80, 100)).toBeUndefined();
    expect(hit(section, 5, 5)).toBeUndefined();
    expect(hit(section, 95, 195)).toBeUndefined();
    // Dentro da concavidade da ponta, longe do arco.
    expect(hit(section, 50, 100)).toBeUndefined();
  });

  it('a tolerância alarga o alcance', () => {
    const section = sectionWith();
    expect(hit(section, 56, 60, 0)).toBeUndefined();
    expect(hit(section, 56, 60, 5)).toBe('brace-1');
  });

  it('com rotação, o traço gira com a caixa', () => {
    // Um quarto de volta em torno de (50, 100): a ponta (0, 100) passa a (50, 50).
    const section = sectionWith({ rotation: Math.PI / 2 });
    expect(hit(section, 50, 50)).toBe('brace-1');
    expect(hit(section, 50, 150)).toBeUndefined();
  });

  it('sem traço visível não atinge nada', () => {
    const section = sectionWith({ style: { stroke: null } });
    expect(hit(section, 0, 100)).toBeUndefined();
    const thin = sectionWith({ style: { strokeWidth: 0 } });
    expect(hit(thin, 0, 100)).toBeUndefined();
  });

  it('marquee por interseção pega o traço e ignora o miolo vazio', () => {
    const section = sectionWith();
    expect(marquee(section, -5, 95, 10, 10, 'intersect')).toEqual(['brace-1']);
    expect(marquee(section, 95, -5, 10, 10, 'intersect')).toEqual(['brace-1']);
    expect(marquee(section, 40, 40, 20, 40, 'intersect')).toEqual(['brace-1']);
    // Dentro da caixa, sem encostar no traço.
    expect(marquee(section, 60, 90, 20, 20, 'intersect')).toEqual([]);
    expect(marquee(section, 5, 150, 20, 20, 'intersect')).toEqual([]);

    const turned = sectionWith({ rotation: Math.PI / 2 });
    expect(marquee(turned, 45, 45, 10, 10, 'intersect')).toEqual(['brace-1']);
    expect(marquee(turned, 45, 145, 10, 10, 'intersect')).toEqual([]);
  });

  it('marquee por contenção usa a caixa dos limites', () => {
    const section = sectionWith();
    expect(marquee(section, -5, -5, 110, 210, 'contain')).toEqual(['brace-1']);
    expect(marquee(section, 0, 0, 100, 150, 'contain')).toEqual([]);
  });
});
