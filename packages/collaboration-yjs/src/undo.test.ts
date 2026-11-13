import { createCanvasSection, type RectangleNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';
import { YjsCollaborationProvider } from './provider.js';

describe('Histórico Colaborativo e UndoManager por Origem (COLLAB-03)', () => {
  it('undo local após mudança remota desfaz apenas a intenção local e redo respeita o estado remoto', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-undo', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-undo', section: sectionB });

    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    const sessionA = connA.value;
    const sessionB = connB.value;
    const undoManagerA = sessionA.getUndoManager();

    // 1. Cliente A cria retângulo A
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'rect-A', type: 'rectangle', x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    });
    undoManagerA.stopCapturing();

    // 2. Cliente B cria retângulo B (mutação remota independente)
    sectionB.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-B',
        type: 'rectangle',
        x: 200,
        y: 200,
        width: 80,
        height: 80,
        rotation: 0,
      },
    });

    // 3. Cliente A move rect-A
    sectionA.dispatch({
      type: 'shape.update',
      id: 'rect-A',
      patch: { x: 50, y: 50 },
    });
    undoManagerA.stopCapturing();

    expect(sectionA.getSnapshot().document.nodes['rect-B']).toBeDefined();
    expect((sectionA.getSnapshot().document.nodes['rect-A'] as RectangleNode).x).toBe(50);

    // 4. Cliente B altera estilo de rect-B (mutação remota adicional)
    sectionB.dispatch({
      type: 'shape.update',
      id: 'rect-B',
      patch: { style: { fill: '#ff00ff', stroke: null, strokeWidth: 0, opacity: 1 } },
    });

    // 5. Cliente A executa UNDO local
    const didUndo = undoManagerA.undo();
    expect(didUndo).toBe(true);

    // Deve desfazer o movimento de rect-A (voltando para x=0, y=0), mas NÃO mexer em rect-B!
    const docAfterUndo = sectionA.getSnapshot().document;
    const nodeA = docAfterUndo.nodes['rect-A'] as RectangleNode;
    const nodeB = docAfterUndo.nodes['rect-B'] as RectangleNode;

    expect(nodeA.x).toBe(0);
    expect(nodeA.y).toBe(0);
    expect(nodeB).toBeDefined();
    expect(nodeB.style.fill).toBe('#ff00ff'); // Preservado integralmente!

    // 6. Cliente A executa REDO local
    const didRedo = undoManagerA.redo();
    expect(didRedo).toBe(true);

    const docAfterRedo = sectionA.getSnapshot().document;
    expect((docAfterRedo.nodes['rect-A'] as RectangleNode).x).toBe(50);
    expect(docAfterRedo.nodes['rect-B']).toBeDefined();
    expect((docAfterRedo.nodes['rect-B'] as RectangleNode).style.fill).toBe('#ff00ff');

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('desagrupar dois grupos num transact é um passo só, e o undo os restaura na outra sessão (US-GA.8)', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-ungroup', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-ungroup', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;
    const undoManagerA = connA.value.getUndoManager();

    const rect = (id: string, x: number) =>
      ({
        type: 'shape.create',
        shape: { id, type: 'rectangle', x, y: 0, width: 10, height: 10, rotation: 0 },
      }) as const;
    sectionA.transact([rect('a1', 0), rect('a2', 20), rect('b1', 40), rect('b2', 60)]);
    undoManagerA.stopCapturing();
    sectionA.transact([
      { type: 'group.create', id: 'ga', childIds: ['a1', 'a2'] },
      { type: 'group.create', id: 'gb', childIds: ['b1', 'b2'] },
    ]);
    undoManagerA.stopCapturing();
    expect(sectionB.getSnapshot().document.nodes['ga']?.type).toBe('group');

    sectionA.transact([
      { type: 'group.ungroup', id: 'ga' },
      { type: 'group.ungroup', id: 'gb' },
    ]);
    undoManagerA.stopCapturing();
    expect(sectionB.getSnapshot().document.nodes['ga']).toBeUndefined();
    expect(sectionB.getSnapshot().document.nodes['gb']).toBeUndefined();

    // Um undo só devolve os dois grupos, nas duas sessões.
    expect(undoManagerA.undo()).toBe(true);
    for (const section of [sectionA, sectionB]) {
      const { nodes } = section.getSnapshot().document;
      expect(nodes['ga']?.type).toBe('group');
      expect(nodes['gb']?.type).toBe('group');
    }
    // O passo anterior (criar os grupos) continua inteiro: o undo não andou duas vezes.
    expect(sectionB.getSnapshot().document.nodes['a1']).toBeDefined();

    connA.value.destroy();
    connB.value.destroy();
    server.destroy();
  });
});
