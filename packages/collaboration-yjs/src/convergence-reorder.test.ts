import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

/** Espera a rede simulada esvaziar, inclusive o que as entregas provocarem. */
async function settle(hub: DeterministicTransportHub): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await flush();
    await hub.settle();
  }
  await flush();
}

function nodeIds(section: CanvasSectionApi): string[] {
  return Object.keys(section.getSnapshot().document.nodes).sort();
}

/**
 * O cenário do COLLAB-01 (três clientes, edição concorrente, duplicação, queda e reconexão de um
 * deles), agora com as mensagens entregues fora da ordem de envio. O teste original roda com a
 * entrega síncrona do hub e nunca reordenou nada.
 */
describe.each([1, 7, 42])('COLLAB-01 com reordenação de mensagens (semente %i)', (reorderSeed) => {
  it('três clientes convergem com entrega fora de ordem, duplicada, e com queda e volta de um deles', async () => {
    const server = new CollaborativeServerEmulator();
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });
    const section1 = createCanvasSection();
    const section2 = createCanvasSection();
    const section3 = createCanvasSection();
    const conn1 = await provider.connect({ documentId: 'doc-1', section: section1 });
    const conn2 = await provider.connect({ documentId: 'doc-1', section: section2 });
    const conn3 = await provider.connect({ documentId: 'doc-1', section: section3 });
    if (!conn1.ok || !conn2.ok || !conn3.ok) throw new Error('conexão recusada');
    const session1 = conn1.value;
    const session2 = conn2.value;
    const session3 = conn3.value;

    // Quem observa o hub vê os updates na ordem em que são entregues.
    const delivered: string[] = [];
    hub.registerClient('observador', (msg) => {
      if (msg.type === 'update' && msg.commitId !== undefined) delivered.push(msg.commitId);
    });
    hub.setNetworkOptions({ reorderMessages: true, duplicateMessages: true, reorderSeed });

    // Clientes 1 e 2 criam formas ao mesmo tempo.
    section1.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section2.dispatch({
      type: 'shape.create',
      shape: {
        id: 'ellipse-1',
        type: 'ellipse',
        x: 200,
        y: 200,
        width: 80,
        height: 80,
        rotation: 0,
      },
    });
    await settle(hub);
    expect(nodeIds(section3)).toEqual(['ellipse-1', 'rect-1']);

    // O cliente 3 perde o enlace; os outros dois seguem editando, e ele edita offline.
    hub.dropLink(session3.sessionId);
    delivered.length = 0;
    const sentBefore = server.getLog().length;
    for (const x of [20, 30, 40, 50, 60]) {
      section1.dispatch({ type: 'shape.update', id: 'rect-1', patch: { x, y: x } });
    }
    section2.dispatch({
      type: 'shape.update',
      id: 'rect-1',
      patch: { style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 } },
    });
    section3.dispatch({
      type: 'shape.create',
      shape: {
        id: 'text-1',
        type: 'text',
        x: 300,
        y: 300,
        width: 150,
        height: 40,
        rotation: 0,
        text: 'Collab Test',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
      },
    });
    await settle(hub);

    // A rede reordenou: a ordem de entrega não é a ordem em que o servidor gravou.
    const sent = server
      .getLog()
      .slice(sentBefore)
      .map((entry) => entry.commitId);
    const firstDelivery = delivered.filter((id, index) => delivered.indexOf(id) === index);
    expect(sent).toHaveLength(6);
    expect([...firstDelivery].sort()).toEqual([...sent].sort());
    expect(firstDelivery).not.toEqual(sent);
    // E duplicou: cada update chegou duas vezes.
    expect(delivered).toHaveLength(12);

    // O enlace do cliente 3 volta sozinho, e o que ele editou offline sai.
    hub.restoreLink(session3.sessionId);
    await settle(hub);

    const doc1 = section1.getSnapshot().document;
    const doc2 = section2.getSnapshot().document;
    const doc3 = section3.getSnapshot().document;
    const all = ['ellipse-1', 'rect-1', 'text-1'];
    expect(Object.keys(doc1.nodes).sort()).toEqual(all);
    expect(Object.keys(doc2.nodes).sort()).toEqual(all);
    expect(Object.keys(doc3.nodes).sort()).toEqual(all);
    // Os três têm o mesmo documento, com o movimento e a cor preservados (COLLAB-08).
    expect(doc2.nodes).toEqual(doc1.nodes);
    expect(doc3.nodes).toEqual(doc1.nodes);
    expect(doc1.nodes['rect-1']).toMatchObject({ x: 60, y: 60 });
    expect(doc1.nodes['rect-1']).toMatchObject({ style: { fill: '#ff0000' } });
    // Nenhum commit entrou duas vezes no servidor, e nenhum nó se duplicou nas camadas.
    const logIds = server.getLog().map((entry) => entry.commitId);
    expect(new Set(logIds).size).toBe(logIds.length);
    for (const doc of [doc1, doc2, doc3]) {
      const placed = doc.layers.flatMap((layer) => layer.childIds);
      expect([...placed].sort()).toEqual(all);
    }
    expect(session3.status).toBe('connected');

    session1.destroy();
    session2.destroy();
    session3.destroy();
    server.destroy();
  });
});
