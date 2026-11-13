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
  map.set('id', 'tx');
  map.set('type', 'text');
  map.set('geometry', { x: 0, y: 0, width: 200, height: 30, rotation: 0 });
  map.set('text', 'Olá');
  map.set('placement', { parentId: 'layer-default', orderKey: 'a0' });
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  shapes.set('tx', map);
  return ydoc;
}

describe('fontSizeMode no Yjs', () => {
  it('a projeção usa auto quando o registro não tem o modo ou ele é inválido', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'auto'],
      [{ fontSizeMode: 'auto' }, 'auto'],
      [{ fontSizeMode: 'fixed' }, 'fixed'],
      [{ fontSizeMode: 'huge' }, 'auto'],
      [{ fontSizeMode: 3 }, 'auto'],
    ];
    for (const [fields, expected] of cases) {
      expect(
        projectYDocToCanvasDocument(recordWith({ fontSize: 24, ...fields })).nodes['tx'],
      ).toMatchObject({ type: 'text', fontSize: 24, fontSizeMode: expected });
    }
  });

  it('modo e tamanho editados offline por dois clientes se somam e convergem', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-font', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-font', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'tx', type: 'text', x: 0, y: 0, width: 200, text: 'Olá mundo' },
    });
    expect(sectionB.getSnapshot().document.nodes['tx']).toMatchObject({
      fontSizeMode: 'auto',
      fontSize: 16,
    });

    connA.value.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'tx', patch: { fontSizeMode: 'fixed' } });
    sectionB.dispatch({ type: 'shape.update', id: 'tx', patch: { fontSize: 40 } });
    await connA.value.reconnect();

    const expected = { type: 'text', fontSizeMode: 'fixed', fontSize: 40 };
    expect(sectionA.getSnapshot().document.nodes['tx']).toMatchObject(expected);
    expect(sectionB.getSnapshot().document.nodes['tx']).toMatchObject(expected);
    expect(sectionA.getSnapshot().document.nodes['tx']).toEqual(
      sectionB.getSnapshot().document.nodes['tx'],
    );

    connA.value.destroy();
    connB.value.destroy();
    server.destroy();
  });

  it('o nó projetado nunca fica sem fontSizeMode', async () => {
    const provider = new YjsCollaborationProvider();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-font-2', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-font-2', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'tx', type: 'text', x: 0, y: 0, width: 100, text: 'a', fontSizeMode: 'fixed' },
    });
    sectionB.dispatch({ type: 'shape.update', id: 'tx', patch: { text: 'b' } });
    for (const section of [sectionA, sectionB]) {
      expect(section.getSnapshot().document.nodes['tx']).toMatchObject({
        text: 'b',
        fontSizeMode: 'fixed',
      });
    }
    connA.value.destroy();
    connB.value.destroy();
  });
});
