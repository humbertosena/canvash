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
  map.set('id', 'br');
  map.set('type', 'brace');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('br', map);
  return ydoc;
}

describe('chave no Yjs', () => {
  it('a projeção usa o padrão para valores inválidos e prende as frações à faixa', () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [
        { orientation: 'up', tipPosition: 0.2, curvature: 0.9 },
        { orientation: 'up', tipPosition: 0.2, curvature: 0.9 },
      ],
      [
        { orientation: 'right', tipPosition: 7, curvature: -3 },
        { orientation: 'right', tipPosition: 1, curvature: 0 },
      ],
      [
        { orientation: 'diagonal', tipPosition: 'muito', curvature: 'pouco' },
        { orientation: 'left', tipPosition: 0.5, curvature: 0.5 },
      ],
      [{}, { orientation: 'left', tipPosition: 0.5, curvature: 0.5 }],
    ];
    for (const [fields, expected] of cases) {
      const ydoc = recordWith({
        geometry: { x: 5, y: 6, width: 40, height: 120, rotation: 0.25 },
        ...fields,
      });
      expect(projectYDocToCanvasDocument(ydoc).nodes['br']).toMatchObject({
        type: 'brace',
        x: 5,
        y: 6,
        width: 40,
        height: 120,
        rotation: 0.25,
        ...expected,
      });
    }
  });

  it('projeta a chave só com traço, ignorando o preenchimento do registro', () => {
    const ydoc = recordWith({ fill: '#ff0000', stroke: '#111111', strokeWidth: 4, opacity: 0.5 });
    const node = projectYDocToCanvasDocument(ydoc).nodes['br']!;
    expect(node).toMatchObject({
      type: 'brace',
      width: 100,
      height: 100,
      style: { stroke: '#111111', strokeWidth: 4, opacity: 0.5 },
    });
    expect('fill' in node.style!).toBe(false);
  });

  it('usa o traço padrão quando o registro não tem cor de traço', () => {
    const node = projectYDocToCanvasDocument(recordWith({})).nodes['br']!;
    expect(node.style).toMatchObject({ stroke: '#000000' });
  });

  it('edições concorrentes de orientação, posição e curvatura se somam e convergem', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-brace', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-brace', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'br', type: 'brace', x: 0, y: 0, width: 40, height: 160, rotation: 0 },
    });
    expect(sectionB.getSnapshot().document.nodes['br']).toMatchObject({
      orientation: 'left',
      tipPosition: 0.5,
      curvature: 0.5,
    });

    connA.value.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'br', patch: { orientation: 'right' } });
    sectionA.dispatch({ type: 'shape.update', id: 'br', patch: { tipPosition: 0.2 } });
    sectionB.dispatch({ type: 'shape.update', id: 'br', patch: { curvature: 0.9 } });
    await connA.value.reconnect();

    const expected = { orientation: 'right', tipPosition: 0.2, curvature: 0.9 };
    expect(sectionA.getSnapshot().document.nodes['br']).toMatchObject(expected);
    expect(sectionB.getSnapshot().document.nodes['br']).toMatchObject(expected);
    expect(sectionA.getSnapshot().document.nodes['br']).toEqual(
      sectionB.getSnapshot().document.nodes['br'],
    );

    connA.value.destroy();
    connB.value.destroy();
    server.destroy();
  });
});
