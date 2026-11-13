import type { CanvasSectionApi } from '@canvash/core';
import { createCanvasSection, POLYGON_PRESETS } from '@canvash/core';
import {
  defineCanvasElements,
  CanvasControlsElement,
  CanvasSurfaceElement,
  CanvasLayersElement,
  CanvasPropertiesElement,
  CanvasSelectionMenuElement,
  CanvasSectionElement,
  CanvasToolbarElement,
  type ExportBoardRequestEvent,
  type ExportRequestEventDetail,
  type ShareRequestEvent,
  type ShellMenuItem,
  type ShellUser,
} from '@canvash/web-components';
import {
  createCollabPersistenceManager,
  showSupersededNotice,
  type CollabPersistenceHandle,
} from './collab-persistence.js';

// 1. Registra explicitamente os custom elements via ESM puro
defineCanvasElements();

export interface WcPlayground {
  canvas: CanvasSurfaceElement;
  toolbar?: CanvasToolbarElement | undefined;
  layers?: CanvasLayersElement | undefined;
  properties?: CanvasPropertiesElement | undefined;
  controls?: CanvasControlsElement | undefined;
  selectionMenu?: CanvasSelectionMenuElement | undefined;
  shell?: CanvasSectionElement | undefined;
  events: Array<{ type: string; detail: unknown }>;
  createCanvasSection: typeof createCanvasSection;
  collab?: CollabPersistenceHandle | null;
}

declare global {
  interface Window {
    __CANVASH_WC__?: WcPlayground;
  }
}

const canvasEl = document.getElementById('wc-canvas') as CanvasSurfaceElement | null;
const toolbarEl = document.getElementById('wc-toolbar') as CanvasToolbarElement | null;
const layersEl = document.getElementById('wc-layers') as CanvasLayersElement | null;
const propertiesEl = document.getElementById('wc-properties') as CanvasPropertiesElement | null;
const controlsEl = document.getElementById('wc-controls') as CanvasControlsElement | null;
const selectionMenuEl = document.getElementById(
  'wc-selection-menu',
) as CanvasSelectionMenuElement | null;
const shellEl = document.getElementById('wc-shell') as CanvasSectionElement | null;
const eventLog = document.getElementById('event-log');
const eventsReceived: Array<{ type: string; detail: unknown }> = [];

let collabManager: CollabPersistenceHandle | null = null;
const autosaveInfoEl = document.getElementById('autosave-info');
const collabInfoEl = document.getElementById('collab-info');
const btnToggleCollab = document.getElementById('btn-toggle-collab');

// Aviso passageiro (`role="status"`) para o menu, o compartilhar e o avatar.
const statusEl = document.getElementById('app-status');
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const notify = (message: string) => {
  if (!statusEl) return;
  statusEl.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 3000);
};

const initCollabPersistence = (section: CanvasSectionApi) => {
  if (collabManager) {
    collabManager.destroy();
    collabManager = null;
  }
  const canvasArea = document.querySelector('.canvas-area') as HTMLElement | null;
  collabManager = createCollabPersistenceManager({
    section,
    canvasContainer: canvasArea ?? canvasEl,
    appName: 'WC',
    onAutosaveStatusChange: (status) => {
      if (autosaveInfoEl) autosaveInfoEl.textContent = status;
    },
    onCollabInfoChange: (info) => {
      if (collabInfoEl) collabInfoEl.textContent = info;
    },
    onFollowChange: (sessionId, reason, name) => {
      if (shellEl) shellEl.following = sessionId;
      if (reason === 'left' && name) notify(`${name} saiu; você parou de seguir`);
    },
    onParticipantsChange: (participants) => {
      if (shellEl) shellEl.participants = participants;
    },
    onLockLost: (_nodeId, holder) => {
      notify(`${holder.name} já está editando este elemento`);
    },
    onSharingChange: (state) => {
      if (shellEl) shellEl.sharing = state;
      if (btnToggleCollab) {
        btnToggleCollab.textContent =
          state === 'off' ? 'Colaboração: Pausada' : 'Colaboração: Ativa';
      }
    },
  });
  if (shellEl) shellEl.sharing = 'off';
  // O link com `?collab=true` abre a sessão já compartilhando.
  if (collabManager.autoShare) {
    void collabManager.startSharing().then((started) => {
      if (!started.ok) notify('Não foi possível compartilhar');
    });
  }
};

if (canvasEl) {
  window.__CANVASH_WC__ = {
    canvas: canvasEl,
    toolbar: toolbarEl ?? undefined,
    layers: layersEl ?? undefined,
    properties: propertiesEl ?? undefined,
    controls: controlsEl ?? undefined,
    selectionMenu: selectionMenuEl ?? undefined,
    shell: shellEl ?? undefined,
    events: eventsReceived,
    createCanvasSection,
    get collab() {
      return collabManager;
    },
  };

  const recordEvent = (type: string, detail: unknown) => {
    eventsReceived.push({ type, detail });
    if (eventLog) {
      eventLog.textContent = `Último evento: ${type} (total: ${eventsReceived.length})`;
    }
  };

  const onCanvasReady = (section: CanvasSectionApi) => {
    initCollabPersistence(section);
    if (toolbarEl) {
      toolbarEl.section = section;
    }
    if (layersEl) {
      layersEl.section = section;
    }
    if (propertiesEl) {
      propertiesEl.section = section;
    }
    if (controlsEl) {
      controlsEl.section = section;
      controlsEl.canvas = canvasEl;
    }
    if (selectionMenuEl) {
      selectionMenuEl.section = section;
      selectionMenuEl.canvas = canvasEl;
    }
    if (shellEl) {
      shellEl.section = section;
    }
  };

  canvasEl.addEventListener('canvas-ready', (e) => {
    const ce = e as CustomEvent<{ section: CanvasSectionApi }>;
    recordEvent('canvas-ready', ce.detail);
    if (ce.detail?.section) {
      onCanvasReady(ce.detail.section);
    }
  });

  if (canvasEl.section) {
    onCanvasReady(canvasEl.section);
  }

  canvasEl.addEventListener('document-change', (e) => {
    const ce = e as CustomEvent<{ revision: number }>;
    recordEvent('document-change', ce.detail);
  });

  canvasEl.addEventListener('selection-change', (e) => {
    const ce = e as CustomEvent<{ selectedIds: readonly string[] }>;
    recordEvent('selection-change', ce.detail);
  });

  canvasEl.addEventListener('viewport-change', (e) => {
    const ce = e as CustomEvent<{ viewport: unknown }>;
    recordEvent('viewport-change', ce.detail);
  });

  canvasEl.addEventListener('tool-change', (e) => {
    const ce = e as CustomEvent<{ activeTool: string }>;
    recordEvent('tool-change', ce.detail);
  });

  canvasEl.addEventListener('text-edit-superseded', (e) => {
    const { nodeId, text } = (e as CustomEvent<{ nodeId: string; text: string }>).detail;
    showSupersededNotice(canvasEl.section?.getPeerLock(nodeId)?.name ?? 'Outra pessoa', text);
  });
  canvasEl.addEventListener('canvas-error', (e) => {
    const ce = e as CustomEvent<{ error: unknown }>;
    recordEvent('canvas-error', ce.detail);
  });

  // O shell só exibe o título: aqui o exemplo aceita a mudança e a guarda em memória.
  shellEl?.addEventListener('title-change', (e) => {
    shellEl.projectTitle = (e as CustomEvent<{ title: string }>).detail.title;
  });

  // As ilhas do topo são do host: o shell desenha e avisa, e o exemplo decide o que cada uma faz.
  const menuItems: readonly ShellMenuItem[] = [
    { id: 'new', label: 'Novo projeto' },
    { id: 'open', label: 'Abrir projeto…' },
    { id: 'about', label: 'Sobre o Canvash' },
  ];
  const user: ShellUser = { name: 'Pessoa Exemplo', avatarUrl: '/avatar.svg' };
  if (shellEl) {
    shellEl.menuItems = menuItems;
    shellEl.user = user;
  }
  shellEl?.addEventListener('menu-select', (e) => {
    const { id } = (e as CustomEvent<{ id: string }>).detail;
    const item = menuItems.find((candidate) => candidate.id === id);
    if (item) notify(`Selecionado: ${item.label}`);
  });
  shellEl?.addEventListener('export-request', (e) => {
    const { format } = (e as CustomEvent<ExportRequestEventDetail>).detail;
    if (format === 'svg') collabManager?.exportSvgDoc();
    else collabManager?.exportPngDoc();
  });
  // Exportar board vem do menu de seleção, não da pill: só o board, com o título no nome do arquivo.
  selectionMenuEl?.addEventListener('export-board-request', (e) => {
    const { boardId, format } = (e as ExportBoardRequestEvent).detail;
    void collabManager?.exportBoard(boardId, format);
  });
  shellEl?.addEventListener('share-request', async (e) => {
    const { sharing } = (e as ShareRequestEvent).detail;
    // O mesmo endereço de "Abrir Nova Aba": quem abrir entra na colaboração desta sala.
    const link = new URL(window.location.href);
    link.searchParams.set('collab', 'true');
    let copied = true;
    try {
      await navigator.clipboard.writeText(link.toString());
    } catch {
      copied = false;
    }
    notify(copied ? 'Link copiado' : 'Não foi possível copiar o link');
    // Em `off` o mesmo clique liga a colaboração; nos outros estados só copia o link.
    if (sharing === 'off' && collabManager) {
      const started = await collabManager.startSharing();
      if (!started.ok) notify('Não foi possível compartilhar');
    }
  });
  // Seguir, Seguindo e Parar da ilha e da faixa: o vínculo decide, e o shell reflete.
  shellEl?.addEventListener('follow-change', (e) => {
    const { sessionId } = (e as CustomEvent<{ sessionId: string | null }>).detail;
    const followed = collabManager?.follow(sessionId);
    if (followed && !followed.ok) notify('Não foi possível seguir esta pessoa');
  });
  // "Parar compartilhamento" da ilha de participantes.
  shellEl?.addEventListener('share-stop', async () => {
    if (!collabManager) return;
    const stopped = await collabManager.stopSharing();
    if (!stopped.ok) notify('Há alterações pendentes; o compartilhamento continua ativo');
  });
  shellEl?.addEventListener('avatar-click', () => notify(`Conta: ${user.name}`));

  // O botão do playground abre o cartão por `popovertarget`; o `aria-expanded` segue o estado real.
  const playgroundPanel = document.getElementById('playground-panel');
  const playgroundButton = document.getElementById('btn-playground');
  // Abre colado à esquerda da toolbar, qualquer que seja a largura dela (edição ou leitura).
  playgroundPanel?.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open' || !toolbarEl) return;
    const gap = 12;
    const margin = 16;
    const left = toolbarEl.getBoundingClientRect().left;
    playgroundPanel.style.right = `${document.documentElement.clientWidth - left + gap}px`;
    playgroundPanel.style.maxWidth = `min(360px, ${left - gap - margin}px)`;
  });
  playgroundPanel?.addEventListener('toggle', (e) => {
    playgroundButton?.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open'));
  });

  // As camadas ocupam o cartão da esquerda, que começa escondido; as propriedades abrem no mini-menu.
  const leftStack = document.getElementById('wc-left');
  const btnTogglePanels = document.getElementById('btn-toggle-panels');
  btnTogglePanels?.addEventListener('click', () => {
    if (!leftStack) return;
    leftStack.hidden = !leftStack.hidden;
    btnTogglePanels.setAttribute('aria-pressed', String(!leftStack.hidden));
    btnTogglePanels.textContent = leftStack.hidden ? 'Painéis: ocultos' : 'Painéis: visíveis';
  });

  // Ações do menu hambúrguer
  const btnFit = document.getElementById('btn-fit');
  btnFit?.addEventListener('click', () => {
    canvasEl.fitToContent();
  });

  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  btnToggleGrid?.addEventListener('click', () => {
    canvasEl.grid = !canvasEl.grid;
  });

  const btnToggleReadonly = document.getElementById('btn-toggle-readonly');
  btnToggleReadonly?.addEventListener('click', () => {
    canvasEl.readOnly = !canvasEl.readOnly;
  });

  const btnAddRect = document.getElementById('btn-add-rect');
  btnAddRect?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `rect-${Date.now()}`,
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 150,
          height: 100,
          rotation: 0,
          visible: true,
          locked: false,
          style: {
            fill: '#3b82f6',
            stroke: '#1d4ed8',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  const btnAddSquare = document.getElementById('btn-add-square');
  btnAddSquare?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `square-${Date.now()}`,
          type: 'square',
          x: 120,
          y: 120,
          width: 120,
          height: 120,
          rotation: 0,
          visible: true,
          locked: false,
          style: {
            fill: '#10b981',
            stroke: '#047857',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  const btnAddCircle = document.getElementById('btn-add-circle');
  btnAddCircle?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `circle-${Date.now()}`,
          type: 'circle',
          x: 140,
          y: 140,
          width: 120,
          height: 120,
          rotation: 0,
          visible: true,
          locked: false,
          style: {
            fill: '#8b5cf6',
            stroke: '#5b21b6',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  const btnAddDiamond = document.getElementById('btn-add-diamond');
  btnAddDiamond?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `diamond-${Date.now()}`,
          type: 'diamond',
          x: 150,
          y: 150,
          width: 140,
          height: 100,
          rotation: 0,
          visible: true,
          locked: false,
          style: {
            fill: '#f59e0b',
            stroke: '#b45309',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  const btnAddTriangle = document.getElementById('btn-add-triangle');
  btnAddTriangle?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `triangle-${Date.now()}`,
          type: 'triangle',
          x: 160,
          y: 160,
          width: 140,
          height: 100,
          rotation: 0,
          variant: 'isosceles',
          visible: true,
          locked: false,
          style: {
            fill: '#ec4899',
            stroke: '#be185d',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  const btnAddPolygon = document.getElementById('btn-add-polygon');
  btnAddPolygon?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `polygon-${Date.now()}`,
          type: 'polygon',
          x: 180,
          y: 180,
          width: 120,
          height: 120,
          rotation: 0,
          sides: 5,
          visible: true,
          locked: false,
          style: {
            fill: '#14b8a6',
            stroke: '#0f766e',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    }
  });

  for (const [tool, sides] of Object.entries(POLYGON_PRESETS)) {
    document.getElementById(`btn-add-${tool}`)?.addEventListener('click', () => {
      canvasEl.section?.dispatch({
        type: 'shape.create',
        shape: {
          id: `${tool}-${Date.now()}`,
          type: 'polygon',
          x: 200,
          y: 200,
          width: 120,
          height: 120,
          rotation: 0,
          sides,
          visible: true,
          locked: false,
          style: {
            fill: '#14b8a6',
            stroke: '#0f766e',
            strokeWidth: 2,
            opacity: 1,
          },
        },
      });
    });
  }

  document.getElementById('btn-add-cross')?.addEventListener('click', () => {
    canvasEl.section?.dispatch({
      type: 'shape.create',
      shape: {
        id: `cross-${Date.now()}`,
        type: 'cross',
        x: 220,
        y: 220,
        width: 120,
        height: 120,
        rotation: 0,
        visible: true,
        locked: false,
        style: {
          fill: '#f97316',
          stroke: '#9a3412',
          strokeWidth: 2,
          opacity: 1,
        },
      },
    });
  });

  document.getElementById('btn-add-chevron')?.addEventListener('click', () => {
    canvasEl.section?.dispatch({
      type: 'shape.create',
      shape: {
        id: `chevron-${Date.now()}`,
        type: 'chevron',
        x: 240,
        y: 240,
        width: 140,
        height: 90,
        rotation: 0,
        visible: true,
        locked: false,
        style: {
          fill: '#3b82f6',
          stroke: '#1e3a8a',
          strokeWidth: 2,
          opacity: 1,
        },
      },
    });
  });

  document.getElementById('btn-add-brace')?.addEventListener('click', () => {
    canvasEl.section?.dispatch({
      type: 'shape.create',
      shape: {
        id: `brace-${Date.now()}`,
        type: 'brace',
        x: 260,
        y: 100,
        width: 50,
        height: 180,
        rotation: 0,
        visible: true,
        locked: false,
        style: {
          stroke: '#7c3aed',
          strokeWidth: 3,
          opacity: 1,
        },
      },
    });
  });

  document.getElementById('btn-add-sticky')?.addEventListener('click', () => {
    canvasEl.section?.dispatch({
      type: 'shape.create',
      shape: {
        id: `sticky-${Date.now()}`,
        type: 'sticky',
        x: 300,
        y: 120,
        width: 200,
        height: 200,
        rotation: 0,
        text: 'Ideia',
      },
    });
  });

  const btnAddBezier = document.getElementById('btn-add-bezier');
  btnAddBezier?.addEventListener('click', () => {
    const section = canvasEl.section;
    if (section) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: `bezier-${Date.now()}`,
          type: 'bezier',
          start: { x: 200, y: 260 },
          end: { x: 360, y: 260 },
          style: { stroke: '#7c3aed', strokeWidth: 3, opacity: 1 },
        },
      });
    }
  });

  // Ações do painel de persistência & colaboração
  const btnSaveNow = document.getElementById('btn-save-now');
  btnSaveNow?.addEventListener('click', () => {
    collabManager?.saveNow();
  });

  const btnLoadSaved = document.getElementById('btn-load-saved');
  btnLoadSaved?.addEventListener('click', () => {
    collabManager?.loadSaved();
  });

  const btnResetDoc = document.getElementById('btn-reset-doc');
  btnResetDoc?.addEventListener('click', () => {
    collabManager?.resetDoc();
  });

  btnToggleCollab?.addEventListener('click', async () => {
    if (!collabManager) return;
    const wasOn = collabManager.getSharing() === 'on';
    const stillOn = await collabManager.toggleCollab();
    // O texto do botão acompanha o estado pelo `onSharingChange`; aqui só o aviso de parada pendente.
    if (wasOn && stillOn) notify('Há alterações pendentes; o compartilhamento continua ativo');
  });

  const btnOpenTab = document.getElementById('btn-open-tab');
  btnOpenTab?.addEventListener('click', () => {
    collabManager?.openNewTab();
  });
}
