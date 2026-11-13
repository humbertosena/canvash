import { describe, expect, it } from 'vitest';
import { resolveArrowEndpoints } from './arrows.js';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { ArrowNode, StickyNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

function sectionWithArrow(): CanvasSectionApi {
  const section = newSection();
  section.dispatch({
    type: 'shape.create',
    shape: { id: 'note', type: 'sticky', x: 100, y: 100, width: 200, height: 100, text: 'Oi' },
  });
  section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'arrow',
      type: 'arrow',
      start: { targetId: 'note', anchor: { x: 1, y: 0.5 } },
      end: { x: 500, y: 150 },
    },
  });
  return section;
}

function endpoints(section: CanvasSectionApi) {
  const { nodes } = section.getSnapshot().document;
  return resolveArrowEndpoints(nodes['arrow'] as ArrowNode, (id) => nodes[id] as StickyNode);
}

describe('seta vinculada à nota adesiva', () => {
  it('aceita o vínculo e resolve a âncora normalizada na caixa da nota', () => {
    const section = sectionWithArrow();
    expect(endpoints(section).start).toEqual({ x: 300, y: 150 });
    expect(endpoints(section).end).toEqual({ x: 500, y: 150 });
  });

  it('acompanha mover, redimensionar e rotacionar a nota', () => {
    const section = sectionWithArrow();

    section.dispatch({ type: 'shape.update', id: 'note', patch: { x: 120, y: 80 } });
    expect(endpoints(section).start).toEqual({ x: 320, y: 130 });

    section.dispatch({ type: 'shape.update', id: 'note', patch: { width: 300, height: 200 } });
    // Meio da borda direita da nota 300 × 200 em (120, 80).
    expect(endpoints(section).start).toEqual({ x: 420, y: 180 });

    section.dispatch({ type: 'shape.update', id: 'note', patch: { rotation: Math.PI / 2 } });
    // A borda direita gira para baixo do centro (270, 180).
    expect(endpoints(section).start.x).toBeCloseTo(270, 9);
    expect(endpoints(section).start.y).toBeCloseTo(330, 9);
  });

  it('a seta sobrevive à edição de texto da nota, que refaz a fonte', () => {
    const section = sectionWithArrow();
    section.dispatch({
      type: 'shape.update',
      id: 'note',
      patch: { text: 'Um texto bem mais comprido que o anterior, para encolher a fonte' },
    });
    expect(endpoints(section).start).toEqual({ x: 300, y: 150 });
  });

  it('o documento com a seta vinculada à nota é válido na carga e no round-trip', () => {
    const section = sectionWithArrow();
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as unknown;
    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['arrow']).toEqual(
      section.getSnapshot().document.nodes['arrow'],
    );
  });

  it('remover a nota não deixa a seta sem destino válido', () => {
    const section = sectionWithArrow();
    expect(section.dispatch({ type: 'shape.remove', id: 'note' }).ok).toBe(true);
    const arrow = section.getSnapshot().document.nodes['arrow'] as ArrowNode | undefined;
    expect(arrow === undefined || 'x' in arrow.start || arrow.start.targetId !== 'note').toBe(true);
  });
});
