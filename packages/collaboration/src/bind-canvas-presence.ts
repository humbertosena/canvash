import {
  clampZoom,
  screenToWorld,
  shapeBounds,
  type CanvasSectionApi,
  type CanvasPeer,
  type ShapeNode,
} from '@canvash/core';
import { createCollaborationError, err, ok, type Result } from './errors.js';
import { DEFAULT_PRESENCE_TIMEOUT_MS, MAX_PRESENCE_IDS } from './limits.js';
import { lockKey, resolveLocks, type LockContender } from './peer-locks.js';
import { isPresenceExpired } from './presence.js';
import type {
  PresenceDrag,
  PresenceUpdate,
  PresenceView,
  PresenceViolation,
  RemotePresence,
} from './types.js';
import { validatePresence } from './validate-presence.js';

/** O que o vínculo usa de uma sessão de colaboração. */
export interface CanvasPresenceSession {
  readonly sessionId: string;
  updatePresence(update: PresenceUpdate): void;
  getPresences(): readonly RemotePresence[];
  onPresenceChange(listener: (presences: readonly RemotePresence[]) => void): () => void;
}

/** Elemento que recebe o ponteiro: dá o cursor e o tamanho da vista. */
export interface PointerTargetLike extends EventTarget {
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

export interface BindCanvasPresenceOptions {
  readonly session: CanvasPresenceSession;
  readonly section: CanvasSectionApi;
  /** Sem ele, o vínculo não publica o cursor nem a vista. */
  readonly pointerTarget?: PointerTargetLike | undefined;
  /** Recebe cada presença remota descartada por ser inválida. */
  readonly onError?: ((violation: PresenceViolation) => void) | undefined;
  /** Relógio de `selectedAt`. Padrão: `Date.now`. */
  readonly now?: (() => number) | undefined;
  /** Tempo sem notícias para uma presença sair dos peers. Padrão: 30 s. */
  readonly presenceTimeoutMs?: number | undefined;
  /**
   * Chamado uma vez quando a sessão local perde o desempate de um nó e ele sai da seleção
   * local. Recebe o participante que detém o bloqueio.
   */
  readonly onLockLost?: ((nodeId: string, holder: CanvasPeer) => void) | undefined;
}

/** Por que o seguir terminou (ou, ao começar, `user`). */
export type FollowChangeReason = 'user' | 'gesture' | 'left' | 'stopped';

export interface CanvasPresenceBinding {
  /**
   * Passa a seguir um participante, ou para de seguir com `null`. Enquanto segue, o viewport
   * local copia o zoom dele e põe o centro dele no centro de `pointerTarget`. Devolve
   * `NOT_FOUND` se a sessão não está nos peers e `UNSUPPORTED` se ela não publica a vista (ou
   * se não há `pointerTarget` para alinhar).
   */
  follow(sessionId: string | null): Result<void>;
  /** A sessão que está sendo seguida, ou `null`. */
  getFollowing(): string | null;
  /**
   * Avisa cada mudança de quem se segue: `user` (pedido da pessoa), `gesture` (ela mesma
   * navegou), `left` (o seguido saiu ou expirou) e `stopped` (o vínculo foi encerrado).
   */
  onFollowChange(
    listener: (sessionId: string | null, reason: FollowChangeReason) => void,
  ): () => void;
  /** Solta listeners e inscrições, publica o fim do gesto e limpa os peers. Idempotente. */
  destroy(): void;
}

const EPSILON = 1e-6;
const DEFAULT_NAME = 'Participante';

/** Deslocamento comum dos nós do preview, ou `null` se o preview não é um mover. */
function dragOf(section: CanvasSectionApi): PresenceDrag | null {
  const preview = section.getPreview();
  if (preview === null || preview.additions.length > 0) return null;
  const ids = Object.keys(preview.updates);
  if (ids.length === 0 || ids.length > MAX_PRESENCE_IDS) return null;
  const nodes = section.getSnapshot().document.nodes;
  let dx = 0;
  let dy = 0;
  for (const [index, id] of ids.entries()) {
    const before = nodes[id];
    const after = preview.updates[id];
    if (before === undefined || before.type === 'group' || after === undefined) return null;
    const from = shapeBounds(before as ShapeNode);
    const to = shapeBounds(after);
    if (Math.abs(to.width - from.width) > EPSILON || Math.abs(to.height - from.height) > EPSILON) {
      return null;
    }
    const nodeDx = to.x - from.x;
    const nodeDy = to.y - from.y;
    if (index === 0) {
      dx = nodeDx;
      dy = nodeDy;
    } else if (Math.abs(nodeDx - dx) > EPSILON || Math.abs(nodeDy - dy) > EPSILON) {
      return null;
    }
  }
  return Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON ? null : { ids, dx, dy };
}

function toPeer(
  presence: RemotePresence,
  locks: readonly string[],
  released: readonly string[],
  followed: boolean,
): CanvasPeer {
  return {
    sessionId: presence.sessionId,
    name: presence.userName || DEFAULT_NAME,
    color: presence.color,
    ...(presence.avatarUrl === undefined ? {} : { avatarUrl: presence.avatarUrl }),
    cursor: presence.cursor,
    selection: presence.selection,
    selectedAt: presence.selectedAt ?? null,
    drag: presence.drag ?? null,
    view: presence.view ?? null,
    locks,
    ...(released.length === 0 ? {} : { released }),
    followed,
  };
}

/**
 * Liga uma sessão de colaboração a um canvas nos dois sentidos, sem tocar no documento:
 * a presença dos outros vira `section.setPeers`, e a seleção, o arrasto, a vista e o cursor
 * locais viram `session.updatePresence`.
 */
export function bindCanvasPresence(options: BindCanvasPresenceOptions): CanvasPresenceBinding {
  const { session, section, pointerTarget, onError, onLockLost } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.presenceTimeoutMs ?? DEFAULT_PRESENCE_TIMEOUT_MS;
  let destroyed = false;

  const publish = (update: PresenceUpdate): void => {
    if (!destroyed) session.updatePresence(update);
  };

  // Da sessão para o canvas --------------------------------------------------------------------

  /** Presenças remotas válidas e vivas, na última vez que a sessão avisou. */
  let remotes: readonly RemotePresence[] = [];
  let localSelectedAt: number | null = null;
  let refreshQueued = false;
  let following: string | null = null;
  /** A última vista aplicada, para não reaplicar a mesma. */
  let appliedView: PresenceView | null = null;
  /** As chamadas de `setViewport` do vínculo: o resto é gesto da pessoa. */
  let applyingViewport = false;
  const followListeners = new Set<(id: string | null, reason: FollowChangeReason) => void>();

  /** Membro do grupo → ID do grupo, no documento de agora. */
  const groupsOfDocument = (): Map<string, string> => {
    const groupOf = new Map<string, string>();
    for (const node of Object.values(section.getSnapshot().document.nodes)) {
      if (node.type === 'group') for (const childId of node.childIds) groupOf.set(childId, node.id);
    }
    return groupOf;
  };

  /**
   * Board → chaves dos descendentes dele no documento de agora: os filhos e, no lugar dos
   * membros de um grupo filho, o grupo. É o que quem seleciona o board disputa.
   */
  const descendantsOfDocument = (): Map<string, string[]> => {
    const descendants = new Map<string, string[]>();
    for (const node of Object.values(section.getSnapshot().document.nodes)) {
      if (node.type === 'board') descendants.set(node.id, [...node.childIds]);
    }
    return descendants;
  };

  const sameView = (a: PresenceView | null, b: PresenceView | null): boolean =>
    a !== null &&
    b !== null &&
    Math.abs(a.zoom - b.zoom) < 1e-9 &&
    Math.abs(a.center.x - b.center.x) < 1e-6 &&
    Math.abs(a.center.y - b.center.y) < 1e-6;

  const notifyFollow = (id: string | null, reason: FollowChangeReason): void => {
    for (const listener of followListeners) listener(id, reason);
  };

  function stopFollowing(reason: FollowChangeReason): void {
    if (following === null) return;
    following = null;
    appliedView = null;
    notifyFollow(null, reason);
  }

  /** Copia a vista do seguido para o viewport local: o mesmo zoom e o centro dele no meio. */
  function mirrorFollowed(): void {
    if (following === null || pointerTarget === undefined) return;
    const view = remotes.find((remote) => remote.sessionId === following)?.view ?? null;
    if (view === null || sameView(view, appliedView)) return;
    const rect = pointerTarget.getBoundingClientRect();
    const zoom = clampZoom(view.zoom);
    applyingViewport = true;
    try {
      const result = section.setViewport({
        x: rect.width / 2 - view.center.x * zoom,
        y: rect.height / 2 - view.center.y * zoom,
        zoom,
      });
      if (!result.ok) {
        if (result.error.code === 'REENTRANT_DISPATCH') scheduleRefresh();
        return;
      }
    } finally {
      applyingViewport = false;
    }
    appliedView = view;
  }

  /**
   * Refaz a lista de peers com os bloqueios decididos e, se a sessão local perdeu algum nó,
   * tira-o da seleção. Não pode rodar dentro de uma notificação do canvas: nesse caso a chamada
   * é adiada para a próxima microtarefa.
   */
  const applyPeers = (): void => {
    if (destroyed) return;
    const groupOf = groupsOfDocument();
    const localSelection = section.getSnapshot().session.selectedIds;
    const contenders: LockContender[] = [
      ...remotes.map((remote) => ({
        sessionId: remote.sessionId,
        selectedAt: remote.selectedAt,
        selection: remote.selection,
      })),
      { sessionId: session.sessionId, selectedAt: localSelectedAt, selection: localSelection },
    ];
    const descendantsOf = descendantsOfDocument();
    const winners = resolveLocks(contenders, groupOf, descendantsOf);
    /** Os descendentes dos boards que o participante detém e que outro venceu: o bloqueio do board não os alcança. */
    const releasedBy = (remote: RemotePresence): string[] => {
      const released = new Set<string>();
      for (const id of remote.selection) {
        const descendants = descendantsOf.get(id);
        if (descendants === undefined || winners.get(lockKey(id, groupOf)) !== remote.sessionId) {
          continue;
        }
        for (const key of descendants) {
          if (winners.get(key) !== remote.sessionId) released.add(key);
        }
      }
      return [...released].slice(0, MAX_PRESENCE_IDS);
    };
    const peers = remotes.map((remote) =>
      toPeer(
        remote,
        remote.selection.filter((id) => winners.get(lockKey(id, groupOf)) === remote.sessionId),
        releasedBy(remote),
        remote.sessionId === following,
      ),
    );
    // O seguido que saiu (ou expirou) encerra o seguir antes de a lista ser publicada.
    if (following !== null && !remotes.some((remote) => remote.sessionId === following)) {
      stopFollowing('left');
      return applyPeers();
    }
    const placed = section.setPeers(peers);
    if (!placed.ok && placed.error.code === 'REENTRANT_DISPATCH') {
      scheduleRefresh();
      return;
    }
    mirrorFollowed();

    const lost = localSelection.filter((id) => {
      const winner = winners.get(lockKey(id, groupOf));
      return winner !== undefined && winner !== session.sessionId;
    });
    if (lost.length === 0) return;
    const kept = localSelection.filter((id) => !lost.includes(id));
    const changed = section.setSelection(kept);
    if (!changed.ok) {
      if (changed.error.code === 'REENTRANT_DISPATCH') scheduleRefresh();
      return;
    }
    for (const id of lost) {
      const holder = peers.find((peer) => peer.sessionId === winners.get(lockKey(id, groupOf)));
      if (holder) onLockLost?.(id, holder);
    }
  };

  function scheduleRefresh(): void {
    if (refreshQueued || destroyed) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      applyPeers();
    });
  }

  const syncPeers = (presences: readonly RemotePresence[]): void => {
    if (destroyed) return;
    const valid: RemotePresence[] = [];
    for (const presence of presences) {
      if (presence.sessionId === session.sessionId) continue;
      if (isPresenceExpired(presence, timeoutMs)) continue;
      const checked = validatePresence(presence, {
        origin: typeof location === 'undefined' ? undefined : location.origin,
      });
      if (!checked.ok) {
        onError?.(checked.error);
        continue;
      }
      valid.push(presence);
    }
    remotes = valid;
    applyPeers();
  };

  // Do canvas para a sessão --------------------------------------------------------------------

  let selectionKey: string | null = null;
  let previousSelection: readonly string[] = [];
  const publishSelection = (): void => {
    const ids = section.getSnapshot().session.selectedIds;
    const key = ids.join('\u0000');
    if (key === selectionKey) return;
    selectionKey = key;
    // Só tirar nós da seleção (por exemplo, ao perder um bloqueio) não renova o desempate.
    const onlyRemoved = ids.every((id) => previousSelection.includes(id));
    previousSelection = ids;
    if (ids.length === 0) localSelectedAt = null;
    else if (!onlyRemoved || localSelectedAt === null) localSelectedAt = now();
    publish({
      selection: ids,
      ...(ids.length > 0 && localSelectedAt !== null ? { selectedAt: localSelectedAt } : {}),
    });
  };

  let dragKey = 'null';
  const publishDrag = (): void => {
    const drag = dragOf(section);
    const key = JSON.stringify(drag);
    if (key === dragKey) return;
    dragKey = key;
    publish({ drag });
  };

  let viewKey = '';
  const publishView = (): void => {
    if (pointerTarget === undefined) return;
    const rect = pointerTarget.getBoundingClientRect();
    const viewport = section.getSnapshot().session.viewport;
    const center = screenToWorld(viewport, { x: rect.width / 2, y: rect.height / 2 });
    const view: PresenceView = { center, zoom: viewport.zoom };
    const key = JSON.stringify(view);
    if (key === viewKey) return;
    viewKey = key;
    publish({ view });
  };

  const onPointerMove = (event: Event): void => {
    if (pointerTarget === undefined) return;
    const { clientX, clientY } = event as PointerEvent;
    const rect = pointerTarget.getBoundingClientRect();
    const world = screenToWorld(section.getSnapshot().session.viewport, {
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
    publish({ cursor: world });
  };
  const onPointerLeave = (): void => publish({ cursor: null });

  const unsubscribeSection = section.subscribe((change) => {
    // Mudança de viewport que não é do vínculo: a pessoa navegou, então o seguir acaba.
    if (change.areas.includes('viewport') && following !== null && !applyingViewport) {
      stopFollowing('gesture');
      scheduleRefresh();
    }
    if (change.areas.includes('selection')) {
      publishSelection();
      scheduleRefresh();
    }
    if (change.areas.includes('document')) scheduleRefresh();
    if (change.areas.includes('preview')) publishDrag();
    if (change.areas.includes('viewport')) publishView();
  });
  const unsubscribePresence = session.onPresenceChange(syncPeers);
  pointerTarget?.addEventListener('pointermove', onPointerMove);
  pointerTarget?.addEventListener('pointerleave', onPointerLeave);

  publishSelection();
  publishView();
  syncPeers(session.getPresences());

  return {
    follow(sessionId) {
      if (sessionId === null) {
        stopFollowing('user');
        applyPeers();
        return ok(undefined);
      }
      const target = remotes.find((remote) => remote.sessionId === sessionId);
      if (target === undefined) {
        return err(createCollaborationError('NOT_FOUND', 'A pessoa não está na sessão'));
      }
      if (target.view === undefined || target.view === null || pointerTarget === undefined) {
        return err(createCollaborationError('UNSUPPORTED', 'Não dá para seguir esta pessoa'));
      }
      if (following === sessionId) return ok(undefined);
      following = sessionId;
      appliedView = null;
      notifyFollow(sessionId, 'user');
      mirrorFollowed();
      applyPeers();
      return ok(undefined);
    },
    getFollowing: () => following,
    onFollowChange(listener) {
      followListeners.add(listener);
      return () => followListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      stopFollowing('stopped');
      publish({ cursor: null, drag: null });
      destroyed = true;
      unsubscribeSection();
      unsubscribePresence();
      pointerTarget?.removeEventListener('pointermove', onPointerMove);
      pointerTarget?.removeEventListener('pointerleave', onPointerLeave);
      section.setPeers([]);
    },
  };
}
