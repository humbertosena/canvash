import {
  createCollaborationError,
  err,
  MAX_OFFLINE_BACKLOG_BYTES,
  ok,
  type CollaborationError,
  type CollaborationSession,
  type CommitReceipt,
  type ConnectOptions,
  type PresenceUpdate,
  type RemotePresence,
  type Result,
  type SessionStatus,
} from '@canvash/collaboration';
import {
  inkStrokesToWorld,
  isBindingEndpoint,
  isBoxShape,
  isFreeEndpoint,
  isLabelable,
  type BoardNode,
  type CanvasSectionApi,
  type CanvasDocument,
  type GroupNode,
  type InkNode,
  type InkStroke,
  type LabelableNode,
  type WorldInkStroke,
} from '@canvash/core';
import * as Y from 'yjs';
import { AwarenessManager, type LocalAwarenessState } from './awareness.js';
import {
  getDocumentCollections,
  initYjsDocument,
  type YjsEndpoints,
  type YjsGeometry,
} from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import type { DeterministicTransportHub, TransportMessage } from './transport.js';
import { createCollaborativeUndoManager, type CollaborativeUndoManager } from './undo.js';

/** Quantos traços perdidos a sessão guarda para recuperação. */
const MAX_LOST_INK_STROKES = 200;

/** Campos planos do texto da forma no registro; sem `labelText` não há texto. */
const LABEL_KEYS = [
  'labelText',
  'labelFontSize',
  'labelFontFamily',
  'labelFontWeight',
  'labelColor',
  'labelAlign',
  'labelVerticalAlign',
] as const;

function sameStrokes(current: unknown, next: readonly InkStroke[]): boolean {
  if (!Array.isArray(current) || current.length !== next.length) return false;
  return next.every((stroke, index) => {
    const other = current[index] as InkStroke | undefined;
    if (
      !other ||
      other.color !== stroke.color ||
      other.kind !== stroke.kind ||
      other.width !== stroke.width ||
      !Array.isArray(other.points) ||
      other.points.length !== stroke.points.length
    ) {
      return false;
    }
    return stroke.points.every(
      (point, i) => other.points[i]?.x === point.x && other.points[i]?.y === point.y,
    );
  });
}

/** Chave de um traço em coordenadas de mundo, para achar o mesmo traço em duas versões. */
function worldStrokeKey(stroke: WorldInkStroke): string {
  const points = stroke.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';');
  return `${stroke.kind}|${stroke.width}|${stroke.color}|${points}`;
}

export interface PendingCommit {
  commitId: string;
  update: Uint8Array;
  timestamp: number;
}

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

  private pendingCommits: PendingCommit[] = [];
  private receipts: CommitReceipt[] = [];
  private unsubscribeSection: (() => void) | null = null;

  private readonly statusListeners = new Set<
    (status: SessionStatus, error?: CollaborationError) => void
  >();
  private readonly commitReceiptListeners = new Set<(receipt: CommitReceipt) => void>();

  private isApplyingRemote = false;
  private isDestroyed = false;
  private lastKnownDocRevision = -1;
  private knownLocalNodeIds = new Set<string>();

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

  constructor(
    private readonly transport: DeterministicTransportHub,
    options: ConnectOptions,
    sessionId: string,
    initialServerSnapshot?: Uint8Array,
  ) {
    this.sessionId = sessionId;
    this.documentId = options.documentId;
    this.section = options.section;
    this.roomEpoch = options.roomEpoch ?? 'epoch-1';
    this.maxOfflineBacklogBytes = options.maxOfflineBacklogBytes ?? MAX_OFFLINE_BACKLOG_BYTES;
    this.localOrigin = Symbol(`canvash-session-${sessionId}`);

    this.ydoc = new Y.Doc();

    // Aplica snapshot inicial do servidor se houver
    if (initialServerSnapshot && initialServerSnapshot.length > 0) {
      Y.applyUpdate(this.ydoc, initialServerSnapshot, 'server-init');
      const projected = projectYDocToCanvasDocument(this.ydoc);
      if (Object.keys(projected.nodes).length > 0) {
        this.isApplyingRemote = true;
        try {
          this.section.replaceDocument(projected);
          this.knownLocalNodeIds = new Set(Object.keys(projected.nodes));
        } finally {
          this.isApplyingRemote = false;
        }
      } else {
        const localDoc = this.section.getSnapshot().document;
        if (Object.keys(localDoc.nodes).length > 0) {
          this.syncCanvasToYDoc(localDoc);
          this.knownLocalNodeIds = new Set(Object.keys(localDoc.nodes));
        }
      }
    } else {
      initYjsDocument(this.ydoc, this.roomEpoch);
      const localDoc = this.section.getSnapshot().document;
      if (Object.keys(localDoc.nodes).length > 0) {
        this.syncCanvasToYDoc(localDoc);
        this.knownLocalNodeIds = new Set(Object.keys(localDoc.nodes));
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
        this.knownLocalNodeIds = new Set(Object.keys(projected.nodes));
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
          this.transport.sendPresence(this.sessionId, state);
        }
      },
      options.presenceTimeoutMs,
      options.onPresenceError,
    );

    // Registra listener no transport
    this.transport.registerClient(this.sessionId, (msg) => this.handleTransportMessage(msg));

    // Conecta observação do canvas local
    this.bindCanvasEvents();

    this.setStatus('connected');
    // O commit do documento local, criado acima com a sessão ainda conectando, sai agora: sem
    // isso ele ficaria pendente para sempre e `leave()` recusaria a saída.
    void this.flushPendingCommits();
  }

  get status(): SessionStatus {
    return this._status;
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

  getPresences(): readonly RemotePresence[] {
    return this.awareness.getPresences();
  }

  getCommitReceipts(): readonly CommitReceipt[] {
    return [...this.receipts];
  }

  disconnect(): void {
    if (this.isDestroyed || this._status === 'disconnected') return;
    this.setStatus('disconnected');
    this.transport.unregisterClient(this.sessionId);
  }

  async reconnect(): Promise<Result<void, CollaborationError>> {
    if (this.isDestroyed) {
      return err(createCollaborationError('DISCONNECTED', 'Sessão já destruída'));
    }
    this.setStatus('reconnecting');
    this.transport.registerClient(this.sessionId, (msg) => this.handleTransportMessage(msg));

    // Sincroniza updates perdidos durante a desconexão (COLLAB-01, COLLAB-11)
    const missing = this.transport.syncWithServer(Y.encodeStateVector(this.ydoc));
    if (missing && missing.byteLength > 0) {
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
        this.knownLocalNodeIds = new Set(Object.keys(projected.nodes));
      } finally {
        this.isApplyingRemote = false;
      }
    }

    this.setStatus('connected');

    // Descarrega pendências offline acumuladas (COLLAB-11)
    await this.flushPendingCommits();

    return ok(undefined);
  }

  async leave(options?: { force?: boolean }): Promise<Result<void, CollaborationError>> {
    if (!options?.force && this.pendingCommits.length > 0) {
      return err(
        createCollaborationError(
          'PENDING_CHANGES',
          'Existem alterações locais pendentes de confirmação durável',
          { pendingCount: this.pendingCommits.length },
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

    this.transport.unregisterClient(this.sessionId);
    this.awareness.destroy();
    this.undoManager.destroy();
    this.ydoc.destroy();

    this.statusListeners.clear();
    this.commitReceiptListeners.clear();
    this.setStatus('disconnected');
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
   * Traduz as mutações locais do canvas para o Y.Doc (COLLAB-02, COLLAB-08).
   */
  private syncCanvasToYDoc(doc: CanvasDocument): void {
    const { shapes, layers, groups } = getDocumentCollections(this.ydoc);

    let diffUpdate: Uint8Array | null = null;
    const updateHandler = (u: Uint8Array, origin: unknown) => {
      if (origin === this.localOrigin) {
        diffUpdate = u;
      }
    };
    this.ydoc.on('update', updateHandler);

    this.ydoc.transact(() => {
      // 1. Sincroniza Camadas
      for (const [idx, layer] of doc.layers.entries()) {
        let lMap = layers.get(layer.id);
        if (!lMap) {
          lMap = new Y.Map<unknown>();
          lMap.set('id', layer.id);
          layers.set(layer.id, lMap);
        }
        if (lMap.get('name') !== layer.name) lMap.set('name', layer.name);
        if (lMap.get('visible') !== layer.visible) lMap.set('visible', layer.visible);
        if (lMap.get('locked') !== layer.locked) lMap.set('locked', layer.locked);
        if (lMap.get('orderKey') !== `m${idx}`) lMap.set('orderKey', `m${idx}`);
        if (lMap.get('isDeleted') !== false) lMap.set('isDeleted', false);
      }

      // 2. Mapeia nós do documento
      const activeIds = new Set<string>();

      for (const layer of doc.layers) {
        for (const [childIdx, nodeId] of layer.childIds.entries()) {
          activeIds.add(nodeId);
          const node = doc.nodes[nodeId];
          if (!node) continue;

          if (node.type === 'group') {
            this.syncGroup(node, layer.id, `g_${childIdx}`, doc, activeIds, shapes, groups);
          } else if (node.type === 'board') {
            this.syncBoard(node, layer.id, `m_${childIdx}`, doc, activeIds, shapes, groups);
          } else {
            this.syncSingleShape(node, layer.id, `m_${childIdx}`, shapes);
          }
        }
      }

      // 3. Marca nós excluídos pelo usuário local (apenas nós conhecidos localmente)
      for (const knownId of this.knownLocalNodeIds) {
        if (!activeIds.has(knownId)) {
          const sMap = shapes.get(knownId);
          if (sMap && sMap.get('isDeleted') !== true) {
            sMap.set('isDeleted', true);
          }
        }
      }
      this.knownLocalNodeIds = new Set(activeIds);
    }, this.localOrigin);

    this.ydoc.off('update', updateHandler);

    if (diffUpdate) {
      this.dispatchCommit(diffUpdate);
    }
  }

  /**
   * O registro de um nó no mapa `shapes`: cria, ou restaura numa nova geração se estava apagado, e
   * grava o tipo e o posicionamento atômico (só altera se diferir).
   */
  private openShapeRecord(
    node: { readonly id: string; readonly type: string },
    parentId: string,
    orderKey: string,
    shapes: Y.Map<Y.Map<unknown>>,
  ): Y.Map<unknown> {
    let sMap = shapes.get(node.id);
    if (!sMap) {
      sMap = new Y.Map<unknown>();
      sMap.set('id', node.id);
      sMap.set('type', node.type);
      sMap.set('generation', 1);
      shapes.set(node.id, sMap);
    } else if (sMap.get('isDeleted') === true) {
      // Restauração cria nova geração determinística (COLLAB-10)
      const currentGen = Number(sMap.get('generation') ?? 1);
      sMap.set('generation', currentGen + 1);
    }

    if (sMap.get('type') !== node.type) {
      sMap.set('type', node.type);
    }
    // Um board que a outra sessão apagou continua apagado: regravar `false` por cima de um
    // `false` que já era dela venceria a exclusão concorrente, e o que foi posto no board
    // não iria para a recuperação. Só uma restauração local (de `true` para `false`) escreve.
    if (node.type !== 'board' || sMap.get('isDeleted') !== false) {
      sMap.set('isDeleted', false);
    }

    const currentPlacement = sMap.get('placement') as
      { parentId?: string; orderKey?: string } | undefined;
    if (currentPlacement?.parentId !== parentId || currentPlacement?.orderKey !== orderKey) {
      sMap.set('placement', { parentId, orderKey });
    }
    return sMap;
  }

  /** O grupo e os membros dele: o grupo mora em `parentId` (uma camada ou um board). */
  private syncGroup(
    group: GroupNode,
    parentId: string,
    orderKey: string,
    doc: CanvasDocument,
    activeIds: Set<string>,
    shapes: Y.Map<Y.Map<unknown>>,
    groups: Y.Map<Y.Map<unknown>>,
  ): void {
    let gMap = groups.get(group.id);
    if (!gMap) {
      gMap = new Y.Map<unknown>();
      gMap.set('id', group.id);
      gMap.set('generation', 1);
      groups.set(group.id, gMap);
    }
    // Só regrava o que mudou: um posicionamento igual, gravado de novo, disputaria com o de outra
    // sessão que acabou de mover o grupo (para dentro de um board, por exemplo).
    const current = gMap.get('placement') as { parentId?: string; orderKey?: string } | undefined;
    if (current?.parentId !== parentId || current?.orderKey !== orderKey) {
      gMap.set('placement', { parentId, orderKey });
    }
    if (gMap.get('isDeleted') !== false) gMap.set('isDeleted', false);

    // Filhos do grupo
    for (const [gChildIdx, gChildId] of group.childIds.entries()) {
      activeIds.add(gChildId);
      const gChildNode = doc.nodes[gChildId];
      if (gChildNode && gChildNode.type !== 'group' && gChildNode.type !== 'board') {
        this.syncSingleShape(gChildNode, group.id, `m_${gChildIdx}`, shapes);
      }
    }
  }

  /**
   * O board e os filhos dele. O board é um registro de `shapes` na camada; cada filho tem
   * `placement.parentId` igual ao ID do board, e a chave de ordem cobre formas e grupos juntos, com
   * zeros à esquerda para a ordem textual ser a numérica.
   */
  private syncBoard(
    board: BoardNode,
    layerId: string,
    orderKey: string,
    doc: CanvasDocument,
    activeIds: Set<string>,
    shapes: Y.Map<Y.Map<unknown>>,
    groups: Y.Map<Y.Map<unknown>>,
  ): void {
    const sMap = this.openShapeRecord(board, layerId, orderKey, shapes);
    if (sMap.get('title') !== board.title) sMap.set('title', board.title);
    if (sMap.get('fill') !== board.style.fill) sMap.set('fill', board.style.fill);
    if (sMap.get('stroke') !== board.style.stroke) sMap.set('stroke', board.style.stroke);
    if (sMap.get('fillOpacity') !== board.style.fillOpacity) {
      sMap.set('fillOpacity', board.style.fillOpacity);
    }
    const curGeo = sMap.get('geometry') as YjsGeometry | undefined;
    if (
      !curGeo ||
      curGeo.x !== board.x ||
      curGeo.y !== board.y ||
      curGeo.width !== board.width ||
      curGeo.height !== board.height ||
      curGeo.rotation !== 0
    ) {
      sMap.set('geometry', {
        x: board.x,
        y: board.y,
        width: board.width,
        height: board.height,
        rotation: 0,
      });
    }

    for (const [childIdx, childId] of board.childIds.entries()) {
      activeIds.add(childId);
      const child = doc.nodes[childId];
      const childKey = `b_${String(childIdx).padStart(6, '0')}`;
      if (child?.type === 'group') {
        this.syncGroup(child, board.id, childKey, doc, activeIds, shapes, groups);
      } else if (child && child.type !== 'board') {
        this.syncSingleShape(child, board.id, childKey, shapes);
      }
    }
  }

  private syncSingleShape(
    node: Exclude<CanvasDocument['nodes'][string], { type: 'group' | 'board' }>,
    parentId: string,
    orderKey: string,
    shapes: Y.Map<Y.Map<unknown>>,
  ): void {
    const sMap = this.openShapeRecord(node, parentId, orderKey, shapes);

    // Estilos independentes (só altera se diferir) (COLLAB-08)
    const nodeFill = 'fill' in node.style ? node.style.fill : null;
    if (sMap.get('fill') !== nodeFill) sMap.set('fill', nodeFill);
    if ('stroke' in node.style) {
      if (sMap.get('stroke') !== node.style.stroke) sMap.set('stroke', node.style.stroke);
      if (sMap.get('strokeWidth') !== node.style.strokeWidth)
        sMap.set('strokeWidth', node.style.strokeWidth);
    }
    if (sMap.get('opacity') !== node.style.opacity) sMap.set('opacity', node.style.opacity);

    if (isBoxShape(node) && node.type !== 'text' && node.type !== 'sticky') {
      const curGeo = sMap.get('geometry') as YjsGeometry | undefined;
      if (
        !curGeo ||
        curGeo.x !== node.x ||
        curGeo.y !== node.y ||
        curGeo.width !== node.width ||
        curGeo.height !== node.height ||
        curGeo.rotation !== node.rotation
      ) {
        sMap.set('geometry', {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        });
      }
      if (node.type === 'triangle') {
        if (sMap.get('variant') !== node.variant) sMap.set('variant', node.variant);
        if (sMap.get('apex') !== node.apex) sMap.set('apex', node.apex);
      }
      if (isLabelable(node)) this.syncLabel(sMap, node);
      if (node.type === 'polygon' && sMap.get('sides') !== node.sides) {
        sMap.set('sides', node.sides);
      }
      if (node.type === 'cross' && sMap.get('armRatio') !== node.armRatio) {
        sMap.set('armRatio', node.armRatio);
      }
      if (node.type === 'brace') {
        if (sMap.get('orientation') !== node.orientation) {
          sMap.set('orientation', node.orientation);
        }
        if (sMap.get('tipPosition') !== node.tipPosition) {
          sMap.set('tipPosition', node.tipPosition);
        }
        if (sMap.get('curvature') !== node.curvature) sMap.set('curvature', node.curvature);
      }
      if (node.type === 'chevron') {
        if (sMap.get('direction') !== node.direction) sMap.set('direction', node.direction);
        if (sMap.get('notchDepth') !== node.notchDepth) sMap.set('notchDepth', node.notchDepth);
      }
      if (node.type === 'ink' && !sameStrokes(sMap.get('strokes'), node.strokes)) {
        // A lista inteira é um valor só: duas listas concorrentes não se misturam, uma vence.
        sMap.set(
          'strokes',
          node.strokes.map((stroke) => ({
            points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
            color: stroke.color,
            kind: stroke.kind,
            width: stroke.width,
          })),
        );
      }
    } else if (node.type === 'line') {
      const curEp = sMap.get('endpoints') as YjsEndpoints | undefined;
      const newEp: YjsEndpoints = {
        start: { x: node.start.x, y: node.start.y },
        end: { x: node.end.x, y: node.end.y },
      };
      if (
        !curEp ||
        curEp.start?.x !== newEp.start.x ||
        curEp.start?.y !== newEp.start.y ||
        curEp.end?.x !== newEp.end.x ||
        curEp.end?.y !== newEp.end.y
      ) {
        sMap.set('endpoints', newEp);
      }
    } else if (node.type === 'bezier') {
      const curEp = sMap.get('endpoints') as YjsEndpoints | undefined;
      if (
        curEp?.start?.x !== node.start.x ||
        curEp?.start?.y !== node.start.y ||
        curEp?.end?.x !== node.end.x ||
        curEp?.end?.y !== node.end.y
      ) {
        sMap.set('endpoints', {
          start: { x: node.start.x, y: node.start.y },
          end: { x: node.end.x, y: node.end.y },
        });
      }
      for (const key of ['control1', 'control2'] as const) {
        const current = sMap.get(key) as { x?: number; y?: number } | undefined;
        if (current?.x !== node[key].x || current?.y !== node[key].y) {
          sMap.set(key, { x: node[key].x, y: node[key].y });
        }
      }
      if (sMap.get('symmetric') !== node.symmetric) sMap.set('symmetric', node.symmetric);
    } else if (node.type === 'arrow') {
      const curEp = sMap.get('endpoints') as YjsEndpoints | undefined;
      const startAnchor = isBindingEndpoint(node.start)
        ? { targetId: node.start.targetId }
        : undefined;
      const endAnchor = isBindingEndpoint(node.end) ? { targetId: node.end.targetId } : undefined;
      const startX = isFreeEndpoint(node.start) ? node.start.x : 0;
      const startY = isFreeEndpoint(node.start) ? node.start.y : 0;
      const endX = isFreeEndpoint(node.end) ? node.end.x : 0;
      const endY = isFreeEndpoint(node.end) ? node.end.y : 0;
      const newEp: YjsEndpoints = {
        start: { x: startX, y: startY, anchor: startAnchor },
        end: { x: endX, y: endY, anchor: endAnchor },
        startMarker: node.startMarker === 'dot' ? 'dot' : undefined,
        endMarker: node.endMarker === 'arrow' ? 'arrow' : undefined,
      };
      if (
        !curEp ||
        curEp.start?.x !== newEp.start.x ||
        curEp.start?.y !== newEp.start.y ||
        curEp.end?.x !== newEp.end.x ||
        curEp.end?.y !== newEp.end.y ||
        curEp.start?.anchor?.targetId !== newEp.start.anchor?.targetId ||
        curEp.end?.anchor?.targetId !== newEp.end.anchor?.targetId ||
        curEp.startMarker !== newEp.startMarker ||
        curEp.endMarker !== newEp.endMarker
      ) {
        sMap.set('endpoints', newEp);
      }
    } else if (node.type === 'text' || node.type === 'sticky') {
      const curGeo = sMap.get('geometry') as YjsGeometry | undefined;
      if (
        !curGeo ||
        curGeo.x !== node.x ||
        curGeo.y !== node.y ||
        curGeo.width !== node.width ||
        curGeo.height !== node.height ||
        curGeo.rotation !== node.rotation
      ) {
        sMap.set('geometry', {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        });
      }
      if (sMap.get('text') !== node.text) {
        const oldText = sMap.get('text') as string | undefined;
        if (oldText !== undefined && oldText !== node.text) {
          this.lastReplacedTextBuffers.push({ shapeId: node.id, text: oldText });
        }
        sMap.set('text', node.text);
      }
      if (sMap.get('fontSize') !== node.fontSize) sMap.set('fontSize', node.fontSize);
      if (sMap.get('fontSizeMode') !== node.fontSizeMode) {
        sMap.set('fontSizeMode', node.fontSizeMode);
      }
      if (sMap.get('fontFamily') !== node.fontFamily) sMap.set('fontFamily', node.fontFamily);
      if (sMap.get('fontWeight') !== node.fontWeight) sMap.set('fontWeight', node.fontWeight);
      if (sMap.get('align') !== node.textAlign) sMap.set('align', node.textAlign);
      // O texto livre mantém a entrelinha fixa da projeção; a nota a sincroniza.
      if (node.type === 'sticky' && sMap.get('lineHeight') !== node.lineHeight) {
        sMap.set('lineHeight', node.lineHeight);
      }
    }
  }

  /**
   * Grava o texto da forma em campos planos, só os que mudaram, para que A mude o texto e B o
   * alinhamento sem se sobrescreverem. Sem `label` apaga os sete: sem `labelText` não há texto.
   */
  private syncLabel(sMap: Y.Map<unknown>, node: LabelableNode): void {
    const label = node.label;
    if (!label) {
      for (const key of LABEL_KEYS) if (sMap.has(key)) sMap.delete(key);
      return;
    }
    const oldText = sMap.get('labelText');
    if (oldText !== label.text) {
      if (typeof oldText === 'string') {
        this.lastReplacedTextBuffers.push({ shapeId: node.id, text: oldText });
      }
      sMap.set('labelText', label.text);
    }
    const fields: Array<[string, unknown]> = [
      ['labelFontSize', label.fontSize],
      ['labelFontFamily', label.fontFamily],
      ['labelFontWeight', label.fontWeight],
      ['labelColor', label.color],
      ['labelAlign', label.textAlign],
      ['labelVerticalAlign', label.verticalAlign],
    ];
    for (const [key, value] of fields) if (sMap.get(key) !== value) sMap.set(key, value);
  }

  /**
   * Envia ou enfileira commit com controle do limite de backlog de 20 MiB (COLLAB-06, COLLAB-12).
   */
  private async dispatchCommit(update: Uint8Array): Promise<void> {
    const currentBacklogBytes = this.pendingCommits.reduce(
      (acc, c) => acc + c.update.byteLength,
      0,
    );
    if (currentBacklogBytes + update.byteLength > this.maxOfflineBacklogBytes) {
      this.setStatus(
        'error',
        createCollaborationError(
          'LIMIT_EXCEEDED',
          'Limite máximo de backlog offline excedido (20 MiB)',
          { currentBacklogBytes, updateBytes: update.byteLength },
        ),
      );
      return;
    }

    const commitId = `commit-${this.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const pending: PendingCommit = { commitId, update, timestamp: Date.now() };
    this.pendingCommits.push(pending);

    if (this._status === 'connected') {
      const res = await this.transport.sendUpdate(this.sessionId, commitId, update, this.roomEpoch);
      if (res.ok) {
        this.pendingCommits = this.pendingCommits.filter((p) => p.commitId !== commitId);
        this.receipts.push(res.receipt);
        for (const l of this.commitReceiptListeners) {
          l(res.receipt);
        }
      } else if (res.code === 'ROOM_EPOCH_MISMATCH') {
        this.setStatus(
          'error',
          createCollaborationError(
            'ROOM_EPOCH_MISMATCH',
            'A sala foi restaurada ou migrada para uma nova epoch incompatível (COLLAB-14)',
          ),
        );
      }
    }
  }

  private async flushPendingCommits(): Promise<void> {
    const toSend = [...this.pendingCommits];
    for (const pending of toSend) {
      const res = await this.transport.sendUpdate(
        this.sessionId,
        pending.commitId,
        pending.update,
        this.roomEpoch,
      );
      if (res.ok) {
        this.pendingCommits = this.pendingCommits.filter((p) => p.commitId !== pending.commitId);
        this.receipts.push(res.receipt);
        for (const l of this.commitReceiptListeners) {
          l(res.receipt);
        }
      }
    }
  }

  handleTransportMessage(msg: TransportMessage): void {
    if (this.isDestroyed) return;

    if (msg.type === 'presence') {
      if (msg.payload === null) {
        this.awareness.handleRemoteDisconnect(msg.senderSessionId);
      } else {
        this.awareness.handleRemoteUpdate(msg.payload as LocalAwarenessState);
      }
    } else if (msg.type === 'update' && msg.payload instanceof Uint8Array) {
      Y.applyUpdate(this.ydoc, msg.payload, 'remote');
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
        this.knownLocalNodeIds = new Set(Object.keys(projected.nodes));
      } finally {
        this.isApplyingRemote = false;
      }
    }
  }
}
