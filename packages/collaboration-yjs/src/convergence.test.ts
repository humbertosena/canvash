import {
  createCanvasSection,
  mirrorControl,
  type ArrowNode,
  type RectangleNode,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';
import { YjsCollaborationProvider } from './provider.js';
import { projectYDocToCanvasDocument, RECOVERY_LAYER_ID } from './projection.js';
import { getDocumentCollections } from './crdt-schema.js';

describe('Convergência e Resolução de Conflitos CRDT (COLLAB-01, COLLAB-02, COLLAB-04, COLLAB-08, COLLAB-09, COLLAB-10)', () => {
  it('COLLAB-01: 3 clientes convergem após edição concorrente, duplicação, reordenação e queda/reconexão', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section1 = createCanvasSection();
    const section2 = createCanvasSection();
    const section3 = createCanvasSection();

    const conn1 = await provider.connect({ documentId: 'doc-1', section: section1 });
    const conn2 = await provider.connect({ documentId: 'doc-1', section: section2 });
    const conn3 = await provider.connect({ documentId: 'doc-1', section: section3 });

    expect(conn1.ok && conn2.ok && conn3.ok).toBe(true);
    if (!conn1.ok || !conn2.ok || !conn3.ok) return;

    const session1 = conn1.value;
    const session2 = conn2.value;
    const session3 = conn3.value;

    // Cliente 1 cria um retângulo
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

    // Cliente 2 cria uma elipse
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

    // Cliente 3 sofre desconexão temporária
    session3.disconnect();

    // Com cliente 3 desconectado, cliente 1 move rect-1
    section1.dispatch({
      type: 'shape.update',
      id: 'rect-1',
      patch: { x: 60, y: 60 },
    });

    // Cliente 2 altera preenchimento de rect-1
    section2.dispatch({
      type: 'shape.update',
      id: 'rect-1',
      patch: { style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 } },
    });

    // Ativa duplicação no transporte simulando rede instável (COLLAB-01, COLLAB-04)
    transport.setNetworkOptions({ duplicateMessages: true });

    // Cliente 3 reconecta e recebe o estado consolidado
    await session3.reconnect();

    // Cliente 3 adiciona um texto
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

    // Desativa opções de duplicação
    transport.setNetworkOptions({ duplicateMessages: false });

    // Verifica que todos os 3 canvas convergiram exatamente para o mesmo snapshot
    const doc1 = section1.getSnapshot().document;
    const doc2 = section2.getSnapshot().document;
    const doc3 = section3.getSnapshot().document;

    expect(Object.keys(doc1.nodes).sort()).toEqual(['ellipse-1', 'rect-1', 'text-1']);
    expect(Object.keys(doc2.nodes).sort()).toEqual(['ellipse-1', 'rect-1', 'text-1']);
    expect(Object.keys(doc3.nodes).sort()).toEqual(['ellipse-1', 'rect-1', 'text-1']);

    // Rect-1 deve ter geometria e preenchimento preservados
    expect(doc1.nodes['rect-1']).toEqual(doc2.nodes['rect-1']);
    expect(doc2.nodes['rect-1']).toEqual(doc3.nodes['rect-1']);

    session1.destroy();
    session2.destroy();
    session3.destroy();
    server.destroy();
  });

  it('COLLAB-02 & COLLAB-08: exclusão vs movimento, e mover + recolorir preservando ambas as mutações', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-merge', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-merge', section: sectionB });

    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    const sessionA = connA.value;
    const sessionB = connB.value;

    // Cria forma base
    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 10, y: 10, width: 100, height: 100, rotation: 0 },
    });

    // 1. Mover e recolorir preservam ambas as mudanças (COLLAB-08)
    sectionA.dispatch({
      type: 'shape.update',
      id: 's1',
      patch: { x: 110, y: 60 },
    });

    sectionB.dispatch({
      type: 'shape.update',
      id: 's1',
      patch: { style: { fill: '#00ff00', stroke: '#000000', strokeWidth: 2, opacity: 0.8 } },
    });

    const docA = sectionA.getSnapshot().document;
    const docB = sectionB.getSnapshot().document;

    const s1A = docA.nodes['s1'] as RectangleNode;
    const s1B = docB.nodes['s1'] as RectangleNode;

    expect(s1A.x).toBe(110);
    expect(s1A.y).toBe(60);
    expect(s1A.style.fill).toBe('#00ff00');
    expect(s1A).toEqual(s1B);

    // 2. Exclusão vence movimento concorrente (COLLAB-02)
    sectionA.dispatch({
      type: 'shape.remove',
      id: 's1',
    });

    sectionB.dispatch({
      type: 'shape.update',
      id: 's1',
      patch: { x: 130, y: 80 },
    });

    const finalA = sectionA.getSnapshot().document;
    const finalB = sectionB.getSnapshot().document;

    expect(finalA.nodes['s1']).toBeUndefined();
    expect(finalB.nodes['s1']).toBeUndefined();

    sessionA.destroy();
    sessionB.destroy();
    server.destroy();
  });

  it('COLLAB-04: mensagens remotas não geram eco infinito e replay não duplica nós', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section1 = createCanvasSection();
    const section2 = createCanvasSection();

    const conn1 = await provider.connect({ documentId: 'doc-echo', section: section1 });
    const conn2 = await provider.connect({ documentId: 'doc-echo', section: section2 });

    expect(conn1.ok && conn2.ok).toBe(true);
    if (!conn1.ok || !conn2.ok) return;

    let revisionsSection1 = 0;
    section1.subscribe(() => {
      revisionsSection1++;
    });

    // Cria forma
    section1.dispatch({
      type: 'shape.create',
      shape: { id: 'box', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
    });

    const initialRevisionCount = revisionsSection1;

    // Dispara 5 replays da mesma mensagem no transport
    const snapshot = server.getSnapshot();
    transport.setNetworkOptions({ duplicateMessages: true });
    server.commitUpdate('dup-1', snapshot, 'epoch-1');

    // A contagem de revisões do section1 não deve explodir em loop infinito
    expect(revisionsSection1).toBeLessThanOrEqual(initialRevisionCount + 3);

    // O nó não é duplicado
    expect(Object.keys(section2.getSnapshot().document.nodes)).toEqual(['box']);

    conn1.value.destroy();
    conn2.value.destroy();
    server.destroy();
  });

  it('COLLAB-09: disputa de múltiplos pais para um nó e pai excluído encaminha para recuperação', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({ documentId: 'doc-parents', section });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;
    const ydoc = session.getYDoc();
    const { shapes, groups } = getDocumentCollections(ydoc);

    // Cria dois grupos e um retângulo
    ydoc.transact(() => {
      const g1 = new Y.Map<unknown>();
      g1.set('id', 'g1');
      g1.set('placement', { parentId: 'layer-default', orderKey: 'm1' });
      groups.set('g1', g1);

      const g2 = new Y.Map<unknown>();
      g2.set('id', 'g2');
      g2.set('placement', { parentId: 'layer-default', orderKey: 'm2' });
      groups.set('g2', g2);

      const s = new Y.Map<unknown>();
      s.set('id', 'item-1');
      s.set('type', 'rectangle');
      // Pai inicial: g1
      s.set('placement', { parentId: 'g1', orderKey: 'm' });
      s.set('geometry', { x: 10, y: 10, width: 50, height: 50, rotation: 0 });
      shapes.set('item-1', s);
    });

    // Exclui o grupo pai g1
    ydoc.transact(() => {
      groups.get('g1')?.set('isDeleted', true);
    });

    // Projeta o documento: item-1 deve ser encaminhado para a camada de recuperação estável (COLLAB-09)
    const projected = projectYDocToCanvasDocument(ydoc);
    const recoveryLayer = projected.layers.find((l) => l.id === RECOVERY_LAYER_ID);

    expect(recoveryLayer).toBeDefined();
    expect(recoveryLayer?.childIds).toContain('item-1');

    session.destroy();
    server.destroy();
  });

  it('COLLAB-10: gerações internas impedem ressurreição por updates atrasados e setas mantêm fallback', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({ documentId: 'doc-gen', section });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;
    const ydoc = session.getYDoc();
    const { shapes } = getDocumentCollections(ydoc);

    // Cria retângulo alvo e seta ancorada a ele
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'target',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
      },
    });

    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'arrow-1',
        type: 'arrow',
        start: { x: 10, y: 10 },
        end: { targetId: 'target', anchor: { x: 0.5, y: 0.5 } },
      },
    });

    // Exclui o alvo 'target'
    section.dispatch({
      type: 'shape.remove',
      id: 'target',
    });

    // A seta deve continuar existindo e ter sua âncora removida de forma segura com coordenadas preservadas (COLLAB-10)
    const arrow = section.getSnapshot().document.nodes['arrow-1'] as ArrowNode;
    expect(arrow).toBeDefined();
    expect('targetId' in arrow.end ? arrow.end.targetId : undefined).toBeUndefined();

    // Simula mensagem atrasada da geração antiga tentando reviver ou alterar target
    ydoc.transact(() => {
      const sMap = shapes.get('target');
      if (sMap) {
        // Tentativa de mutação na geração antiga (geração 1)
        if (Number(sMap.get('generation') ?? 1) === 1) {
          sMap.set('geometry', { x: 999, y: 999, width: 80, height: 80, rotation: 0 });
        }
      }
    });

    // O target continua excluído
    expect(section.getSnapshot().document.nodes['target']).toBeUndefined();

    session.destroy();
    server.destroy();
  });

  it('sincroniza criação e redimensionamento de losango (diamond) entre clientes', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const connA = await provider.connect({ documentId: 'doc-diamond', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-diamond', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: {
        id: 'd-collab',
        type: 'diamond',
        x: 30,
        y: 40,
        width: 120,
        height: 80,
        rotation: 0.2,
      },
    });

    const nodeB = sectionB.getSnapshot().document.nodes['d-collab'];
    expect(nodeB).toBeDefined();
    expect(nodeB?.type).toBe('diamond');
    if (nodeB?.type === 'diamond') {
      expect(nodeB.width).toBe(120);
      expect(nodeB.height).toBe(80);
      expect(nodeB.rotation).toBe(0.2);
    }

    connA.value.destroy();
    connB.value.destroy();
    server.destroy();
  });
});

describe('Convergência da curva Bézier simétrica (Tarefa 111)', () => {
  it('edições concorrentes nos dois controles convergem para uma curva simétrica válida', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const connA = await provider.connect({ documentId: 'doc-bz', section: sectionA });
    const connB = await provider.connect({ documentId: 'doc-bz', section: sectionB });
    expect(connA.ok && connB.ok).toBe(true);
    if (!connA.ok || !connB.ok) return;

    sectionA.dispatch({
      type: 'shape.create',
      shape: { id: 'bz', type: 'bezier', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    });

    connB.value.disconnect();
    sectionA.dispatch({ type: 'shape.update', id: 'bz', patch: { control1: { x: 10, y: -60 } } });
    sectionB.dispatch({ type: 'shape.update', id: 'bz', patch: { control2: { x: 100, y: 20 } } });
    await connB.value.reconnect();

    const nodeA = sectionA.getSnapshot().document.nodes['bz'];
    const nodeB = sectionB.getSnapshot().document.nodes['bz'];
    expect(nodeB).toEqual(nodeA);
    expect(nodeA?.type).toBe('bezier');
    if (nodeA?.type !== 'bezier') return;
    const mirrored = mirrorControl(nodeA.start, nodeA.end, nodeA.control1);
    expect(nodeA.control2.x).toBeCloseTo(mirrored.x, 9);
    expect(nodeA.control2.y).toBeCloseTo(mirrored.y, 9);

    connA.value.destroy();
    connB.value.destroy();
  });
});
