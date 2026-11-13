import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';

function recordWith(fields: Record<string, unknown>): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', 'cr');
  map.set('type', 'cross');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('cr', map);
  return ydoc;
}

describe('cruz no Yjs', () => {
  it('a projeção devolve armRatio à faixa e usa 1/3 quando o valor não é um número', () => {
    const cases: Array<[unknown, number]> = [
      [0.5, 0.5],
      [0.001, 0.05],
      [7, 1],
      ['muito', 1 / 3],
      [undefined, 1 / 3],
    ];
    for (const [raw, expected] of cases) {
      const ydoc = recordWith({
        geometry: { x: 5, y: 6, width: 80, height: 40, rotation: 0.25 },
        ...(raw === undefined ? {} : { armRatio: raw }),
      });
      expect(projectYDocToCanvasDocument(ydoc).nodes['cr']).toMatchObject({
        type: 'cross',
        x: 5,
        y: 6,
        width: 80,
        height: 40,
        rotation: 0.25,
        armRatio: expected,
      });
    }
  });

  it('projeta a cruz sem geometria com os valores padrão', () => {
    expect(projectYDocToCanvasDocument(recordWith({})).nodes['cr']).toMatchObject({
      type: 'cross',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      armRatio: 1 / 3,
    });
  });

  it('sincroniza a criação e a edição de armRatio e do tamanho entre dois clientes', async () => {
    const { YjsCollaborationProvider } = await import('./provider.js');
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-cross', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-cross', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'cr', type: 'cross', x: 10, y: 20, width: 120, height: 90, rotation: 0 },
    });
    expect(sectionB.getSnapshot().document.nodes['cr']).toMatchObject({
      type: 'cross',
      armRatio: 1 / 3,
      width: 120,
    });

    sectionB.dispatch({ type: 'shape.update', id: 'cr', patch: { armRatio: 0.6 } });
    expect(sectionA.getSnapshot().document.nodes['cr']).toMatchObject({ armRatio: 0.6 });

    sectionA.dispatch({ type: 'shape.update', id: 'cr', patch: { width: 200, height: 150 } });
    expect(sectionB.getSnapshot().document.nodes['cr']).toMatchObject({
      armRatio: 0.6,
      width: 200,
      height: 150,
    });

    connA.value.destroy();
    connB.value.destroy();
  });
});
