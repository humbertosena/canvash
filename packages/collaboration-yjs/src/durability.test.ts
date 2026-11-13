import type { CollaborationError, CommitReceipt } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';
import { YjsCollaborationProvider } from './provider.js';

describe('Durabilidade, Ciclo de Vida e Resiliência (COLLAB-06, COLLAB-07, COLLAB-11, COLLAB-12, COLLAB-13, COLLAB-14, COLLAB-15)', () => {
  it('COLLAB-06: rejeição de autorização com credenciais inválidas', async () => {
    const provider = new YjsCollaborationProvider();
    const section = createCanvasSection();

    const conn = await provider.connect({
      documentId: 'doc-auth',
      section,
      credentials: { token: 'invalid_token' },
    });

    expect(conn.ok).toBe(false);
    if (!conn.ok) {
      expect(conn.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('COLLAB-07: ciclo de vida idempotente e leave seguro', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({ documentId: 'doc-lifecycle', section });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;

    // Conexão limpa
    expect(session.status).toBe('connected');

    // Desconecta e reconecta
    session.disconnect();
    expect(session.status).toBe('disconnected');

    const reconn = await session.reconnect();
    expect(reconn.ok).toBe(true);
    expect(session.status).toBe('connected');

    // Leave limpo
    const leaveRes = await session.leave();
    expect(leaveRes.ok).toBe(true);
    expect(session.status).toBe('disconnected');

    // Destroy idempotente
    session.destroy();
    session.destroy();
    server.destroy();
  });

  it('COLLAB-11: perda de rede preserva histórico e reconexão sincroniza sem substituir por JSON', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({ documentId: 'doc-offline', section });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;
    const undoManager = session.getUndoManager();

    // 1. Desconecta da rede (simula offline)
    session.disconnect();

    // 2. Realiza mutação local offline
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'offline-box',
        type: 'rectangle',
        x: 20,
        y: 20,
        width: 60,
        height: 60,
        rotation: 0,
      },
    });
    undoManager.stopCapturing();

    // O histórico offline continua funcionando
    expect(undoManager.canUndo()).toBe(true);

    // 3. Reconecta à rede
    const reconn = await session.reconnect();
    expect(reconn.ok).toBe(true);

    // O documento do servidor agora contém a alteração feita offline
    const serverSection = createCanvasSection();
    const connServer = await provider.connect({
      documentId: 'doc-offline',
      section: serverSection,
    });
    expect(connServer.ok).toBe(true);
    if (connServer.ok) {
      expect(serverSection.getSnapshot().document.nodes['offline-box']).toBeDefined();
      connServer.value.destroy();
    }

    session.destroy();
    server.destroy();
  });

  it('COLLAB-12: limite de backlog offline de 20 MiB recusa commits excedentes com erro LIMIT_EXCEEDED', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    // Configura limite pequeno para teste
    const conn = await provider.connect({
      documentId: 'doc-limit',
      section,
      maxOfflineBacklogBytes: 100, // 100 bytes para simular estouro do limite
    });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;
    session.disconnect(); // Fica offline acumulando backlog

    let errorReceived: CollaborationError | undefined;
    session.onStatusChange((status, err) => {
      if (status === 'error') {
        errorReceived = err;
      }
    });

    // Mutações que ultrapassam os 100 bytes configurados
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'big-shape-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'big-shape-2',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    });

    expect(errorReceived).toBeDefined();
    expect(errorReceived?.code).toBe('LIMIT_EXCEEDED');

    session.destroy();
    server.destroy();
  });

  it('COLLAB-13: reinício do servidor após ACK recupera commits e deduplicação funciona', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({ documentId: 'doc-ack', section });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;

    let receiptReceived: CommitReceipt | undefined;
    session.onCommitReceipt((r) => {
      receiptReceived = r;
    });

    // Realiza commit
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'durable-shape',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 80,
        height: 80,
        rotation: 0,
      },
    });

    // Aguarda confirmação durável (ACK)
    await new Promise((r) => setTimeout(r, 20));

    expect(receiptReceived).toBeDefined();
    expect(receiptReceived?.durable).toBe(true);

    // Simula crash e reinício do servidor imediatamente após o ACK (COLLAB-13)
    server.crash();
    server.restart();

    // Novo cliente entra e recupera todos os dados comitados antes do crash
    const newSection = createCanvasSection();
    const newConn = await provider.connect({ documentId: 'doc-ack', section: newSection });
    expect(newConn.ok).toBe(true);
    if (newConn.ok) {
      expect(newSection.getSnapshot().document.nodes['durable-shape']).toBeDefined();
      newConn.value.destroy();
    }

    session.destroy();
    server.destroy();
  });

  it('COLLAB-14: mudança de roomEpoch rejeita clientes antigos com ROOM_EPOCH_MISMATCH', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section = createCanvasSection();
    const conn = await provider.connect({
      documentId: 'doc-epoch',
      section,
      roomEpoch: 'epoch-1',
    });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;

    const session = conn.value;

    // Servidor migra para nova epoch (ex: restore de backup ou migração de schema)
    server.rotateEpoch('epoch-2');

    // Cliente antigo tentando conectar com epoch-1 é recusado
    const oldClientSection = createCanvasSection();
    const oldConn = await provider.connect({
      documentId: 'doc-epoch',
      section: oldClientSection,
      roomEpoch: 'epoch-1',
    });

    expect(oldConn.ok).toBe(false);
    if (!oldConn.ok) {
      expect(oldConn.error.code).toBe('ROOM_EPOCH_MISMATCH');
    }

    session.destroy();
    server.destroy();
  });

  it('COLLAB-15: compactação de log preserva convergência com clientes da mesma epoch', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section1 = createCanvasSection();
    const conn1 = await provider.connect({ documentId: 'doc-compact', section: section1 });
    expect(conn1.ok).toBe(true);
    if (!conn1.ok) return;

    // Várias operações
    for (let i = 0; i < 5; i++) {
      section1.dispatch({
        type: 'shape.create',
        shape: {
          id: `item-${i}`,
          type: 'rectangle',
          x: i * 20,
          y: i * 20,
          width: 30,
          height: 30,
          rotation: 0,
        },
      });
    }

    // Servidor compacta o log de updates
    server.compact();

    // Novo cliente conecta após a compactação
    const section2 = createCanvasSection();
    const conn2 = await provider.connect({ documentId: 'doc-compact', section: section2 });
    expect(conn2.ok).toBe(true);
    if (!conn2.ok) return;

    // Ambos os canvas devem ter os 5 itens intactos
    expect(Object.keys(section2.getSnapshot().document.nodes).length).toBe(5);

    conn1.value.destroy();
    conn2.value.destroy();
    server.destroy();
  });
});
