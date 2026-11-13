import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

function recordWith(fields: Record<string, unknown>): Y.Doc {
  const ydoc = new Y.Doc();
  initYjsDocument(ydoc);
  const { shapes } = getDocumentCollections(ydoc);
  const map = new Y.Map<unknown>();
  map.set('id', 'cv');
  map.set('type', 'chevron');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('cv', map);
  return ydoc;
}

describe('chevron no Yjs', () => {
  it('a projeção usa o padrão para direção inválida e prende a profundidade à faixa', () => {
    const cases: Array<[unknown, unknown, string, number]> = [
      ['left', 0.4, 'left', 0.4],
      ['up', 0.9, 'up', 0.5],
      ['down', -3, 'down', 0],
      ['diagonal', 'muito', 'right', 0.25],
      [undefined, undefined, 'right', 0.25],
    ];
    for (const [direction, depth, expectedDirection, expectedDepth] of cases) {
      const ydoc = recordWith({
        geometry: { x: 5, y: 6, width: 80, height: 40, rotation: 0.25 },
        ...(direction === undefined ? {} : { direction }),
        ...(depth === undefined ? {} : { notchDepth: depth }),
      });
      expect(projectYDocToCanvasDocument(ydoc).nodes['cv']).toMatchObject({
        type: 'chevron',
        x: 5,
        y: 6,
        width: 80,
        height: 40,
        rotation: 0.25,
        direction: expectedDirection,
        notchDepth: expectedDepth,
      });
    }
  });

  it('projeta o chevron sem geometria com os valores padrão', () => {
    expect(projectYDocToCanvasDocument(recordWith({})).nodes['cv']).toMatchObject({
      type: 'chevron',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      direction: 'right',
      notchDepth: 0.25,
    });
  });

  it('edições concorrentes de direção e de profundidade se somam e os clientes convergem', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-chevron', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-chevron', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'cv', type: 'chevron', x: 0, y: 0, width: 100, height: 60, rotation: 0 },
    });
    expect(sectionB.getSnapshot().document.nodes['cv']).toMatchObject({
      direction: 'right',
      notchDepth: 0.25,
    });

    connA.value.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'cv', patch: { direction: 'down' } });
    sectionB.dispatch({ type: 'shape.update', id: 'cv', patch: { notchDepth: 0.4 } });
    await connA.value.reconnect();

    const expected = { type: 'chevron', direction: 'down', notchDepth: 0.4 };
    expect(sectionA.getSnapshot().document.nodes['cv']).toMatchObject(expected);
    expect(sectionB.getSnapshot().document.nodes['cv']).toMatchObject(expected);
    expect(sectionA.getSnapshot().document.nodes['cv']).toEqual(
      sectionB.getSnapshot().document.nodes['cv'],
    );

    connA.value.destroy();
    connB.value.destroy();
    server.destroy();
  });
});
