import { createCanvasSection } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { AwarenessManager } from './awareness.js';
import { getDocumentCollections, initYjsDocument } from './crdt-schema.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';
import { createCollaborativeUndoManager } from './undo.js';

describe('Collaboration Edge Cases & Branch Coverage', () => {
  it('crdt-schema: initYjsDocument ignora quando o documento já foi inicializado', () => {
    const ydoc = new Y.Doc();
    initYjsDocument(ydoc, 'epoch-alpha');
    // Segunda chamada não sobrescreve
    initYjsDocument(ydoc, 'epoch-beta');
    const { meta } = getDocumentCollections(ydoc);
    expect(meta.get('roomEpoch')).toBe('epoch-alpha');
  });

  it('undo: canUndo, canRedo, stopCapturing e retorno falso para stacks vazias', () => {
    const ydoc = new Y.Doc();
    const localOrigin = Symbol('local');
    const undoManager = createCollaborativeUndoManager(ydoc, localOrigin);

    expect(undoManager.canUndo()).toBe(false);
    expect(undoManager.canRedo()).toBe(false);
    expect(undoManager.undo()).toBe(false);
    expect(undoManager.redo()).toBe(false);

    undoManager.stopCapturing();
    undoManager.destroy();
  });

  it('awareness: expiração de presenças remotas (purgeExpired), eco local e destruição', () => {
    const awareness = new AwarenessManager(
      'sess-1',
      { id: 'u1', name: 'User 1', color: '#ff0000' },
      () => {},
    );

    // Eco local é ignorado
    awareness.handleRemoteUpdate({
      sessionId: 'sess-1',
      userId: 'u1',
      userName: 'User 1',
      color: '#ff0000',
      cursor: { x: 10, y: 20 },
      selection: [],
      updatedAt: Date.now(),
    });
    expect(awareness.getPresences().length).toBe(0);

    // Payload nulo é ignorado
    awareness.handleRemoteUpdate(null);
    expect(awareness.getPresences().length).toBe(0);

    // Adiciona presença remota de outro usuário
    awareness.handleRemoteUpdate({
      sessionId: 'sess-2',
      userId: 'u2',
      userName: 'User 2',
      color: '#00ff00',
      cursor: { x: 100, y: 100 },
      selection: ['shape-1'],
      updatedAt: 1000, // No passado
    });
    expect(awareness.getPresences().length).toBe(1);

    // Purge com timestamp posterior deve expirar sess-2
    let notifiedPresences: unknown = null;
    awareness.subscribe((presences) => {
      notifiedPresences = presences;
    });

    awareness.purgeExpired(5000, 10000); // 1000 + 5000 < 10000 => expirado
    expect(awareness.getPresences().length).toBe(0);
    expect(notifiedPresences).toEqual([]);

    // Desconexão de presença inexistente não notifica
    awareness.handleRemoteDisconnect('sess-non-existent');

    // Destruição
    awareness.destroy();
    // Chamadas pós-destruição são no-ops
    awareness.updateLocal({ cursor: { x: 50, y: 50 } });
    awareness.purgeExpired();
  });

  it('server-emulator: lida com crash, divergência de epoch e deduplicação de commits', () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const dummyDoc = new Y.Doc();
    dummyDoc.getText('test').insert(0, 'hello');
    const u1 = Y.encodeStateAsUpdate(dummyDoc);

    // Commit normal
    const r1 = server.commitUpdate('c-1', u1, 'epoch-1');
    expect(r1.ok).toBe(true);

    // Deduplicação: mesmo commitId retorna o recibo gravado anteriormente
    const r1Dup = server.commitUpdate('c-1', u1, 'epoch-1');
    expect(r1Dup.ok).toBe(true);
    if (r1.ok && r1Dup.ok) {
      expect(r1Dup.receipt.commitId).toBe(r1.receipt.commitId);
    }

    // Epoch mismatch
    const rMismatch = server.commitUpdate('c-2', u1, 'epoch-2');
    expect(rMismatch.ok).toBe(false);
    if (!rMismatch.ok) {
      expect(rMismatch.code).toBe('ROOM_EPOCH_MISMATCH');
    }

    // Crash
    server.crash();
    const rCrashed = server.commitUpdate('c-3', u1, 'epoch-1');
    expect(rCrashed.ok).toBe(false);
    if (!rCrashed.ok) {
      expect(rCrashed.code).toBe('CRASHED');
    }
    server.compact(); // No-op quando crashed
  });

  it('transport: suporte a delay de rede, duplicação e tratamento de exceção em broadcast', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    transport.setNetworkOptions({
      delayMs: 10,
      duplicateMessages: true,
    });

    const received: string[] = [];
    transport.registerClient('client-b', (msg) => {
      received.push(msg.type);
    });

    // Cliente que lança erro durante broadcast deve ser tratado com segurança
    transport.registerClient('client-broken', () => {
      throw new Error('Broken client');
    });

    // Envia presença com delay e duplicação
    transport.sendPresence('client-a', {
      sessionId: 'client-a',
      userId: 'uA',
      userName: 'A',
      color: '#fff',
      cursor: null,
      selection: [],
      updatedAt: Date.now(),
    });

    // Envia update com delay e duplicação
    const dummyDoc = new Y.Doc();
    dummyDoc.getText('t').insert(0, 'xyz');
    const u = Y.encodeStateAsUpdate(dummyDoc);

    const res = await transport.sendUpdate('client-a', 'c-delayed', u, 'epoch-1');
    expect(res.ok).toBe(true);

    // Aguarda o delay
    await new Promise((r) => setTimeout(r, 40));
    expect(received.length).toBeGreaterThan(0);

    transport.destroy();
  });

  it('session: o commit inicial do documento local é confirmado e leave() sai limpo', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-initial',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ff0000' },
      },
    });

    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc-initial', section, roomEpoch: 'epoch-1' },
      'sess-initial',
      server.getSnapshot(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.getCommitReceipts()).toHaveLength(1);
    const leaveRes = await session.leave();
    expect(leaveRes.ok).toBe(true);
    expect(transport.getClientCount()).toBe(0);
  });

  it('session: leave() impede saída quando há alterações pendentes sem force (COLLAB-11)', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    transport.setNetworkOptions({ dropMessages: true });
    const section = createCanvasSection();

    const provider = new YjsCollaborationProvider({ server, transport });
    const sessionRes = await provider.connect({
      documentId: 'doc-1',
      section,
      roomEpoch: 'epoch-1',
      user: { id: 'u1', name: 'User 1', color: '#ff0000' },
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const session = sessionRes.value;

    // Mutação enquanto offline gera pendência
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-pending',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ff0000' },
      },
    });

    // Tentativa de leave sem force deve falhar com PENDING_CHANGES
    const leaveRes = await session.leave();
    expect(leaveRes.ok).toBe(false);
    if (!leaveRes.ok) {
      expect(leaveRes.error.code).toBe('PENDING_CHANGES');
    }

    // leave({ force: true }) força a saída e destrói a sessão
    const forceLeaveRes = await session.leave({ force: true });
    expect(forceLeaveRes.ok).toBe(true);
    expect(session.status).toBe('disconnected');

    // reconnect em sessão destruída retorna erro DISCONNECTED
    const reconnectRes = await session.reconnect();
    expect(reconnectRes.ok).toBe(false);
  });

  it('session: estouro de backlog offline emite erro LIMIT_EXCEEDED (COLLAB-06, COLLAB-12)', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    transport.setNetworkOptions({ dropMessages: true });
    const section = createCanvasSection();

    const provider = new YjsCollaborationProvider({ server, transport });
    const sessionRes = await provider.connect({
      documentId: 'doc-1',
      section,
      roomEpoch: 'epoch-1',
      maxOfflineBacklogBytes: 100, // Limite baixo para o teste
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;

    const session = sessionRes.value;

    let sessionError: unknown = null;
    session.onStatusChange((status, err) => {
      if (status === 'error') {
        sessionError = err;
      }
    });

    // Cria forma grande o suficiente para exceder 100 bytes
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'big-shape',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ffffff' },
      },
    });

    // Próxima mutação excede o backlog
    section.dispatch({
      type: 'shape.update',
      id: 'big-shape',
      patch: { style: { fill: '#123456' } },
    });

    expect(session.status).toBe('error');
    expect(sessionError).toBeDefined();
  });

  it('session: registra substituição de texto em lastReplacedTextBuffers (COLLAB-08)', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();

    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc-1', section, roomEpoch: 'epoch-1' },
      'sess-buffer-test',
    );

    // Cria nó de texto inicial
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'txt-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        rotation: 0,
        text: 'Texto Original',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        textAlign: 'left',
        lineHeight: 1.2,
        style: { fill: '#000000' },
      },
    });

    // Atualiza texto
    section.dispatch({
      type: 'shape.update',
      id: 'txt-1',
      patch: { text: 'Texto Sobrescrito' },
    });

    expect(session.lastReplacedTextBuffers.length).toBeGreaterThan(0);
    expect(session.lastReplacedTextBuffers[0]?.text).toBe('Texto Original');

    session.destroy();
  });

  it('session: sincroniza exclusão e restauração de forma incrementando geração (COLLAB-10)', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();

    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc-1', section, roomEpoch: 'epoch-1' },
      'sess-lifecycle',
    );

    // 1. Cria shape
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-life',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ff0000' },
      },
    });

    const ydoc = session.getYDoc();
    const { shapes } = getDocumentCollections(ydoc);
    expect(shapes.get('rect-life')?.get('isDeleted')).toBe(false);
    expect(shapes.get('rect-life')?.get('generation')).toBe(1);

    // 2. Exclui shape via comando do canvas
    section.dispatch({
      type: 'shape.remove',
      id: 'rect-life',
    });

    expect(shapes.get('rect-life')?.get('isDeleted')).toBe(true);

    // 3. Restaura/recria shape com mesmo id (nova geração determinística)
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-life',
        type: 'rectangle',
        x: 15,
        y: 15,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#00ff00' },
      },
    });

    expect(shapes.get('rect-life')?.get('isDeleted')).toBe(false);
    expect(shapes.get('rect-life')?.get('generation')).toBe(2);

    session.destroy();
  });

  it('session: sincroniza linhas e setas com marcadores e âncoras', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();

    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc-1', section, roomEpoch: 'epoch-1' },
      'sess-arrows',
    );

    // Cria shape alvo
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'target-rect',
        type: 'rectangle',
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#333333' },
      },
    });

    // Cria linha
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'line-sync',
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 50, y: 50 },
        style: { stroke: '#000000', strokeWidth: 2 },
      },
    });

    // Atualiza linha
    section.dispatch({
      type: 'shape.update',
      id: 'line-sync',
      patch: {
        start: { x: 5, y: 5 },
        end: { x: 60, y: 60 },
      },
    });

    // Cria seta com binding anchor e marcador
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'arrow-sync',
        type: 'arrow',
        start: { x: 10, y: 10 },
        end: { targetId: 'target-rect', anchor: { x: 0.5, y: 0.5 } },
        startMarker: 'dot',
        endMarker: 'arrow',
        style: { stroke: '#ff0000', strokeWidth: 3 },
      },
    });

    const ydoc = session.getYDoc();
    const { shapes } = getDocumentCollections(ydoc);
    const arrowMap = shapes.get('arrow-sync');
    expect(arrowMap).toBeDefined();

    session.destroy();
  });

  it('session: sincroniza grupos e transição de erro em ROOM_EPOCH_MISMATCH', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const section = createCanvasSection();

    const provider = new YjsCollaborationProvider({ server, transport });
    const sessionRes = await provider.connect({
      documentId: 'doc-1',
      section,
      roomEpoch: 'epoch-1',
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;
    const session = sessionRes.value;

    // Cria duas formas
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#ffffff' },
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 's2',
        type: 'rectangle',
        x: 60,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        style: { fill: '#ffffff' },
      },
    });

    // Agrupa formas
    section.dispatch({
      type: 'group.create',
      id: 'grp-test',
      childIds: ['s1', 's2'],
    });

    const ydoc = session.getYDoc();
    const { groups } = getDocumentCollections(ydoc);
    expect(groups.get('grp-test')).toBeDefined();

    // Servidor migra epoch
    server.rotateEpoch('epoch-2');

    // Próxima mutação local gera erro de ROOM_EPOCH_MISMATCH
    section.dispatch({
      type: 'shape.update',
      id: 's1',
      patch: { style: { fill: '#123123' } },
    });

    // Aguarda microtask
    await new Promise((r) => setTimeout(r, 20));
    expect(session.status).toBe('error');

    session.destroy();
  });

  it('session: reconnect recupera atualizações perdidas do servidor (COLLAB-01, COLLAB-11)', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    const resA = await provider.connect({
      documentId: 'doc-1',
      section: sectionA,
      roomEpoch: 'epoch-1',
      user: { id: 'uA', name: 'User A', color: '#ff0000' },
    });
    const resB = await provider.connect({
      documentId: 'doc-1',
      section: sectionB,
      roomEpoch: 'epoch-1',
      user: { id: 'uB', name: 'User B', color: '#00ff00' },
    });

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (!resA.ok || !resB.ok) return;

    const sessionA = resA.value;
    const sessionB = resB.value;

    // Desconecta A
    sessionA.disconnect();
    expect(sessionA.status).toBe('disconnected');

    // B cria um retângulo enquanto A está offline
    sectionB.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-from-b',
        type: 'rectangle',
        x: 42,
        y: 42,
        width: 120,
        height: 80,
        rotation: 0,
        style: { fill: '#00ffaa' },
      },
    });

    // A reconecta e busca updates faltantes
    const reconnectRes = await sessionA.reconnect();
    expect(reconnectRes.ok).toBe(true);
    expect(sessionA.status).toBe('connected');

    // Documento de A deve ter recebido a forma criada por B
    const docA = sectionA.getSnapshot().document;
    expect(docA.nodes['rect-from-b']).toBeDefined();

    sessionA.destroy();
    sessionB.destroy();
  });

  it('awareness: limpeza periódica purga presenças expiradas via timer', () => {
    vi.useFakeTimers();
    try {
      const awareness = new AwarenessManager(
        'sess-timer',
        { id: 'uT', name: 'User T', color: '#ff00ff' },
        () => {},
      );

      // Presença registrada com timestamp expirado
      awareness.handleRemoteUpdate({
        sessionId: 'sess-remote-old',
        userId: 'uOld',
        userName: 'Old User',
        color: '#aaaaaa',
        cursor: null,
        selection: [],
        updatedAt: Date.now() - 40000,
      });
      expect(awareness.getPresences().length).toBe(1);

      // Avança timer do setInterval para rodar purgeExpired
      vi.advanceTimersByTime(15000);
      expect(awareness.getPresences().length).toBe(0);

      awareness.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
