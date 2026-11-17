import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CollaborationErrorCode,
  type CollaborationTransport,
  type CommitReceipt,
  type CreateTransport,
  type Result,
  type RoomAccess,
  type SessionStatus,
  type TransportInbound,
  type TransportState,
  type TransportWelcome,
} from '@canvash/collaboration';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function addRect(section: CanvasSectionApi, id: string): void {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
  if (!result.ok) throw new Error(`não criou ${id}`);
}

function emptyRoomWelcome(access: RoomAccess = 'write'): TransportWelcome {
  const roomDoc = new Y.Doc();
  initYjsDocument(roomDoc, 'epoch-1');
  return {
    roomEpoch: 'epoch-1',
    access,
    missing: Y.encodeStateAsUpdate(roomDoc),
    serverSyncState: Y.encodeStateVector(roomDoc),
    serverTime: 1,
  };
}

/** Transporte controlado pelo teste: respostas de commit programadas e eventos sob comando. */
function controlledTransport() {
  let state: TransportState = 'open';
  const inbound = new Set<(message: TransportInbound) => void>();
  const stateListeners = new Set<(state: TransportState, error?: CollaborationError) => void>();
  const commits: string[] = [];
  const presences: unknown[] = [];
  const failures: CollaborationError[] = [];
  let closes = 0;
  const transport: CollaborationTransport = {
    get state() {
      return state;
    },
    open: () => Promise.resolve(ok(emptyRoomWelcome())),
    commit(commitId, _update, roomEpoch): Promise<Result<CommitReceipt, CollaborationError>> {
      commits.push(commitId);
      const failure = failures.shift();
      if (failure !== undefined) return Promise.resolve(err(failure));
      return Promise.resolve(ok({ commitId, roomEpoch, timestamp: 1, durable: true }));
    },
    sync: () => Promise.resolve(ok(new Uint8Array([0, 0]))),
    sendPresence(presence) {
      presences.push(presence);
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
      closes += 1;
      state = 'closed';
    },
  };
  return {
    transport,
    commits,
    presences,
    closes: () => closes,
    failNext(error: CollaborationError): void {
      failures.push(error);
    },
    emit(message: TransportInbound): void {
      for (const listener of [...inbound]) listener(message);
    },
    setState(next: TransportState, error?: CollaborationError): void {
      state = next;
      for (const listener of [...stateListeners]) listener(next, error);
    },
  };
}

function controlledSession(access: RoomAccess = 'write', section = createCanvasSection()) {
  const control = controlledTransport();
  const welcome = emptyRoomWelcome(access);
  const session = new YjsCollaborationSession(
    control.transport,
    { documentId: 'doc', section },
    'sess-1',
    welcome,
  );
  const changes: Array<[SessionStatus, CollaborationError | undefined]> = [];
  session.onStatusChange((status, error) => changes.push([status, error]));
  return { control, section, session, changes, welcome };
}

describe('reação da sessão a erro fatal com a conexão aberta (US-P.5)', () => {
  const fatal: CollaborationErrorCode[] = [
    'UNAUTHORIZED',
    'NOT_FOUND',
    'ROOM_EPOCH_MISMATCH',
    'PROTOCOL_ERROR',
    'UNSUPPORTED_VERSION',
    'UNSUPPORTED',
  ];

  it.each(fatal)(
    '%s: vai a error com os details, fecha o enlace e não tenta de novo',
    async (code) => {
      const { control, section, session, changes } = controlledSession();
      const error = createCollaborationError(code, 'recusado pelo servidor', { motivo: code });

      control.emit({ type: 'error', fatal: true, error });
      addRect(section, 'depois-do-erro');
      await flush();

      expect(session.status).toBe('error');
      expect(changes).toEqual([['error', error]]);
      expect(control.closes()).toBe(1);
      // Nenhuma nova tentativa: o que se edita depois fica pendente, sem sair.
      expect(control.commits).toEqual([]);
      const left = await session.leave();
      expect(!left.ok && left.error.code).toBe('PENDING_CHANGES');
      session.destroy();
    },
  );
});

describe('reação da sessão a commit recusado (US-P.5)', () => {
  const refused: Array<{ code: CollaborationErrorCode; details?: Record<string, unknown> }> = [
    { code: 'INVALID_DOCUMENT' },
    { code: 'LIMIT_EXCEEDED', details: { reason: 'commit' } },
    { code: 'UNAUTHORIZED' },
  ];

  it.each(refused)(
    '$code: aviso com o commitId, commit pendente como recusado, reenvio só na volta do enlace',
    async ({ code, details }) => {
      const { control, section, session, changes, welcome } = controlledSession();
      control.failNext(createCollaborationError(code, 'commit recusado', details));

      addRect(section, 'recusado');
      await flush();
      const [refusedId] = control.commits;

      // Aviso: o status não muda, e o erro traz o commit e os details do servidor.
      expect(session.status).toBe('connected');
      expect(changes).toHaveLength(1);
      expect(changes[0]?.[0]).toBe('connected');
      expect(changes[0]?.[1]?.code).toBe(code);
      expect(changes[0]?.[1]?.details).toEqual({ ...details, commitId: refusedId });
      expect(control.closes()).toBe(0);

      // Outro commit sai normalmente e não leva o recusado junto.
      addRect(section, 'aceito');
      await flush();
      expect(control.commits).toHaveLength(2);
      expect(control.commits[1]).not.toBe(refusedId);
      const left = await session.leave();
      expect(!left.ok && left.error.details).toEqual({ pendingCount: 1 });

      // Na volta do enlace, o recusado é reenviado uma vez, pelo mesmo commitId.
      control.setState('reconnecting');
      control.setState('open');
      control.emit({ type: 'resync', welcome: { ...welcome, missing: new Uint8Array([0, 0]) } });
      await flush();
      expect(control.commits).toEqual([refusedId, control.commits[1], refusedId]);
      expect((await session.leave()).ok).toBe(true);
    },
  );

  it('ROOM_EPOCH_MISMATCH no commit leva a error, sem nova tentativa', async () => {
    const { control, section, session, changes } = controlledSession();
    control.failNext(createCollaborationError('ROOM_EPOCH_MISMATCH', 'outra epoch'));

    addRect(section, 'r1');
    await flush();
    addRect(section, 'r2');
    await flush();

    expect(session.status).toBe('error');
    expect(changes.map(([status, error]) => [status, error?.code])).toEqual([
      ['error', 'ROOM_EPOCH_MISMATCH'],
    ]);
    expect(control.commits).toHaveLength(1);
    session.destroy();
  });

  it('DISCONNECTED no commit não avisa nada: quem muda o status é o estado do enlace', async () => {
    const { control, section, session, changes, welcome } = controlledSession();
    control.failNext(createCollaborationError('DISCONNECTED', 'pedido sem resposta'));

    addRect(section, 'r1');
    await flush();
    expect(changes).toEqual([]);
    expect(session.status).toBe('connected');

    control.setState('reconnecting');
    control.setState('open');
    control.emit({ type: 'resync', welcome: { ...welcome, missing: new Uint8Array([0, 0]) } });
    await flush();

    expect(changes.map(([status]) => status)).toEqual(['reconnecting', 'connected']);
    expect(new Set(control.commits).size).toBe(1);
    expect(control.commits).toHaveLength(2);
    expect((await session.leave()).ok).toBe(true);
  });
});

describe('acesso somente leitura (US-P.6)', () => {
  it('expõe o acesso, põe a section em somente leitura e continua publicando presença', async () => {
    const { control, section, session } = controlledSession('read');

    session.updatePresence({ cursor: { x: 1, y: 2 } });
    await flush();

    expect(session.access).toBe('read');
    expect(section.getSnapshot().session.readOnly).toBe(true);
    expect(control.commits).toEqual([]);
    expect(control.presences.length).toBeGreaterThanOrEqual(1);
    session.destroy();
  });

  it('com acesso de escrita a section não é tocada', () => {
    const { section, session } = controlledSession('write');

    expect(session.access).toBe('write');
    expect(section.getSnapshot().session.readOnly).toBe(false);
    session.destroy();
  });

  it('não semeia a sala: o estado dela, mesmo vazio, substitui o documento local', async () => {
    const section = createCanvasSection();
    addRect(section, 'local');

    const { control, session } = controlledSession('read', section);
    await flush();

    expect(control.commits).toEqual([]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
    expect((await session.leave()).ok).toBe(true);
  });

  it('commit feito com o read-only desligado pelo host vira aviso UNAUTHORIZED, sem derrubar a sessão', async () => {
    const { control, section, session, changes } = controlledSession('read');
    control.failNext(createCollaborationError('UNAUTHORIZED', 'acesso somente leitura'));

    section.setReadOnly(false);
    addRect(section, 'r1');
    await flush();

    expect(session.status).toBe('connected');
    expect(changes.map(([status, error]) => [status, error?.code])).toEqual([
      ['connected', 'UNAUTHORIZED'],
    ]);
    expect(control.closes()).toBe(0);
    session.destroy();
  });

  it('o acesso do resync vale: de leitura para escrita, a section volta a aceitar edição', async () => {
    const { control, section, session, welcome } = controlledSession('read');

    control.setState('reconnecting');
    control.setState('open');
    control.emit({
      type: 'resync',
      welcome: { ...welcome, access: 'write', missing: new Uint8Array([0, 0]) },
    });
    await flush();

    expect(session.access).toBe('write');
    expect(section.getSnapshot().session.readOnly).toBe(false);

    control.setState('reconnecting');
    control.setState('open');
    control.emit({
      type: 'resync',
      welcome: { ...welcome, access: 'read', missing: new Uint8Array([0, 0]) },
    });
    await flush();

    expect(session.access).toBe('read');
    expect(section.getSnapshot().session.readOnly).toBe(true);
    session.destroy();
  });

  it('o emulador impõe o acesso: commit de sessão de leitura volta UNAUTHORIZED e não entra no log', async () => {
    const server = new CollaborativeServerEmulator();
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });
    server.setAccess('read');
    const section = createCanvasSection();
    const connected = await provider.connect({ documentId: 'doc', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    const codes: Array<CollaborationErrorCode | undefined> = [];
    session.onStatusChange((_status, error) => codes.push(error?.code));

    section.setReadOnly(false);
    addRect(section, 'r1');
    await flush();

    expect(session.access).toBe('read');
    expect(codes).toEqual(['UNAUTHORIZED']);
    expect(server.getLog()).toEqual([]);
    session.destroy();
  });
});

describe('erros de handshake na entrada (US-P.5, US-P.9)', () => {
  const refusals: Array<{ code: CollaborationErrorCode; details?: Record<string, unknown> }> = [
    { code: 'CONNECTION_FAILED' },
    { code: 'UNAUTHORIZED' },
    { code: 'NOT_FOUND' },
    { code: 'UNSUPPORTED_VERSION', details: { supported: [1] } },
    { code: 'UNSUPPORTED' },
    { code: 'PROTOCOL_ERROR' },
    { code: 'ROOM_EPOCH_MISMATCH' },
    { code: 'LIMIT_EXCEEDED', details: { reason: 'clients' } },
    { code: 'LIMIT_EXCEEDED', details: { reason: 'rooms' } },
    { code: 'LIMIT_EXCEEDED', details: { reason: 'welcome' } },
  ];

  it.each(refusals)(
    '$code $details: connect devolve o erro, fecha o transporte e não cria sessão',
    async ({ code, details }) => {
      const error = createCollaborationError(code, 'handshake recusado', details);
      let closes = 0;
      let listeners = 0;
      const createTransport: CreateTransport = () => ({
        state: 'closed',
        open: () => Promise.resolve(err(error)),
        commit: () => Promise.resolve(err(error)),
        sync: () => Promise.resolve(err(error)),
        sendPresence() {},
        onInbound() {
          listeners += 1;
          return () => {
            listeners -= 1;
          };
        },
        onStateChange() {
          listeners += 1;
          return () => {
            listeners -= 1;
          };
        },
        close() {
          closes += 1;
        },
      });
      const provider = new YjsCollaborationProvider({ createTransport });

      const result = await provider.connect({
        documentId: 'doc',
        section: createCanvasSection(),
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toEqual(error);
      expect(closes).toBe(1);
      expect(listeners).toBe(0);
    },
  );

  it('credencial e epoch recusadas pelo servidor em memória não deixam cliente registrado', async () => {
    const server = new CollaborativeServerEmulator('epoch-1');
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });

    const auth = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
      credentials: { token: 'invalid_token' },
    });
    const epoch = await provider.connect({
      documentId: 'doc',
      section: createCanvasSection(),
      roomEpoch: 'epoch-9',
    });

    expect(!auth.ok && auth.error.code).toBe('UNAUTHORIZED');
    expect(!epoch.ok && epoch.error.code).toBe('ROOM_EPOCH_MISMATCH');
    expect(hub.getClientCount()).toBe(0);
  });

  it('servidor na epoch e1 e cliente sem roomEpoch: a sessão adota a epoch e o primeiro commit recebe recibo', async () => {
    const server = new CollaborativeServerEmulator('e1');
    const hub = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport: hub });
    const section = createCanvasSection();

    const connected = await provider.connect({ documentId: 'doc', section });
    if (!connected.ok) throw new Error(connected.error.code);
    const session = connected.value;
    addRect(section, 'r1');
    await flush();

    expect(session.roomEpoch).toBe('e1');
    expect(session.status).toBe('connected');
    expect(session.getCommitReceipts()).toHaveLength(1);
    expect(session.getCommitReceipts()[0]?.roomEpoch).toBe('e1');
    session.destroy();
  });
});
