import {
  createCollaborationError,
  err,
  MAX_OFFLINE_BACKLOG_BYTES,
  ok,
  type CollaborationCredentials,
  type CollaborationError,
  type CollaborationSession,
  type CollaborationTransport,
  type CommitReceipt,
  type ConnectOptions,
  type CreateTransport,
  type PendingSummary,
  type PresenceUpdate,
  type PresenceViolation,
  type RemotePresence,
  type Result,
  type RoomAccess,
  type SessionStatus,
  type TransportHello,
  type TransportInbound,
  type TransportWelcome,
} from '@canvash/collaboration';
import {
  inkStrokesToWorld,
  type CanvasSectionApi,
  type CanvasDocument,
  type InkNode,
  type WorldInkStroke,
} from '@canvash/core';
import * as Y from 'yjs';
import { AwarenessManager, type LocalAwarenessState } from './awareness.js';
import { backoffDelay, DEFAULT_BACKOFF } from './backoff.js';
import { CanvasYDocWriter } from './canvas-to-ydoc.js';
import { initYjsDocument } from './crdt-schema.js';
import {
  createLegacyHubTransport,
  isLegacyTransportHub,
  type LegacyTransportHub,
} from './legacy-hub-transport.js';
import type { TransportMessage } from './legacy-message.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { createCollaborativeUndoManager, type CollaborativeUndoManager } from './undo.js';

/** Quantos recibos `getCommitReceipts()` guarda quando o host não informa um limite. */
const DEFAULT_RECEIPT_HISTORY_LIMIT = 1_000;

/** Quantos traços perdidos a sessão guarda para recuperação. */
const MAX_LOST_INK_STROKES = 200;

/** Chave de um traço em coordenadas de mundo, para achar o mesmo traço em duas versões. */
function worldStrokeKey(stroke: WorldInkStroke): string {
  const points = stroke.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';');
  return `${stroke.kind}|${stroke.width}|${stroke.color}|${points}`;
}

export interface PendingCommit {
  commitId: string;
  update: Uint8Array;
  timestamp: number;
  /**
   * O servidor recusou este commit com um erro que tentar de novo não resolve. Continua pendente,
   * para o host recuperar, e só é reenviado na próxima volta do enlace ou `reconnect()`.
   */
  rejected?: CollaborationError;
}

/** O limite como o host o configurou: em MiB quando é um número inteiro deles, senão em bytes. */
function formatBytes(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes) && mebibytes >= 1 ? `${mebibytes} MiB` : `${bytes} bytes`;
}

/** Erros de commit que tentar de novo, na mesma conexão, não resolve. */
const REJECTED_COMMIT_CODES: ReadonlySet<string> = new Set([
  'INVALID_DOCUMENT',
  'LIMIT_EXCEEDED',
  'UNAUTHORIZED',
]);

export class YjsCollaborationSession implements CollaborationSession {
  private _status: SessionStatus = 'connecting';
  public readonly sessionId: string;
  public readonly roomEpoch: string;
  public readonly documentId: string;
  private readonly section: CanvasSectionApi;
  private readonly ydoc: Y.Doc;
  private readonly localOrigin: symbol;
  private readonly undoManager: CollaborativeUndoManager;
  private readonly awareness: AwarenessManager;
  private readonly maxOfflineBacklogBytes: number;
  private readonly credentials: CollaborationCredentials | undefined;
  /** O enlace atual. `reconnect()` troca por outro da mesma fábrica quando este já fechou. */
  private transport: CollaborationTransport;
  private readonly createTransport: CreateTransport | null;
  private unsubscribeInbound: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private _access: RoomAccess;
  /** Timer da próxima rodada de reenvio dos commits que o armazenamento não gravou. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Quantas rodadas de reenvio seguidas falharam: dá o teto da próxima espera. */
  private retryAttempt = 0;
  /**
   * Há conteúdo no documento local que ficou fora da fila de pendências, porque não coube no
   * backlog. Sai num commit de reconciliação, na volta do enlace ou quando a fila esvazia.
   */
  private divergent = false;
  /** Edições locais feitas com a reconciliação em voo: pedem outra rodada dela. */
  private changesSinceReconcile = 0;
  private reconciling = false;
  /** A sessão parou por erro fatal e não envia mais nada até o host chamar `reconnect()`. */
  private halted = false;
  /** Vetor de estado do servidor no último handshake: a reconciliação parte dele. */
  private serverSyncState: Uint8Array | null;
  private _serverTimeOffsetMs = 0;
  /** Envios à espera de resposta do servidor. `leave()` espera por eles antes de responder. */
  private readonly inFlight = new Set<Promise<unknown>>();

  private pendingCommits: PendingCommit[] = [];
  private receipts: CommitReceipt[] = [];
  private unsubscribeSection: (() => void) | null = null;

  private readonly statusListeners = new Set<
    (status: SessionStatus, error?: CollaborationError) => void
  >();
  private readonly commitReceiptListeners = new Set<(receipt: CommitReceipt) => void>();
  private readonly pendingListeners = new Set<(pending: PendingSummary) => void>();
  /** O último resumo de pendências avisado: só há novo aviso quando ele muda. */
  private lastPending: PendingSummary = { count: 0, bytes: 0 };
  private readonly receiptHistoryLimit: number;
  private readonly onPresenceError: ((violation: PresenceViolation) => void) | undefined;

  private isApplyingRemote = false;
  private isDestroyed = false;
  private lastKnownDocRevision = -1;
  private readonly writer: CanvasYDocWriter;

  // Armazena buffers locais substituídos para recuperação (COLLAB-08)
  public lastReplacedTextBuffers: Array<{ shapeId: string; text: string }> = [];

  /**
   * Traços que estavam no quadro deste cliente e sumiram do elemento quando um estado remoto
   * substituiu a lista de traços (COLLAB-08). Em coordenadas de mundo, prontos para o host
   * reacrescentá-los com `appendInkStroke`. O elemento que sumiu por inteiro também entra.
   */
  public lastLostInkStrokes: Array<{ shapeId: string; stroke: WorldInkStroke }> = [];

  /** Guarda os traços que o documento remoto projetado deixou de ter. */
  private recordLostInkStrokes(
    before: CanvasDocument['nodes'],
    after: CanvasDocument['nodes'],
  ): void {
    for (const node of Object.values(before)) {
      if (node.type !== 'ink') continue;
      const next = after[node.id];
      const kept = new Set(
        next?.type === 'ink' ? inkStrokesToWorld(next as InkNode).map(worldStrokeKey) : [],
      );
      for (const stroke of inkStrokesToWorld(node)) {
        if (!kept.has(worldStrokeKey(stroke))) {
          this.lastLostInkStrokes.push({ shapeId: node.id, stroke });
        }
      }
    }
    if (this.lastLostInkStrokes.length > MAX_LOST_INK_STROKES) {
      this.lastLostInkStrokes.splice(0, this.lastLostInkStrokes.length - MAX_LOST_INK_STROKES);
    }
  }

  /**
   * @param transport Um transporte já aberto, com o `welcome` do handshake em `initial`. Também
   *   aceita o hub em memória antigo (`DeterministicTransportHub`), com o snapshot do servidor em
   *   `initial`: a sessão o embrulha e registra o cliente nele, sem handshake.
   * @param createTransport Fábrica do transporte, usada por `reconnect()` quando o enlace já
   *   fechou. Com o hub antigo, a sessão cria a própria.
   */
  constructor(
    transport: CollaborationTransport | LegacyTransportHub,
    options: ConnectOptions,
    sessionId: string,
    initial?: Uint8Array | TransportWelcome,
    createTransport?: CreateTransport,
  ) {
    const welcome = initial instanceof Uint8Array ? undefined : initial;
    const initialServerSnapshot = initial instanceof Uint8Array ? initial : welcome?.missing;
    this.sessionId = sessionId;
    this.documentId = options.documentId;
    this.section = options.section;
    this.roomEpoch = welcome?.roomEpoch ?? options.roomEpoch ?? 'epoch-1';
    this.credentials = options.credentials;
    this.onPresenceError = options.onPresenceError;
    this.receiptHistoryLimit = Math.max(
      1,
      Math.floor(options.receiptHistoryLimit ?? DEFAULT_RECEIPT_HISTORY_LIMIT),
    );
    // Registrado antes de qualquer transição, para o host ver também a primeira.
    if (options.onStatusChange) this.statusListeners.add(options.onStatusChange);
    this._access = welcome?.access ?? 'write';
    this.serverSyncState =
      welcome?.serverSyncState ??
      (initialServerSnapshot && initialServerSnapshot.length > 0
        ? Y.encodeStateVectorFromUpdate(initialServerSnapshot)
        : null);
    // Quem só lê, ou quem o host mandou não semear, não leva o documento local para a sala: o
    // estado dela vale, mesmo vazio.
    const maySeed = this._access === 'write' && options.seedEmptyRoom !== false;
    this.maxOfflineBacklogBytes = options.maxOfflineBacklogBytes ?? MAX_OFFLINE_BACKLOG_BYTES;
    this.localOrigin = Symbol(`canvash-session-${sessionId}`);

    let legacy: ReturnType<typeof createLegacyHubTransport> | null = null;
    if (isLegacyTransportHub(transport)) {
      const hub = transport;
      const epoch = this.roomEpoch;
      legacy = createLegacyHubTransport(hub, sessionId, epoch);
      this.transport = legacy;
      this.createTransport = () => createLegacyHubTransport(hub, sessionId, epoch);
    } else {
      this.transport = transport;
      this.createTransport = createTransport ?? null;
    }

    this.ydoc = new Y.Doc();
    this.writer = new CanvasYDocWriter(this.ydoc, this.localOrigin, (entry) => {
      this.lastReplacedTextBuffers.push(entry);
    });

    // Aplica snapshot inicial do servidor se houver
    if (initialServerSnapshot && initialServerSnapshot.length > 0) {
      Y.applyUpdate(this.ydoc, initialServerSnapshot, 'server-init');
      const projected = projectYDocToCanvasDocument(this.ydoc);
      if (Object.keys(projected.nodes).length > 0 || !maySeed) {
        this.isApplyingRemote = true;
        try {
          this.section.replaceDocument(projected);
          this.writer.setKnownNodeIds(Object.keys(projected.nodes));
        } finally {
          this.isApplyingRemote = false;
        }
      } else {
        const localDoc = this.section.getSnapshot().document;
        if (Object.keys(localDoc.nodes).length > 0) {
          this.syncCanvasToYDoc(localDoc);
          this.writer.setKnownNodeIds(Object.keys(localDoc.nodes));
        }
      }
    } else {
      initYjsDocument(this.ydoc, this.roomEpoch);
      const localDoc = this.section.getSnapshot().document;
      if (!maySeed) {
        this.isApplyingRemote = true;
        try {
          this.section.replaceDocument(projectYDocToCanvasDocument(this.ydoc));
        } finally {
          this.isApplyingRemote = false;
        }
      } else if (Object.keys(localDoc.nodes).length > 0) {
        this.syncCanvasToYDoc(localDoc);
        this.writer.setKnownNodeIds(Object.keys(localDoc.nodes));
      }
    }

    this.undoManager = createCollaborativeUndoManager(this.ydoc, this.localOrigin, () => {
      const projected = projectYDocToCanvasDocument(this.ydoc);
      this.isApplyingRemote = true;
      try {
        const prevSelected = this.section.getSnapshot().session.selectedIds;
        this.section.replaceDocument(projected);
        const validSelected = prevSelected.filter((id) => Boolean(projected.nodes[id]));
        if (validSelected.length > 0) {
          this.section.setSelection(validSelected);
        }
        this.lastKnownDocRevision = this.section.getSnapshot().revision;
        this.writer.setKnownNodeIds(Object.keys(projected.nodes));
      } finally {
        this.isApplyingRemote = false;
      }
    });

    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin instanceof Y.UndoManager) {
        this.dispatchCommit(update);
      }
    });

    const user = options.user ?? {
      id: `user-${sessionId}`,
      name: `User ${sessionId.slice(0, 4)}`,
      color: '#3b82f6',
    };

    this.awareness = new AwarenessManager(
      this.sessionId,
      user,
      (state) => {
        if (this._status === 'connected') {
          this.transport.sendPresence(state);
        }
      },
      options.presenceTimeoutMs,
      options.onPresenceError,
    );

    if (this._access === 'read') this.section.setReadOnly(true);
    if (welcome !== undefined && Number.isFinite(welcome.serverTime)) {
      this._serverTimeOffsetMs = welcome.serverTime - Date.now();
    }

    // Passa a ouvir o enlace; com o hub antigo, registra o cliente nele agora
    this.listenTo(this.transport);
    legacy?.attach();

    // Conecta observação do canvas local
    this.bindCanvasEvents();

    this.setStatus('connected');
    // O commit do documento local, criado acima com a sessão ainda conectando, sai agora: sem
    // isso ele ficaria pendente para sempre e `leave()` recusaria a saída.
    void this.track(this.flushPendingCommits());
  }

  /** Registra um envio em andamento até ele terminar. */
  private track<T>(sending: Promise<T>): Promise<T> {
    this.inFlight.add(sending);
    const done = (): void => {
      this.inFlight.delete(sending);
    };
    void sending.then(done, done);
    return sending;
  }

  get status(): SessionStatus {
    return this._status;
  }

  /** Acesso que o servidor concedeu no último handshake. */
  get access(): RoomAccess {
    return this._access;
  }

  /** Relógio do servidor menos o local, em ms, medido no último handshake. */
  get serverTimeOffsetMs(): number {
    return this._serverTimeOffsetMs;
  }

  /** Adota o acesso do handshake: leitura põe a section em somente leitura; a volta à escrita a libera. */
  private applyAccess(access: RoomAccess): void {
    const previous = this._access;
    this._access = access;
    if (access === 'read') {
      this.section.setReadOnly(true);
    } else if (previous === 'read') {
      this.section.setReadOnly(false);
    }
  }

  getUndoManager(): CollaborativeUndoManager {
    return this.undoManager;
  }

  getYDoc(): Y.Doc {
    return this.ydoc;
  }

  updatePresence(update: PresenceUpdate): void {
    if (this.isDestroyed) return;
    this.awareness.updateLocal(update);
  }

  flushPresence(): void {
    if (this.isDestroyed) return;
    this.awareness.flush();
  }

  getPresences(): readonly RemotePresence[] {
    return this.awareness.getPresences();
  }

  getCommitReceipts(): readonly CommitReceipt[] {
    return [...this.receipts];
  }

  getPending(): PendingSummary {
    return {
      // O conteúdo que ficou fora da fila conta como uma pendência, sem bytes conhecidos.
      count: this.pendingCommits.length + (this.divergent ? 1 : 0),
      bytes: this.pendingCommits.reduce((total, pending) => total + pending.update.byteLength, 0),
    };
  }

  onPendingChange(listener: (pending: PendingSummary) => void): () => void {
    this.pendingListeners.add(listener);
    return () => {
      this.pendingListeners.delete(listener);
    };
  }

  /** Avisa os ouvintes de pendências, se o resumo mudou desde o último aviso. */
  private notifyPending(): void {
    if (this.isDestroyed) return;
    const current = this.getPending();
    if (current.count === this.lastPending.count && current.bytes === this.lastPending.bytes) {
      return;
    }
    this.lastPending = current;
    for (const listener of [...this.pendingListeners]) listener(current);
  }

  /** Guarda o recibo, dentro do limite do histórico, e avisa quem espera por ele. */
  private recordReceipt(receipt: CommitReceipt): void {
    this.receipts.push(receipt);
    if (this.receipts.length > this.receiptHistoryLimit) {
      this.receipts.splice(0, this.receipts.length - this.receiptHistoryLimit);
    }
    for (const listener of [...this.commitReceiptListeners]) listener(receipt);
  }

  disconnect(): void {
    if (this.isDestroyed || this._status === 'disconnected') return;
    this.setStatus('disconnected');
    this.cancelCommitRetry();
    this.transport.close();
  }

  /** O `hello` de uma conexão: leva o vetor de estado atual, para o servidor mandar só o que falta. */
  createHello(): TransportHello {
    return {
      provider: 'yjs',
      documentId: this.documentId,
      sessionId: this.sessionId,
      roomEpoch: this.roomEpoch,
      ...(this.credentials === undefined ? {} : { credentials: this.credentials }),
      syncState: Y.encodeStateVector(this.ydoc),
    };
  }

  /**
   * Traz o que falta do servidor: pelo enlace atual, se ele segue aberto, ou por um enlace novo
   * da fábrica, com handshake.
   */
  private async fetchMissing(): Promise<Result<Uint8Array, CollaborationError>> {
    if (this.transport.state === 'open' && !this.halted) {
      return this.transport.sync(Y.encodeStateVector(this.ydoc));
    }
    if (this.createTransport === null) {
      return err(
        createCollaborationError(
          'UNSUPPORTED',
          'A sessão foi criada sem fábrica de transporte e não consegue reabrir o enlace',
        ),
      );
    }
    const transport = this.createTransport({
      documentId: this.documentId,
      sessionId: this.sessionId,
    });
    this.listenTo(transport);
    const welcome = await transport.open(() => this.createHello());
    if (!welcome.ok) {
      transport.close();
      return welcome;
    }
    this.transport = transport;
    this.rememberServerState(welcome.value);
    return ok(welcome.value.missing);
  }

  private listenTo(transport: CollaborationTransport): void {
    this.stopListening();
    this.unsubscribeInbound = transport.onInbound((message) => this.handleInbound(message));
    this.unsubscribeState = transport.onStateChange((state, error) =>
      this.handleTransportState(transport, state, error),
    );
  }

  private stopListening(): void {
    this.unsubscribeInbound?.();
    this.unsubscribeInbound = null;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
  }

  /** O enlace mudou de estado sem a sessão pedir: queda, volta ou fechamento com erro. */
  private handleTransportState(
    transport: CollaborationTransport,
    state: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed',
    error?: CollaborationError,
  ): void {
    if (this.isDestroyed || transport !== this.transport) return;
    if (state === 'reconnecting') {
      // Commits locais seguem entrando como pendentes; a volta chega como `resync`.
      if (this._status === 'connected') this.setStatus('reconnecting');
      return;
    }
    if (state === 'closed' && error !== undefined && this._status !== 'disconnected') {
      // Fechou com erro: handshake recusado na reconexão, protocolo ou enlace substituído.
      this.halted = true;
      this.cancelCommitRetry();
      this.setStatus('error', error);
    }
  }

  /**
   * Para de vez depois de um erro fatal: fecha o transporte e guarda documento, CRDT e pendências
   * para o host recuperar (exportar ou `leave({ force })`).
   */
  private failWith(error: CollaborationError): void {
    this.halted = true;
    this.setStatus('error', error);
    this.cancelCommitRetry();
    this.transport.close();
  }

  /** Aplica o que o servidor mandou como faltante e leva o resultado à section. */
  private applyMissing(missing: Uint8Array): void {
    if (missing.byteLength === 0) return;
    Y.applyUpdate(this.ydoc, missing, 'remote-sync');
    const projected = projectYDocToCanvasDocument(this.ydoc);
    this.isApplyingRemote = true;
    try {
      const prevSelected = this.section.getSnapshot().session.selectedIds;
      this.recordLostInkStrokes(this.section.getSnapshot().document.nodes, projected.nodes);
      this.section.replaceDocument(projected);
      const validSelected = prevSelected.filter((id) => Boolean(projected.nodes[id]));
      if (validSelected.length > 0) {
        this.section.setSelection(validSelected);
      }
      this.lastKnownDocRevision = this.section.getSnapshot().revision;
      this.writer.setKnownNodeIds(Object.keys(projected.nodes));
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /**
   * O enlace voltou sozinho e o `welcome` da reconexão chegou: aplica o que faltou, reenvia as
   * pendências pelo mesmo `commitId` e só então volta a `connected`.
   */
  private async handleResync(welcome: TransportWelcome): Promise<void> {
    const transport = this.transport;
    if (welcome.roomEpoch !== this.roomEpoch) {
      this.failWith(
        createCollaborationError(
          'ROOM_EPOCH_MISMATCH',
          'A sala foi restaurada ou migrada para uma nova epoch incompatível (COLLAB-14)',
          { clientEpoch: this.roomEpoch, serverEpoch: welcome.roomEpoch },
        ),
      );
      return;
    }
    this.rememberServerState(welcome);
    this.applyMissing(welcome.missing);
    this.applyAccess(welcome.access);
    if (this.divergent) {
      // A reconciliação leva tudo o que o servidor não tem, inclusive o que estava na fila.
      await this.reconcile();
    } else {
      await this.flushPendingCommits();
    }
    const stillCurrent = !this.isDestroyed && transport === this.transport;
    if (!stillCurrent || transport.state !== 'open' || this.halted || this.divergent) return;
    if (this._status !== 'reconnecting' && this._status !== 'error') {
      this.awareness.announce();
      return;
    }
    this.setStatus('connected');
    // Os pares voltam a ver a sessão já, sem esperar o heartbeat.
    this.awareness.announce();
    // O que foi editado durante o reenvio ficou na fila: sai agora.
    if (this.pendingCommits.length > 0) await this.flushPendingCommits();
  }

  private rememberServerState(welcome: TransportWelcome): void {
    if (welcome.serverSyncState.byteLength > 0) this.serverSyncState = welcome.serverSyncState;
    // O erro da medida é a latência do handshake, não a diferença entre os relógios.
    if (Number.isFinite(welcome.serverTime)) {
      this._serverTimeOffsetMs = welcome.serverTime - Date.now();
    }
  }

  /** O enlace está bom e a sessão não parou por erro fatal: dá para enviar. */
  private canSend(): boolean {
    return (
      !this.isDestroyed &&
      !this.halted &&
      this.transport.state === 'open' &&
      this._status !== 'disconnected' &&
      this._status !== 'reconnecting'
    );
  }

  /**
   * Envia ao servidor tudo o que ele não tem: a diferença entre o documento local e o vetor de
   * estado dele no último handshake. Substitui as pendências que existiam, que ficam cobertas
   * pelo recibo deste commit. Se algo for editado com ele em voo, sai outra rodada.
   */
  private async reconcile(): Promise<void> {
    if (!this.divergent || this.reconciling) return;
    this.reconciling = true;
    try {
      while (
        this.divergent &&
        !this.isDestroyed &&
        !this.halted &&
        this.transport.state === 'open'
      ) {
        this.changesSinceReconcile = 0;
        const covered = new Set(this.pendingCommits.map((pending) => pending.commitId));
        const sentState = Y.encodeStateVector(this.ydoc);
        const update = Y.encodeStateAsUpdate(this.ydoc, this.serverSyncState ?? undefined);
        const commitId = `commit-${this.sessionId}-${crypto.randomUUID()}`;
        const res = await this.track(this.transport.commit(commitId, update, this.roomEpoch));
        if (this.isDestroyed) return;
        if (!res.ok) {
          this.handleReconcileFailure(commitId, res.error);
          return;
        }
        this.pendingCommits = this.pendingCommits.filter((p) => !covered.has(p.commitId));
        // O servidor passou a ter, no mínimo, tudo o que o documento local tinha no envio.
        this.serverSyncState = sentState;
        if (this.changesSinceReconcile === 0) this.divergent = false;
        this.recordReceipt(res.value);
        this.notifyPending();
      }
    } finally {
      this.reconciling = false;
    }
    if (!this.divergent && this._status === 'error' && this.canSend()) {
      this.setStatus('connected');
    }
  }

  private handleReconcileFailure(commitId: string, error: CollaborationError): void {
    if (error.code === 'ROOM_EPOCH_MISMATCH') {
      this.failWith(error);
      return;
    }
    if (error.code === 'DISCONNECTED') return; // a volta do enlace tenta de novo
    const details =
      typeof error.details === 'object' && error.details !== null ? error.details : {};
    const failure = createCollaborationError(error.code, error.message, { ...details, commitId });
    if (error.code === 'STORAGE_UNAVAILABLE') {
      this.setStatus(this._status, failure);
      this.scheduleCommitRetry();
      return;
    }
    // Recusado de vez (grande demais, inválido, sem acesso): fica para o host exportar.
    this.setStatus('error', failure);
  }

  async reconnect(): Promise<Result<void, CollaborationError>> {
    if (this.isDestroyed) {
      return err(createCollaborationError('DISCONNECTED', 'Sessão já destruída'));
    }
    this.setStatus('reconnecting');

    // Sincroniza updates perdidos durante a desconexão (COLLAB-01, COLLAB-11)
    const fetched = await this.fetchMissing();
    if (this.isDestroyed) {
      return err(createCollaborationError('DISCONNECTED', 'Sessão já destruída'));
    }
    if (!fetched.ok) {
      this.setStatus('error', fetched.error);
      return fetched;
    }
    this.halted = false;
    this.applyMissing(fetched.value);

    if (this.divergent) {
      // Ficou conteúdo fora da fila: a reconciliação leva tudo e, se der certo, volta a connected.
      await this.reconcile();
      if (!this.divergent && this._status === 'reconnecting') this.setStatus('connected');
      this.awareness.announce();
      return ok(undefined);
    }

    this.setStatus('connected');
    this.awareness.announce();

    // Descarrega pendências offline acumuladas (COLLAB-11)
    await this.flushPendingCommits();

    return ok(undefined);
  }

  async leave(options?: { force?: boolean }): Promise<Result<void, CollaborationError>> {
    if (!options?.force) {
      // Commit já enviado e ainda sem resposta não é motivo para recusar a saída: a resposta
      // chega em seguida, ou o transporte a encerra com erro quando o enlace cai.
      while (this.inFlight.size > 0 && !this.isDestroyed) {
        await Promise.allSettled([...this.inFlight]);
      }
    }
    if (!options?.force && (this.pendingCommits.length > 0 || this.divergent)) {
      return err(
        createCollaborationError(
          'PENDING_CHANGES',
          'Existem alterações locais pendentes de confirmação durável',
          // O conteúdo que ficou fora da fila conta como uma pendência a mais.
          { pendingCount: this.pendingCommits.length + (this.divergent ? 1 : 0) },
        ),
      );
    }

    this.destroy();
    return ok(undefined);
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.unsubscribeSection) {
      this.unsubscribeSection();
      this.unsubscribeSection = null;
    }

    this.stopListening();
    this.cancelCommitRetry();
    this.transport.close();
    this.awareness.destroy();
    this.undoManager.destroy();
    this.ydoc.destroy();

    // O `disconnected` final chega a quem ouve antes de os ouvintes serem soltos.
    if (this._status !== 'disconnected') this.setStatus('disconnected');
    this.statusListeners.clear();
    this.commitReceiptListeners.clear();
    this.pendingListeners.clear();
  }

  onStatusChange(
    listener: (status: SessionStatus, error?: CollaborationError) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onPresenceChange(listener: (presences: readonly RemotePresence[]) => void): () => void {
    return this.awareness.subscribe(listener);
  }

  onCommitReceipt(listener: (receipt: CommitReceipt) => void): () => void {
    this.commitReceiptListeners.add(listener);
    return () => this.commitReceiptListeners.delete(listener);
  }

  private setStatus(newStatus: SessionStatus, error?: CollaborationError): void {
    this._status = newStatus;
    for (const l of this.statusListeners) {
      l(newStatus, error);
    }
  }

  private bindCanvasEvents(): void {
    this.lastKnownDocRevision = this.section.getSnapshot().revision;

    this.unsubscribeSection = this.section.subscribe((event) => {
      if (this.isApplyingRemote || this.isDestroyed) return;
      if (!event.areas.includes('document')) return;

      const snapshot = this.section.getSnapshot();
      if (snapshot.revision === this.lastKnownDocRevision && event.origin !== 'load') return;

      this.lastKnownDocRevision = snapshot.revision;
      this.syncCanvasToYDoc(snapshot.document);
    });
  }

  /**
   * Traduz as mutações locais do canvas para o Y.Doc (COLLAB-02, COLLAB-08) e envia o que mudou.
   */
  private syncCanvasToYDoc(doc: CanvasDocument): void {
    const update = this.writer.write(doc);
    if (update) {
      this.dispatchCommit(update);
    }
  }

  /**
   * Envia ou enfileira commit com controle do limite de backlog de 20 MiB (COLLAB-06, COLLAB-12).
   */
  private async dispatchCommit(update: Uint8Array): Promise<void> {
    const currentBacklogBytes = this.pendingCommits.reduce(
      (acc, c) => acc + c.update.byteLength,
      0,
    );
    if (this.divergent) {
      // Já há conteúdo fora da fila: a reconciliação leva este também.
      this.changesSinceReconcile += 1;
      return;
    }
    if (currentBacklogBytes + update.byteLength > this.maxOfflineBacklogBytes) {
      // O conteúdo fica no documento local e sai na reconciliação: nada aplicado localmente
      // fica fora do servidor.
      this.divergent = true;
      this.setStatus(
        'error',
        createCollaborationError(
          'LIMIT_EXCEEDED',
          `Limite de backlog offline excedido (${formatBytes(this.maxOfflineBacklogBytes)})`,
          {
            limitBytes: this.maxOfflineBacklogBytes,
            currentBacklogBytes,
            updateBytes: update.byteLength,
          },
        ),
      );
      this.notifyPending();
      if (this.pendingCommits.length === 0 && this.canSend()) void this.track(this.reconcile());
      return;
    }

    // Identidade estável do commit, e chave da deduplicação no servidor: tem de ser única mesmo
    // para dois commits feitos no mesmo milissegundo.
    const commitId = `commit-${this.sessionId}-${crypto.randomUUID()}`;
    const pending: PendingCommit = { commitId, update, timestamp: Date.now() };
    this.pendingCommits.push(pending);
    this.notifyPending();

    if (this._status === 'connected') {
      const res = await this.track(this.transport.commit(commitId, update, this.roomEpoch));
      if (res.ok) {
        this.confirmCommit(res.value);
      } else {
        this.handleCommitFailure(pending, res.error);
      }
    }
  }

  /**
   * O que fazer com um commit que o servidor não confirmou. Ele continua pendente em todos os
   * casos; muda só o que o host fica sabendo e se há nova tentativa.
   */
  private handleCommitFailure(pending: PendingCommit, error: CollaborationError): void {
    if (this.isDestroyed) return;
    if (error.code === 'ROOM_EPOCH_MISMATCH') {
      this.setStatus(
        'error',
        createCollaborationError(
          'ROOM_EPOCH_MISMATCH',
          'A sala foi restaurada ou migrada para uma nova epoch incompatível (COLLAB-14)',
        ),
      );
      return;
    }
    if (REJECTED_COMMIT_CODES.has(error.code)) {
      // Aviso, sem transição: o enlace segue bom e os outros commits continuam saindo.
      const details =
        typeof error.details === 'object' && error.details !== null ? error.details : {};
      const rejected = createCollaborationError(error.code, error.message, {
        ...details,
        commitId: pending.commitId,
      });
      pending.rejected = rejected;
      this.setStatus(this._status, rejected);
    }
    if (error.code === 'STORAGE_UNAVAILABLE') {
      // O servidor não conseguiu gravar, mas o enlace segue bom: aviso e nova tentativa.
      const details =
        typeof error.details === 'object' && error.details !== null ? error.details : {};
      this.setStatus(
        this._status,
        createCollaborationError(error.code, error.message, {
          ...details,
          commitId: pending.commitId,
        }),
      );
      this.scheduleCommitRetry();
    }
    // DISCONNECTED e os demais: quem muda o status é o estado do enlace, e o reenvio vem na volta.
  }

  /** Agenda uma rodada de reenvio, se ainda não há uma a caminho. */
  private scheduleCommitRetry(): void {
    if (this.retryTimer !== null || this.isDestroyed) return;
    const delay = backoffDelay(this.retryAttempt, DEFAULT_BACKOFF, Math.random);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.track(this.retryPendingCommits());
    }, delay);
  }

  private cancelCommitRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  /**
   * Rodada de reenvio com o enlace aberto: os commits que o armazenamento não gravou saem de novo,
   * em ordem, pelo mesmo `commitId`. Se algum falhar outra vez, `handleCommitFailure` agenda a
   * próxima rodada, com espera maior; uma rodada inteira com sucesso zera a espera.
   */
  private async retryPendingCommits(): Promise<void> {
    // Sem enlace não há o que tentar: a volta dele reenvia todas as pendências.
    if (!this.canSend()) {
      this.retryAttempt = 0;
      return;
    }
    if (this.divergent && this.pendingCommits.every((pending) => pending.rejected !== undefined)) {
      // A rodada é da reconciliação que o armazenamento não gravou.
      await this.reconcile();
      if (!this.divergent) this.retryAttempt = 0;
      return;
    }
    let failed = false;
    for (const pending of [...this.pendingCommits]) {
      if (pending.rejected !== undefined) continue;
      const res = await this.track(
        this.transport.commit(pending.commitId, pending.update, this.roomEpoch),
      );
      if (res.ok) {
        this.confirmCommit(res.value);
      } else {
        failed = true;
        this.handleCommitFailure(pending, res.error);
      }
    }
    if (!failed) this.retryAttempt = 0;
  }

  /**
   * Tira o commit das pendências e avisa o recibo. O mesmo commit pode ser confirmado duas vezes
   * (o envio original e um reenvio depois da volta do enlace): só a primeira conta.
   */
  private confirmCommit(receipt: CommitReceipt): void {
    const before = this.pendingCommits.length;
    this.pendingCommits = this.pendingCommits.filter((p) => p.commitId !== receipt.commitId);
    if (this.pendingCommits.length === before) return;
    this.recordReceipt(receipt);
    this.notifyPending();
    // A fila esvaziou com o enlace aberto: é a hora de levar o que ficou fora dela.
    if (this.divergent && this.pendingCommits.length === 0 && this.canSend()) {
      void this.track(this.reconcile());
    }
  }

  private async flushPendingCommits(): Promise<void> {
    const toSend = [...this.pendingCommits];
    for (const pending of toSend) {
      const res = await this.track(
        this.transport.commit(pending.commitId, pending.update, this.roomEpoch),
      );
      if (res.ok) {
        this.confirmCommit(res.value);
      } else if (pending.rejected === undefined || res.error.code !== pending.rejected.code) {
        this.handleCommitFailure(pending, res.error);
      }
    }
  }

  /**
   * Entrega à sessão uma mensagem no formato antigo do hub.
   *
   * @deprecated A sessão ouve o transporte sozinha. Fica para quem repassa mensagens do hub por
   *   outro canal, como os exemplos com `BroadcastChannel`, até eles migrarem para a rede.
   */
  handleTransportMessage(msg: TransportMessage): void {
    if (this.isDestroyed) return;

    if (msg.type === 'presence') {
      this.applyRemotePresence(msg.senderSessionId, msg.payload);
    } else if (msg.type === 'update' && msg.payload instanceof Uint8Array) {
      this.applyRemoteUpdate(msg.payload);
    }
  }

  /** O que chega pelo transporte sem ter sido pedido. */
  private handleInbound(message: TransportInbound): void {
    if (this.isDestroyed) return;

    if (message.type === 'presence') {
      this.applyRemotePresence(message.from, message.state);
    } else if (message.type === 'update') {
      this.applyRemoteUpdate(message.update);
    } else if (message.type === 'resync') {
      void this.track(this.handleResync(message.welcome));
    } else if (message.fatal) {
      this.failWith(message.error);
    } else {
      // Aviso: o ouvinte recebe o erro com o status atual, sem transição.
      this.setStatus(this._status, message.error);
    }
  }

  private applyRemotePresence(from: string, state: unknown): void {
    if (state === null) {
      this.awareness.handleRemoteDisconnect(from);
      return;
    }
    // Quem enviou é o `from` do envelope, carimbado pelo servidor. Uma presença que diz ser de
    // outra sessão trocaria o cursor dela pelo de quem a forjou.
    const claimed =
      typeof state === 'object' ? (state as { sessionId?: unknown }).sessionId : undefined;
    if (typeof claimed === 'string' && claimed !== from) {
      this.onPresenceError?.({ reason: 'SESSION_MISMATCH', field: 'sessionId' });
      return;
    }
    this.awareness.handleRemoteUpdate(state as LocalAwarenessState);
  }

  private applyRemoteUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update, 'remote');
    const projected = projectYDocToCanvasDocument(this.ydoc);
    this.isApplyingRemote = true;
    try {
      const prevSelected = this.section.getSnapshot().session.selectedIds;
      this.recordLostInkStrokes(this.section.getSnapshot().document.nodes, projected.nodes);
      const replaceRes = this.section.replaceDocument(projected);
      if (!replaceRes.ok) {
        console.error('COLLAB_REPLACE_FAILED:', JSON.stringify(replaceRes.error));
      }
      const validSelected = prevSelected.filter((id) => Boolean(projected.nodes[id]));
      if (validSelected.length > 0) {
        this.section.setSelection(validSelected);
      }
      this.lastKnownDocRevision = this.section.getSnapshot().revision;
      this.writer.setKnownNodeIds(Object.keys(projected.nodes));
    } finally {
      this.isApplyingRemote = false;
    }
  }
}
