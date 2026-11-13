import {
  bindCanvasPresence,
  createCollaborationError,
  err,
  ok,
  type CanvasPresenceBinding,
  type FollowChangeReason,
  toShellParticipants,
  type RemotePresence,
  type Result,
  type ShellParticipantLike,
} from '@canvash/collaboration';
import {
  CollaborativeServerEmulator,
  DeterministicTransportHub,
  YjsCollaborationSession,
  type LocalAwarenessState,
  type TransportMessage,
} from '@canvash/collaboration-yjs';
import * as Y from 'yjs';
import type { CanvasSectionApi, CanvasDocument, CanvasPeer } from '@canvash/core';
import { boardExportFileName, exportPng, exportSvg } from '@canvash/export';
import {
  createAutosaveManager,
  IndexedDbStorageAdapter,
  type AutosaveManager,
  type AutosaveStatus,
} from '@canvash/persistence';

export const RENDER_01_FIXTURE: CanvasDocument = {
  schemaVersion: 1,
  id: 'fixture-render-01',
  nodes: {
    'bg-rect': {
      id: 'bg-rect',
      type: 'rectangle',
      x: 50,
      y: 50,
      width: 300,
      height: 200,
      rotation: 0,
      visible: true,
      locked: false,
      style: {
        fill: '#2563eb',
        stroke: '#1d4ed8',
        strokeWidth: 2,
        opacity: 1,
      },
    },
    'diag-line': {
      id: 'diag-line',
      type: 'line',
      start: { x: 40, y: 40 },
      end: { x: 360, y: 260 },
      visible: true,
      locked: false,
      style: {
        stroke: '#dc2626',
        strokeWidth: 6,
        opacity: 1,
      },
    },
    'overlap-rect': {
      id: 'overlap-rect',
      type: 'rectangle',
      x: 180,
      y: 120,
      width: 220,
      height: 160,
      rotation: 0.25,
      visible: true,
      locked: false,
      style: {
        fill: '#16a34a',
        stroke: '#15803d',
        strokeWidth: 4,
        opacity: 0.9,
      },
    },
    'overlap-ellipse': {
      id: 'overlap-ellipse',
      type: 'ellipse',
      x: 280,
      y: 70,
      width: 180,
      height: 120,
      rotation: -0.3,
      visible: true,
      locked: false,
      style: {
        fill: '#ea580c',
        stroke: '#c2410c',
        strokeWidth: 3,
        opacity: 0.85,
      },
    },
    'hidden-in-visible-layer': {
      id: 'hidden-in-visible-layer',
      type: 'rectangle',
      x: 80,
      y: 80,
      width: 100,
      height: 100,
      rotation: 0,
      visible: false,
      locked: false,
      style: {
        fill: '#9333ea',
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
      },
    },
    'item-in-hidden-layer': {
      id: 'item-in-hidden-layer',
      type: 'ellipse',
      x: 60,
      y: 60,
      width: 150,
      height: 150,
      rotation: 0,
      visible: true,
      locked: false,
      style: {
        fill: '#facc15',
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
      },
    },
  },
  layers: [
    {
      id: 'layer-back',
      name: 'Camada de Fundo',
      visible: true,
      locked: false,
      childIds: ['bg-rect', 'diag-line'],
    },
    {
      id: 'layer-middle',
      name: 'Camada Intermediária',
      visible: true,
      locked: false,
      childIds: ['overlap-rect', 'overlap-ellipse', 'hidden-in-visible-layer'],
    },
    {
      id: 'layer-hidden',
      name: 'Camada Oculta',
      visible: false,
      locked: false,
      childIds: ['item-in-hidden-layer'],
    },
  ],
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface CrossTabMessage {
  type: 'update' | 'presence' | 'sync:request' | 'sync:response';
  commitId?: string;
  payload?: number[] | LocalAwarenessState | null;
  senderSessionId: string;
  targetSessionId?: string;
  snapshot?: number[];
  /** Pedido de volta: quem respondeu a um recém-chegado pede o estado dele, sem outro retorno. */
  reciprocal?: boolean;
}

/** Estado do compartilhamento ao vivo, o mesmo `sharing` do `<canvas-section>`. */
export type SharingState = 'off' | 'connecting' | 'on';

export interface CollabPersistenceOptions {
  section: CanvasSectionApi;
  canvasContainer: HTMLElement | null;
  appName?: string;
  onAutosaveStatusChange?: (statusText: string) => void;
  onCollabInfoChange?: (infoText: string) => void;
  /** O compartilhamento mudou de estado: o host reflete na pill e no botão do playground. */
  onSharingChange?: (state: SharingState) => void;
  /** Outra pessoa passou a deter um nó que a sessão local tinha selecionado. */
  onLockLost?: (nodeId: string, holder: CanvasPeer) => void;
  /** Quem está na sessão mudou: a lista para a pilha e a ilha de participantes do shell. */
  onParticipantsChange?: (participants: ShellParticipantLike[]) => void;
  /**
   * Quem a sessão local segue mudou (`null` ao parar). `name` é o nome de quem era seguido, para
   * o aviso quando ele sai.
   */
  onFollowChange?: (
    sessionId: string | null,
    reason: FollowChangeReason,
    name: string | null,
  ) => void;
}

export interface CollabPersistenceHandle {
  storage: IndexedDbStorageAdapter;
  autosave: AutosaveManager;
  /** A sessão Yjs só existe enquanto o compartilhamento está ligado. */
  getSession: () => YjsCollaborationSession | null;
  server: CollaborativeServerEmulator;
  transport: DeterministicTransportHub;
  /** A URL pediu a colaboração (`?collab`): o host chama `startSharing` depois da carga. */
  autoShare: boolean;
  getSharing: () => SharingState;
  startSharing: () => Promise<Result<void>>;
  stopSharing: () => Promise<Result<void>>;
  saveNow: () => Promise<void>;
  loadSaved: () => Promise<void>;
  resetDoc: () => Promise<void>;
  exportSvgDoc: () => Promise<void>;
  exportPngDoc: () => Promise<void>;
  /** Exporta só o board `boardId` e baixa o arquivo com o título dele como nome. */
  exportBoard: (boardId: string, format: 'png' | 'svg') => Promise<void>;
  toggleCollab: () => Promise<boolean>;
  /** Segue um participante, ou para de seguir com `null`. */
  follow: (sessionId: string | null) => Result<void>;
  getFollowing: () => string | null;
  openNewTab: () => void;
  isCollabConnected: () => boolean;
  destroy: () => void;
}

const USER_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#d97706'];

export function createCollabPersistenceManager(
  options: CollabPersistenceOptions,
): CollabPersistenceHandle {
  const {
    section,
    canvasContainer,
    appName = 'App',
    onAutosaveStatusChange,
    onCollabInfoChange,
    onSharingChange,
    onLockLost,
    onParticipantsChange,
    onFollowChange,
  } = options;
  const DOC_STORAGE_KEY = 'playground-document';

  const urlParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forceCollab =
    urlParams?.get('collab') === 'true' ||
    urlParams?.get('collab') === '1' ||
    Boolean(urlParams?.has('collab'));
  const isAutomatedTest =
    typeof navigator !== 'undefined' && navigator.webdriver === true && !forceCollab;
  // Cada sala tem canal e snapshot próprios: `?room=` isola os cenários que compartilham o navegador.
  const room = urlParams?.get('room') ?? '';
  const roomSuffix = room ? `:${room}` : '';
  const CHANNEL_NAME = `canvash-playground-collab${roomSuffix}`;
  const COLLAB_CANONICAL_KEY = `canvash:collab-canonical-snapshot${roomSuffix}`;
  const RELAYER_ID = 'cross-tab-relayer';
  // Só com automação: desloca o relógio de `selectedAt` para as jornadas de desempate decidirem
  // quem seleciona primeiro sem depender da ordem real dos cliques.
  const selectedAtNow = (): number => {
    const offset =
      typeof navigator !== 'undefined' && navigator.webdriver === true
        ? Number(
            (window as { __CANVASH_TEST_SELECTED_AT_OFFSET__?: number })
              .__CANVASH_TEST_SELECTED_AT_OFFSET__ ?? 0,
          )
        : 0;
    return Date.now() + (Number.isFinite(offset) ? offset : 0);
  };
  const noView =
    typeof navigator !== 'undefined' &&
    navigator.webdriver === true &&
    urlParams?.get('noview') === '1';
  // Só com automação: acelera a expiração de presença para as jornadas de teste.
  const presenceTimeoutParam = Number(urlParams?.get('presenceTimeout'));
  const presenceTimeoutMs =
    typeof navigator !== 'undefined' &&
    navigator.webdriver === true &&
    Number.isFinite(presenceTimeoutParam) &&
    presenceTimeoutParam >= 100
      ? presenceTimeoutParam
      : undefined;
  // O snapshot canônico leva o documento de uma aba a outra. Os testes automatizados só o usam
  // com uma sala própria (`?room=`), que isola o navegador compartilhado entre os cenários.
  const useCanonical = !isAutomatedTest || room !== '';

  // 1. Persistência & Autosave (IndexedDB)
  const storage = new IndexedDbStorageAdapter({ dbName: 'canvash-playground-db' });

  const notifyAutosave = (status: AutosaveStatus, customText?: string) => {
    if (!onAutosaveStatusChange) return;
    if (customText) {
      onAutosaveStatusChange(`💾 Autosave: ${customText}`);
      return;
    }
    switch (status) {
      case 'idle':
      case 'saved':
        notifyAutosave(
          'idle',
          `Salvo (Rev ${autosave?.lastSavedRevision > 0 ? autosave.lastSavedRevision : 1})`,
        );
        break;
      case 'saving':
        notifyAutosave('saving', 'Salvando...');
        break;
      case 'error':
        notifyAutosave('error', 'Erro ao salvar');
        break;
    }
  };

  const autosave = createAutosaveManager(section, storage, {
    key: DOC_STORAGE_KEY,
    debounceMs: 500,
    onStatusChange: (status) => {
      notifyAutosave(status);
    },
  });

  // Tenta restaurar estado anterior do IndexedDB para usuários humanos. O compartilhamento espera
  // este passo, para não entrar na sala com um documento que logo seria trocado.
  let restoreDone: Promise<void> = Promise.resolve();
  if (!isAutomatedTest) {
    restoreDone = storage
      .load(DOC_STORAGE_KEY)
      .then((loadRes) => {
        if (
          loadRes.ok &&
          loadRes.value &&
          loadRes.value.document &&
          Object.keys(loadRes.value.document.nodes).length > 0
        ) {
          section.replaceDocument(loadRes.value.document);
          notifyAutosave('idle', `Restaurado do IndexedDB (Rev ${loadRes.value.revision})`);
        } else {
          notifyAutosave('idle', 'Pronto');
        }
      })
      .catch(() => {
        notifyAutosave('idle', 'Pronto');
      });
  } else {
    notifyAutosave('idle', 'Pronto');
  }

  // 2. Colaboração em tempo real (BroadcastChannel & Yjs): nasce no startSharing e sai no stopSharing
  const myColor = USER_PALETTE[Math.floor(Math.random() * USER_PALETTE.length)] ?? '#2563eb';
  const myUserId = `user_${Math.random().toString(36).slice(2, 6)}`;
  // Só com automação: um nome escolhido pela jornada de teste (por exemplo, com marcação HTML).
  const testName =
    typeof navigator !== 'undefined' && navigator.webdriver === true
      ? urlParams?.get('name')
      : null;
  const myUserName = testName || `${appName} ${myUserId.slice(-3).toUpperCase()}`;
  const mySessionId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const server = new CollaborativeServerEmulator('epoch-collab');
  const transport = new DeterministicTransportHub(server);

  let sharing: SharingState = 'off';
  let destroyed = false;
  let hasShared = false;
  let session: YjsCollaborationSession | null = null;
  let channel: BroadcastChannel | null = null;
  let unsubscribePresence: (() => void) | null = null;
  let binding: CanvasPresenceBinding | null = null;
  let followedName: string | null = null;
  let unsubscribePeers: (() => void) | null = null;

  const setSharing = (next: SharingState): void => {
    sharing = next;
    onSharingChange?.(next);
  };

  const loadCanonicalSnapshot = (): Uint8Array | null => {
    if (!useCanonical || typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(COLLAB_CANONICAL_KEY);
    if (!stored) return null;
    try {
      const binary = atob(stored);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      return null;
    }
  };

  const saveCanonicalSnapshot = (): void => {
    if (!useCanonical || typeof localStorage === 'undefined' || !session) return;
    try {
      const canonicalBytes = Y.encodeStateAsUpdate(session.getYDoc());
      let binary = '';
      for (let i = 0; i < canonicalBytes.byteLength; i++) {
        binary += String.fromCharCode(canonicalBytes[i]!);
      }
      localStorage.setItem(COLLAB_CANONICAL_KEY, btoa(binary));
    } catch {
      // Ignora erro de cota
    }
  };

  const openChannel = (active: YjsCollaborationSession): BroadcastChannel | null => {
    if (typeof BroadcastChannel === 'undefined') return null;
    const next = new BroadcastChannel(CHANNEL_NAME);

    transport.registerClient(RELAYER_ID, (msg: TransportMessage) => {
      if (msg.type === 'update' && msg.payload instanceof Uint8Array) {
        const crossMsg: CrossTabMessage = {
          type: 'update',
          commitId: msg.commitId,
          payload: Array.from(msg.payload),
          senderSessionId: mySessionId,
        };
        next.postMessage(crossMsg);
      } else if (msg.type === 'presence') {
        const crossMsg: CrossTabMessage = {
          type: 'presence',
          payload: msg.payload as LocalAwarenessState | null,
          senderSessionId: mySessionId,
        };
        next.postMessage(crossMsg);
      }
    });

    next.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      const msg = event.data;
      if (!msg || msg.senderSessionId === mySessionId) return;

      if (msg.type === 'sync:request') {
        if (msg.targetSessionId && msg.targetSessionId !== mySessionId) return;
        const fullDocUpdate = Y.encodeStateAsUpdate(active.getYDoc());
        const responseMsg: CrossTabMessage = {
          type: 'sync:response',
          targetSessionId: msg.senderSessionId,
          senderSessionId: mySessionId,
          snapshot: Array.from(fullDocUpdate),
        };
        next.postMessage(responseMsg);
        // Cada página nasce com itens próprios no Yjs: quem chega precisa do estado de quem já
        // estava, e quem já estava precisa do de quem chegou, ou as edições dele ficam pendentes.
        if (!msg.reciprocal) {
          const backMsg: CrossTabMessage = {
            type: 'sync:request',
            senderSessionId: mySessionId,
            targetSessionId: msg.senderSessionId,
            reciprocal: true,
          };
          next.postMessage(backMsg);
        }
        return;
      }

      if (msg.type === 'sync:response' && msg.targetSessionId === mySessionId) {
        if (msg.snapshot && msg.snapshot.length > 0) {
          const uint8 = new Uint8Array(msg.snapshot);
          server.commitUpdate(`sync-${Date.now()}`, uint8, 'epoch-collab');
          active.handleTransportMessage({
            type: 'update',
            commitId: `sync-${Date.now()}`,
            payload: uint8,
            senderSessionId: msg.senderSessionId,
          });
        }
        return;
      }

      if (msg.type === 'update' && msg.payload && msg.commitId) {
        const uint8 = new Uint8Array(msg.payload as number[]);
        server.commitUpdate(msg.commitId, uint8, 'epoch-collab');
        active.handleTransportMessage({
          type: 'update',
          commitId: msg.commitId,
          payload: uint8,
          senderSessionId: msg.senderSessionId,
        });
        saveCanonicalSnapshot();
      } else if (msg.type === 'presence') {
        active.handleTransportMessage({
          type: 'presence',
          payload: msg.payload as LocalAwarenessState | null,
          senderSessionId: msg.senderSessionId,
        });
      }
    };

    const requestMsg: CrossTabMessage = {
      type: 'sync:request',
      senderSessionId: mySessionId,
    };
    next.postMessage(requestMsg);
    return next;
  };

  const closeChannel = (): void => {
    transport.unregisterClient(RELAYER_ID);
    if (channel) {
      channel.onmessage = null;
      channel.close();
      channel = null;
    }
  };

  const notifyCollabInfo = (presences: readonly RemotePresence[]): void => {
    if (!onCollabInfoChange) return;
    if (sharing !== 'on') {
      onCollabInfoChange('👥 Colab: Desconectado');
      return;
    }
    const others = presences.filter((p) => p.sessionId !== mySessionId);
    if (others.length === 0) {
      onCollabInfoChange(`👥 Colab: 1 conectado (Você: ${myUserName})`);
    } else {
      const names = others.map((p) => p.userName).join(', ');
      onCollabInfoChange(
        `👥 Colab: ${others.length + 1} conectados (Você: ${myUserName} | Remotos: ${names})`,
      );
    }
  };

  // Fechar a aba avisa os pares na hora (presença nula), sem esperar a expiração.
  const handlePageHide = (): void => {
    session?.destroy();
  };

  /** Escuta de presença e vínculo com o canvas: tudo o que só vale com a sessão ligada. */
  const attachLiveParts = (active: YjsCollaborationSession): void => {
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    unsubscribePresence = active.onPresenceChange(notifyCollabInfo);
    const emitParticipants = (): void => {
      onParticipantsChange?.(
        toShellParticipants(section.getPeers(), {
          id: mySessionId,
          name: myUserName,
          color: myColor,
        }),
      );
    };
    unsubscribePeers = section.subscribe((change) => {
      if (change.areas.includes('peers')) emitParticipants();
    });
    emitParticipants();
    binding = bindCanvasPresence({
      session: active,
      section: section,
      // Só com automação: `?noview=1` simula um cliente que não publica a vista nem o cursor.
      pointerTarget: noView ? undefined : (canvasContainer ?? undefined),
      presenceTimeoutMs,
      onLockLost,
      now: selectedAtNow,
    });
    binding.onFollowChange((sessionId, reason) => {
      const name = followedName;
      if (sessionId === null) followedName = null;
      onFollowChange?.(sessionId, reason, sessionId === null ? name : followedName);
    });
  };

  /** Desfaz o que o startSharing criou, na ordem inversa. Idempotente. */
  const releaseSharing = (): void => {
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
    unsubscribePresence?.();
    unsubscribePresence = null;
    unsubscribePeers?.();
    unsubscribePeers = null;
    onParticipantsChange?.([]);
    binding?.destroy();
    binding = null;
    closeChannel();
    session = null;
  };

  const startSharing = async (): Promise<Result<void>> => {
    if (sharing !== 'off') return ok(undefined);
    setSharing('connecting');
    await restoreDone;
    if (destroyed) {
      sharing = 'off';
      return err(createCollaborationError('DISCONNECTED', 'O gerenciador já foi destruído'));
    }
    // O que a pessoa editou fora do compartilhamento: volta por cima do estado da sala ao religar.
    const localBefore = section.getSnapshot().document;
    try {
      const canonical = loadCanonicalSnapshot();
      if (canonical) {
        server.commitUpdate(`init-${Date.now()}`, canonical, 'epoch-collab');
      }
      const next = new YjsCollaborationSession(
        transport,
        {
          documentId: 'playground-collab-doc',
          section: section,
          roomEpoch: 'epoch-collab',
          presenceTimeoutMs,
          user: {
            id: myUserId,
            name: myUserName,
            color: myColor,
          },
        },
        mySessionId,
        server.getSnapshot(),
      );
      session = next;
      // O canal abre antes de reaplicar as edições locais, para elas chegarem aos outros.
      channel = openChannel(next);
      if (
        hasShared &&
        JSON.stringify(section.getSnapshot().document) !== JSON.stringify(localBefore)
      ) {
        section.replaceDocument(localBefore);
      }
      hasShared = true;
      if (!canonical) saveCanonicalSnapshot();
      attachLiveParts(next);
      setSharing('on');
      notifyCollabInfo(next.getPresences());
      return ok(undefined);
    } catch (cause) {
      session?.destroy();
      releaseSharing();
      setSharing('off');
      notifyCollabInfo([]);
      return err(
        createCollaborationError(
          'CONNECTION_FAILED',
          cause instanceof Error ? cause.message : 'Não foi possível conectar',
          cause,
        ),
      );
    }
  };

  const stopSharing = async (): Promise<Result<void>> => {
    const active = session;
    if (sharing !== 'on' || !active) return ok(undefined);
    const left = await active.leave();
    // PENDING_CHANGES: continua ligado, para não perder alteração ainda não confirmada.
    if (!left.ok) return left;
    releaseSharing();
    setSharing('off');
    notifyCollabInfo([]);
    return ok(undefined);
  };

  notifyCollabInfo([]);

  // Comandos de Persistência
  const saveNow = async (): Promise<void> => {
    notifyAutosave('saving', 'Salvando...');
    const loadRes = await storage.load(DOC_STORAGE_KEY);
    const expectedRevision = loadRes.ok && loadRes.value ? loadRes.value.revision : undefined;
    const res = await storage.save(DOC_STORAGE_KEY, section.getSnapshot().document, {
      expectedRevision,
    });
    if (res.ok) {
      notifyAutosave(
        'saved',
        `Salvo manualmente às ${new Date().toLocaleTimeString()} (Rev ${res.value.revision})`,
      );
    } else {
      notifyAutosave('error', `Falha ao salvar: ${res.error.message}`);
    }
  };

  const loadSaved = async (): Promise<void> => {
    const res = await storage.load(DOC_STORAGE_KEY);
    if (res.ok && res.value && res.value.document) {
      section.replaceDocument(res.value.document);
      notifyAutosave('saved', `Carregado do IndexedDB (Rev ${res.value.revision})`);
    } else {
      alert('Nenhum documento salvo encontrado no IndexedDB.');
    }
  };

  const resetDoc = async (): Promise<void> => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(COLLAB_CANONICAL_KEY);
    }
    section.replaceDocument(RENDER_01_FIXTURE);
    await saveNow();
    notifyAutosave('saved', 'Resetado para fixture padrão');
  };

  const exportSvgDoc = async (): Promise<void> => {
    const res = await exportSvg(section, { scope: 'document' });
    if (res.ok) {
      const blob = new Blob([res.value], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(blob, `canvash-${appName.toLowerCase()}-document.svg`);
    } else {
      alert(`Falha ao exportar SVG: ${res.error.message}`);
    }
  };

  const exportPngDoc = async (): Promise<void> => {
    const res = await exportPng(section, { scope: 'document', scale: 2 });
    if (res.ok) {
      downloadBlob(res.value, `canvash-${appName.toLowerCase()}-document.png`);
    } else {
      alert(`Falha ao exportar PNG: ${res.error.message}`);
    }
  };

  /**
   * Exporta só o board (recortado no retângulo dele, sem o título) e baixa o arquivo com o título
   * como nome. Em erro, avisa com a mensagem, como `exportSvgDoc` e `exportPngDoc`.
   */
  const exportBoard = async (boardId: string, format: 'png' | 'svg'): Promise<void> => {
    const node = section.getSnapshot().document.nodes[boardId];
    const filename = boardExportFileName(node?.type === 'board' ? node.title : '', format);
    const scope = { board: boardId };
    if (format === 'svg') {
      const res = await exportSvg(section, { scope });
      if (res.ok) {
        downloadBlob(new Blob([res.value], { type: 'image/svg+xml;charset=utf-8' }), filename);
      } else {
        alert(`Falha ao exportar SVG: ${res.error.message}`);
      }
    } else {
      const res = await exportPng(section, { scope, scale: 2 });
      if (res.ok) {
        downloadBlob(res.value, filename);
      } else {
        alert(`Falha ao exportar PNG: ${res.error.message}`);
      }
    }
  };

  const toggleCollab = async (): Promise<boolean> => {
    if (sharing === 'off') await startSharing();
    else if (sharing === 'on') await stopSharing();
    return sharing === 'on';
  };

  /** Segue (ou, com `null`, para de seguir) um participante: o viewport local o acompanha. */
  const follow = (sessionId: string | null): Result<void> => {
    if (binding === null) {
      return err(createCollaborationError('DISCONNECTED', 'O compartilhamento não está ligado'));
    }
    if (sessionId !== null) {
      followedName = section.getPeers().find((peer) => peer.sessionId === sessionId)?.name ?? null;
    }
    return binding.follow(sessionId);
  };

  const openNewTab = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('collab', 'true');
    window.open(url.toString(), '_blank');
  };

  const destroy = (): void => {
    destroyed = true;
    session?.destroy();
    releaseSharing();
    sharing = 'off';
  };

  return {
    storage,
    autosave,
    getSession: () => session,
    server,
    transport,
    autoShare: forceCollab,
    getSharing: () => sharing,
    startSharing,
    stopSharing,
    saveNow,
    loadSaved,
    resetDoc,
    exportSvgDoc,
    exportPngDoc,
    exportBoard,
    toggleCollab,
    follow,
    getFollowing: () => binding?.getFollowing() ?? null,
    openNewTab,
    isCollabConnected: () => sharing === 'on',
    destroy,
  };
}

/**
 * Aviso de que outra pessoa passou a editar o texto que a sessão local estava editando. O editor
 * já fechou sem gravar; o botão copia o que foi digitado. O nome e o texto entram sempre como
 * texto, nunca como HTML.
 */
export function showSupersededNotice(holderName: string, text: string): void {
  document.getElementById('superseded-notice')?.remove();
  const notice = document.createElement('div');
  notice.id = 'superseded-notice';
  notice.setAttribute('data-testid', 'superseded-notice');
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:100;display:flex;' +
    'gap:12px;align-items:center;padding:8px 14px;border-radius:10px;background:#1f1f1f;' +
    'color:#ffffff;font:14px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.25);';
  const message = document.createElement('span');
  message.textContent = `${holderName} já está editando este elemento`;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.setAttribute('data-testid', 'copy-my-text');
  copy.textContent = 'Copiar meu texto';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(text).finally(() => notice.remove());
  });
  notice.append(message, copy);
  document.body.appendChild(notice);
}
