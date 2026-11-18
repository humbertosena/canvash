import {
  err,
  ok,
  type CollaborationError,
  type CollaborationTransport,
  type CreateTransport,
  type TransportInbound,
  type TransportState,
} from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';
import { YjsCollaborationProvider } from './provider.js';

/**
 * Um transporte escrito pelo host como objeto literal, sem classe base e sem `cast`: é o que a
 * interface estrutural promete (US-P.2). Este arquivo é compilado em modo `strict` pelo
 * `tsconfig.test.json` do pacote, então a atribuição abaixo também é o teste de tipo.
 */
function createLiteralTransport(room: Y.Doc, commits: string[]): CreateTransport {
  return () => {
    let state: TransportState = 'idle';
    const inbound = new Set<(message: TransportInbound) => void>();
    const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();
    const transport: CollaborationTransport = {
      get state() {
        return state;
      },
      open(getHello) {
        const hello = getHello();
        state = 'open';
        return Promise.resolve(
          ok({
            roomEpoch: 'epoch-literal',
            access: 'write' as const,
            missing: Y.encodeStateAsUpdate(
              room,
              hello.syncState.byteLength > 0 ? hello.syncState : undefined,
            ),
            serverSyncState: Y.encodeStateVector(room),
            serverTime: 1_000,
          }),
        );
      },
      commit(commitId, update, roomEpoch) {
        if (state !== 'open') {
          return Promise.resolve(err({ code: 'DISCONNECTED' as const, message: 'fechado' }));
        }
        Y.applyUpdate(room, update);
        commits.push(commitId);
        return Promise.resolve(ok({ commitId, roomEpoch, timestamp: 1_000, durable: true }));
      },
      sync(syncState) {
        return Promise.resolve(ok(Y.encodeStateAsUpdate(room, syncState)));
      },
      sendPresence() {
        // Este transporte de teste não tem pares.
      },
      onInbound(listener) {
        inbound.add(listener);
        return () => inbound.delete(listener);
      },
      onStateChange(listener) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
      close() {
        state = 'closed';
      },
    };
    return transport;
  };
}

describe('provider com transporte do host', () => {
  it('aceita uma fábrica que devolve objeto literal e colabora por ela, sem o hub em memória', async () => {
    const room = new Y.Doc();
    initYjsDocument(room, 'epoch-literal');
    const commits: string[] = [];
    const provider = new YjsCollaborationProvider({
      createTransport: createLiteralTransport(room, commits),
    });
    const section = createCanvasSection();

    const connected = await provider.connect({ documentId: 'doc-literal', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const receipts: string[] = [];
    session.onCommitReceipt((receipt) => receipts.push(receipt.commitId));
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(session.status).toBe('connected');
    // A epoch é a do welcome: a sessão não presume nenhuma.
    expect(session.roomEpoch).toBe('epoch-literal');
    expect(commits).toHaveLength(1);
    expect(receipts).toEqual(commits);
    expect(room.getMap('shapes').has('r1')).toBe(true);
    // O hub em memória do provider ficou de fora.
    expect(provider.getTransport().getClientCount()).toBe(0);

    session.destroy();
  });

  it('leave espera a resposta do commit já enviado em vez de recusar a saída', async () => {
    const room = new Y.Doc();
    initYjsDocument(room, 'epoch-literal');
    const provider = new YjsCollaborationProvider({
      createTransport: createLiteralTransport(room, []),
    });
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc-literal', section });
    if (!connected.ok) throw new Error(connected.error.code);

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    // Sem nenhuma espera entre a edição e a saída: o commit está em voo.
    const left = await connected.value.leave();

    expect(left.ok).toBe(true);
    expect(room.getMap('shapes').has('r1')).toBe(true);
  });

  it('o sessionId de cada conexão é um UUID', async () => {
    const provider = new YjsCollaborationProvider();

    const first = await provider.connect({ documentId: 'doc', section: createCanvasSection() });
    const second = await provider.connect({ documentId: 'doc', section: createCanvasSection() });
    if (!first.ok || !second.ok) throw new Error('conexão recusada');

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(first.value.sessionId).toMatch(uuid);
    expect(second.value.sessionId).toMatch(uuid);
    expect(second.value.sessionId).not.toBe(first.value.sessionId);

    first.value.destroy();
    second.value.destroy();
  });

  it('reconnect sem enlace aberto e sem fábrica devolve UNSUPPORTED', async () => {
    const room = new Y.Doc();
    initYjsDocument(room, 'epoch-literal');
    const create = createLiteralTransport(room, []);
    const transport = create({ documentId: 'doc', sessionId: 's1' });
    const section = createCanvasSection();
    const { YjsCollaborationSession } = await import('./session.js');
    const welcome = await transport.open(() => ({
      provider: 'yjs',
      documentId: 'doc',
      sessionId: 's1',
      syncState: new Uint8Array(),
    }));
    if (!welcome.ok) throw new Error('handshake recusado');
    const session = new YjsCollaborationSession(
      transport,
      { documentId: 'doc', section },
      's1',
      welcome.value,
    );

    session.disconnect();
    const result = await session.reconnect();

    expect(!result.ok && result.error.code).toBe('UNSUPPORTED');
    expect(session.status).toBe('error');
    session.destroy();
  });
});
