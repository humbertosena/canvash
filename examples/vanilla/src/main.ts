import type { Result } from '@canvash/collaboration';
import {
  CollaborativeServerEmulator,
  DeterministicTransportHub,
  YjsCollaborationSession,
} from '@canvash/collaboration-yjs';
import {
  clampZoom,
  createCanvasSection,
  DEFAULT_ZOOM_LIMITS,
  FONT_SIZE_PRESETS,
  POLYGON_PRESETS,
  STICKY_COLORS,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type EraserSize,
  type InkKind,
  type InkWidth,
  type Point,
  type Viewport,
} from '@canvash/core';
import { attachInteractions, type InteractionHandle } from '@canvash/interaction';
import { IndexedDbStorageAdapter, type AutosaveManager } from '@canvash/persistence';
import { mount, type GridStyle, type RendererHandle } from '@canvash/renderer-canvas2d';
import { mountCanvasControls } from './canvas-controls.js';
import { mountGhostIslands, type GhostIslandsHandle } from './ghost-islands.js';
import { mountBoardSection } from './board-section.js';
import { mountLabelSection } from './label-section.js';
import { mountPropertiesIsland } from './properties-island.js';
import { mountSelectionMenu } from './selection-menu.js';
import { mountShell, type ShellMenuItem, type ShellUser } from './shell.js';
import {
  createCollabPersistenceManager,
  showSupersededNotice,
  type SharingState,
} from './collab-persistence.js';

/**
 * Fixture do documento comprovando RENDER-01:
 * - Shapes sobrepostas (retângulos, elipses e linhas);
 * - Shapes rotacionadas ao redor do centro;
 * - Nó com visible: false (não desenhado);
 * - Camada com visible: false contendo nó (não desenhado);
 * - Ordem estrita de documento preservada no Canvas 2D.
 */
export const RENDER_01_FIXTURE = {
  schemaVersion: 1,
  id: 'fixture-render-01',
  nodes: {
    // 1. Camada de Fundo
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
        fill: '#2563eb', // Azul
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
        stroke: '#dc2626', // Vermelho (atravessa o retângulo de fundo)
        strokeWidth: 6,
        opacity: 1,
      },
    },
    // 2. Camada Intermediária
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
        fill: '#16a34a', // Verde (sobrepõe o retângulo azul e a linha vermelha)
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
        fill: '#ea580c', // Laranja (sobrepõe o retângulo verde)
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
      visible: false, // Nó invisível: NÃO deve ser pintado
      locked: false,
      style: {
        fill: '#9333ea', // Roxo
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
      },
    },
    // 3. Camada Oculta
    'item-in-hidden-layer': {
      id: 'item-in-hidden-layer',
      type: 'ellipse',
      x: 60,
      y: 60,
      width: 150,
      height: 150,
      rotation: 0,
      visible: true, // Nó visível, mas a camada inteira é invisível: NÃO deve ser pintado
      locked: false,
      style: {
        fill: '#facc15', // Amarelo
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
      visible: false, // Camada oculta
      locked: false,
      childIds: ['item-in-hidden-layer'],
    },
  ],
};

export interface PlaygroundInstance {
  readonly section: ReturnType<typeof createCanvasSection>;
  readonly handle: RendererHandle;
  readonly interaction: InteractionHandle;
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement | null;
  readonly setViewport: (viewport: Viewport) => void;
  readonly setTool: (tool: string) => void;
  readonly screenToWorld: (point: Point) => Point;
  readonly worldToScreen: (point: Point) => Point;
  readonly hitTestScreen: (
    screenPoint: Point,
    options?: { tolerance?: number; includeLocked?: boolean },
  ) => readonly string[];
  readonly setGridEnabled: (enabled: boolean) => void;
  readonly isGridEnabled: () => boolean;
  readonly setSnappingEnabled: (enabled: boolean) => void;
  readonly isSnappingEnabled: () => boolean;
  readonly storage: IndexedDbStorageAdapter;
  readonly autosave: AutosaveManager;
  /** A sessão Yjs só existe com o compartilhamento ligado. */
  readonly getSession: () => YjsCollaborationSession | null;
  readonly getSharing: () => SharingState;
  readonly startSharing: () => Promise<Result<void>>;
  readonly stopSharing: () => Promise<Result<void>>;
  readonly server: CollaborativeServerEmulator;
  readonly transport: DeterministicTransportHub;
}

export function setupPlayground(container: HTMLElement): PlaygroundInstance {
  const section = createCanvasSection();
  const replaceResult = section.replaceDocument(RENDER_01_FIXTURE);
  if (!replaceResult.ok) {
    throw new Error(`Falha ao carregar fixture: ${replaceResult.error.message}`);
  }

  // Pontos são o padrão; `?grid=lines` volta ao grid de linhas (as jornadas de pixel o usam).
  const gridStyle: GridStyle =
    new URLSearchParams(window.location.search).get('grid') === 'lines' ? 'lines' : 'dots';
  // O realce sob o mouse é padrão; `?highlight=off` o desliga (as jornadas de pixel o usam).
  const gridHighlight = new URLSearchParams(window.location.search).get('highlight') !== 'off';
  const gridState = {
    enabled: false,
    style: gridStyle,
    highlight: gridHighlight,
    size: 50,
    color: gridStyle === 'lines' ? '#cbd5e1' : undefined,
    lineWidth: 1,
  };

  const snappingState = {
    enabled: false,
  };

  const mountResult = mount({
    section: section,
    container,
    get grid() {
      return gridState;
    },
  });
  if (!mountResult.ok) {
    throw new Error(`Falha ao montar renderer: ${mountResult.error.message}`);
  }

  const handle = mountResult.value;
  const canvas = container.querySelector('canvas');

  const viewportInfoEl = document.getElementById('viewport-info');
  const toolInfoEl = document.getElementById('tool-info');
  const hittestInfoEl = document.getElementById('hittest-info');
  const autosaveInfoEl = document.getElementById('autosave-info');
  const collabInfoEl = document.getElementById('collab-info');
  const selectionTypeInfoEl = document.getElementById('selection-type-info');
  const btnConvertType = document.getElementById('btn-convert-type') as HTMLButtonElement | null;
  const selectTriangleVariant = document.getElementById(
    'select-triangle-variant',
  ) as HTMLSelectElement | null;
  const inputTriangleApex = document.getElementById(
    'input-triangle-apex',
  ) as HTMLInputElement | null;
  const inputPolygonSides = document.getElementById(
    'input-polygon-sides',
  ) as HTMLInputElement | null;
  const inputCrossArmRatio = document.getElementById(
    'input-cross-arm-ratio',
  ) as HTMLInputElement | null;
  const selectChevronDirection = document.getElementById(
    'select-chevron-direction',
  ) as HTMLSelectElement | null;
  const inputChevronNotchDepth = document.getElementById(
    'input-chevron-notch-depth',
  ) as HTMLInputElement | null;
  const selectBraceOrientation = document.getElementById(
    'select-brace-orientation',
  ) as HTMLSelectElement | null;
  const inputBraceTipPosition = document.getElementById(
    'input-brace-tip-position',
  ) as HTMLInputElement | null;
  const inputBraceCurvature = document.getElementById(
    'input-brace-curvature',
  ) as HTMLInputElement | null;
  const selectFontSize = document.getElementById('prop-font-size') as HTMLSelectElement | null;
  const selectStickyNodeColor = document.getElementById(
    'prop-sticky-color',
  ) as HTMLSelectElement | null;
  const labelBezierSymmetric = document.getElementById('label-bezier-symmetric');
  const inputBezierSymmetric = document.getElementById(
    'input-bezier-symmetric',
  ) as HTMLInputElement | null;
  const updateViewportDisplay = (): void => {
    if (!viewportInfoEl) return;
    const vp = section.getSnapshot().session.viewport;
    viewportInfoEl.textContent = `Viewport: x=${Math.round(vp.x)}, y=${Math.round(vp.y)}, zoom=${vp.zoom.toFixed(2)}`;
  };

  // O botão Board fica fora das ilhas de grupo, então o estado dele mora aqui, nos dois layouts.
  const btnToolBoard = document.getElementById('btn-tool-board');
  const updateToolDisplay = (): void => {
    const activeTool = section.getSnapshot().session.activeTool;
    btnToolBoard?.setAttribute('aria-pressed', String(activeTool === 'board'));
    if (!toolInfoEl) return;
    toolInfoEl.textContent = `Ferramenta: ${activeTool}`;
  };

  const updateSelectionDisplay = (): void => {
    const snap = section.getSnapshot();
    const selectedIds = snap.session.selectedIds;
    if (selectedIds.length !== 1) {
      if (selectionTypeInfoEl) {
        selectionTypeInfoEl.textContent =
          selectedIds.length === 0 ? 'Seleção: nenhuma' : `Seleção: ${selectedIds.length} itens`;
      }
      if (btnConvertType) {
        btnConvertType.disabled = true;
        btnConvertType.textContent = 'Converter Tipo';
        btnConvertType.setAttribute('data-action', 'convert-type');
      }
      if (selectTriangleVariant) selectTriangleVariant.hidden = true;
      if (inputTriangleApex) inputTriangleApex.hidden = true;
      if (inputPolygonSides) inputPolygonSides.hidden = true;
      if (inputCrossArmRatio) inputCrossArmRatio.hidden = true;
      if (selectChevronDirection) selectChevronDirection.hidden = true;
      if (inputChevronNotchDepth) inputChevronNotchDepth.hidden = true;
      if (selectFontSize) selectFontSize.hidden = true;
      if (selectStickyNodeColor) selectStickyNodeColor.hidden = true;
      if (selectBraceOrientation) selectBraceOrientation.hidden = true;
      if (inputBraceTipPosition) inputBraceTipPosition.hidden = true;
      if (inputBraceCurvature) inputBraceCurvature.hidden = true;
      if (labelBezierSymmetric) labelBezierSymmetric.hidden = true;
      return;
    }

    const node = snap.document.nodes[selectedIds[0]!];
    if (!node) return;
    const labelMap: Record<string, string> = {
      square: 'Quadrado',
      rectangle: 'Retângulo',
      ellipse: 'Elipse',
      circle: 'Círculo',
      diamond: 'Losango',
      triangle: 'Triângulo',
      polygon: 'Polígono',
      cross: 'Cruz',
      chevron: 'Chevron',
      brace: 'Chaves',
      bezier: 'Bézier',
      line: 'Linha',
      arrow: 'Seta',
      text: 'Texto',
      sticky: 'Nota adesiva',
      ink: 'Traço',
      group: 'Grupo',
      board: 'Board',
    };
    const typeLabel = labelMap[node.type] ?? node.type;
    if (selectionTypeInfoEl) {
      selectionTypeInfoEl.textContent = `Tipo: ${typeLabel} (${node.id})`;
    }
    if (btnConvertType) {
      if (node.type === 'square') {
        btnConvertType.disabled = snap.session.readOnly || node.locked;
        btnConvertType.textContent = 'Converter para Retângulo';
        btnConvertType.setAttribute('data-action', 'convert-to-rectangle');
      } else if (node.type === 'rectangle') {
        btnConvertType.disabled = snap.session.readOnly || node.locked;
        btnConvertType.textContent = 'Converter para Quadrado';
        btnConvertType.setAttribute('data-action', 'convert-to-square');
      } else if (node.type === 'circle') {
        btnConvertType.disabled = snap.session.readOnly || node.locked;
        btnConvertType.textContent = 'Converter para Elipse';
        btnConvertType.setAttribute('data-action', 'convert-to-ellipse');
      } else if (node.type === 'ellipse') {
        btnConvertType.disabled = snap.session.readOnly || node.locked;
        btnConvertType.textContent = 'Converter para Círculo';
        btnConvertType.setAttribute('data-action', 'convert-to-circle');
      } else {
        btnConvertType.disabled = true;
        btnConvertType.textContent = 'Converter Tipo';
        btnConvertType.setAttribute('data-action', 'convert-type');
      }
    }
    if (selectTriangleVariant) {
      if (node.type === 'triangle') {
        selectTriangleVariant.hidden = false;
        selectTriangleVariant.disabled = snap.session.readOnly || node.locked;
        selectTriangleVariant.value = node.variant;
      } else {
        selectTriangleVariant.hidden = true;
      }
    }
    if (inputTriangleApex) {
      if (node.type === 'triangle' && node.variant === 'scalene') {
        inputTriangleApex.hidden = false;
        inputTriangleApex.disabled = snap.session.readOnly || node.locked;
        inputTriangleApex.value = String(Math.round(node.apex * 100) / 100);
      } else {
        inputTriangleApex.hidden = true;
      }
    }
    if (labelBezierSymmetric && inputBezierSymmetric) {
      if (node.type === 'bezier') {
        labelBezierSymmetric.hidden = false;
        inputBezierSymmetric.disabled = snap.session.readOnly || node.locked;
        inputBezierSymmetric.checked = node.symmetric;
      } else {
        labelBezierSymmetric.hidden = true;
      }
    }
    if (inputPolygonSides) {
      if (node.type === 'polygon') {
        inputPolygonSides.hidden = false;
        inputPolygonSides.disabled = snap.session.readOnly || node.locked;
        inputPolygonSides.value = String(node.sides);
      } else {
        inputPolygonSides.hidden = true;
      }
    }
    if (selectStickyNodeColor) {
      if (node.type === 'sticky') {
        const name = (Object.keys(STICKY_COLORS) as Array<keyof typeof STICKY_COLORS>).find(
          (key) => STICKY_COLORS[key] === node.style.fill,
        );
        selectStickyNodeColor.value = name ?? 'custom';
        selectStickyNodeColor.disabled = snap.session.readOnly || node.locked;
        selectStickyNodeColor.hidden = false;
      } else {
        selectStickyNodeColor.hidden = true;
      }
    }
    if (selectFontSize) {
      if (node.type === 'text' || node.type === 'sticky') {
        const optionOf = (value: string, label: string): HTMLOptionElement => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          return option;
        };
        const inList = (FONT_SIZE_PRESETS as readonly number[]).includes(node.fontSize);
        selectFontSize.replaceChildren(
          ...(node.fontSizeMode === 'fixed' && !inList
            ? [optionOf(String(node.fontSize), String(node.fontSize))]
            : []),
          optionOf('auto', `Automático (${Math.round(node.fontSize)})`),
          ...FONT_SIZE_PRESETS.map((size) => optionOf(String(size), String(size))),
        );
        selectFontSize.value = node.fontSizeMode === 'auto' ? 'auto' : String(node.fontSize);
        selectFontSize.disabled = snap.session.readOnly || node.locked;
        selectFontSize.hidden = false;
      } else {
        selectFontSize.hidden = true;
      }
    }
    if (selectBraceOrientation && inputBraceTipPosition && inputBraceCurvature) {
      if (node.type === 'brace') {
        const disabled = snap.session.readOnly || node.locked;
        selectBraceOrientation.hidden = false;
        selectBraceOrientation.disabled = disabled;
        selectBraceOrientation.value = node.orientation;
        inputBraceTipPosition.hidden = false;
        inputBraceTipPosition.disabled = disabled;
        inputBraceTipPosition.value = String(Math.round(node.tipPosition * 100) / 100);
        inputBraceCurvature.hidden = false;
        inputBraceCurvature.disabled = disabled;
        inputBraceCurvature.value = String(Math.round(node.curvature * 100) / 100);
      } else {
        selectBraceOrientation.hidden = true;
        inputBraceTipPosition.hidden = true;
        inputBraceCurvature.hidden = true;
      }
    }
    if (selectChevronDirection && inputChevronNotchDepth) {
      if (node.type === 'chevron') {
        const disabled = snap.session.readOnly || node.locked;
        selectChevronDirection.hidden = false;
        selectChevronDirection.disabled = disabled;
        selectChevronDirection.value = node.direction;
        inputChevronNotchDepth.hidden = false;
        inputChevronNotchDepth.disabled = disabled;
        inputChevronNotchDepth.value = String(Math.round(node.notchDepth * 100) / 100);
      } else {
        selectChevronDirection.hidden = true;
        inputChevronNotchDepth.hidden = true;
      }
    }
    if (inputCrossArmRatio) {
      if (node.type === 'cross') {
        inputCrossArmRatio.hidden = false;
        inputCrossArmRatio.disabled = snap.session.readOnly || node.locked;
        inputCrossArmRatio.value = String(Math.round(node.armRatio * 100) / 100);
      } else {
        inputCrossArmRatio.hidden = true;
      }
    }
  };

  section.subscribe((event) => {
    if (event.areas.includes('viewport')) {
      updateViewportDisplay();
    }
    if (event.areas.includes('tool')) {
      updateToolDisplay();
    }
    if (event.areas.includes('selection') || event.areas.includes('document')) {
      updateSelectionDisplay();
    }
  });
  updateViewportDisplay();
  updateToolDisplay();
  updateSelectionDisplay();
  mountLabelSection(section);
  mountBoardSection(section);

  // O mini-menu nasce antes da interação: ela avisa dos gestos pelo `onStateChange`.
  const menuRoot = document.getElementById('selection-menu');
  const selectionMenu = menuRoot
    ? mountSelectionMenu({
        section,
        container,
        root: menuRoot,
        onExportBoard: (boardId, format) => void collabManager.exportBoard(boardId, format),
      })
    : null;
  // Propriedades mora na ilha da toolbar (layout de ilhas); no clássico não roda.
  mountPropertiesIsland(section);

  const interactionHandle: InteractionHandle = attachInteractions({
    section: section,
    element: container,
    renderer: handle,
    grid: () => (gridState.enabled ? gridState : undefined),
    snapping: () => snappingState.enabled,
    onStateChange: (state) => selectionMenu?.notifyInteractionState(state),
    boardTitle: (n) => `Board ${n}`,
    boardTitleLabel: 'Título do board',
    onTextEditSuperseded: (nodeId, text) =>
      showSupersededNotice(section.getPeerLock(nodeId)?.name ?? 'Outra pessoa', text),
  });

  const controlsRoot = document.getElementById('canvas-controls');
  if (controlsRoot) mountCanvasControls({ section, container, root: controlsRoot });
  // As ilhas do topo são do host: o shell desenha e avisa, e o exemplo decide o que cada uma faz.
  const menuItems: readonly ShellMenuItem[] = [
    { id: 'new', label: 'Novo projeto' },
    { id: 'open', label: 'Abrir projeto…' },
    { id: 'about', label: 'Sobre o Canvash' },
  ];
  const user: ShellUser = { name: 'Pessoa Exemplo', avatarUrl: '/avatar.svg' };
  const shell = mountShell({
    section,
    menuItems,
    onMenuSelect: (id) => {
      const item = menuItems.find((candidate) => candidate.id === id);
      if (item) shell?.notify(`Selecionado: ${item.label}`);
    },
    user,
    onAvatarClick: () => shell?.notify(`Conta: ${user.name}`),
    onExportRequest: (format) => {
      if (format === 'svg') collabManager.exportSvgDoc();
      else collabManager.exportPngDoc();
    },
    onFollow: (sessionId) => {
      const followed = collabManager.follow(sessionId);
      if (!followed.ok) shell?.notify('Não foi possível seguir esta pessoa');
    },
    onShareStop: async () => {
      const stopped = await collabManager.stopSharing();
      if (!stopped.ok) shell?.notify('Há alterações pendentes; o compartilhamento continua ativo');
    },
    onShareRequest: async ({ sharing }) => {
      // O mesmo endereço de "Abrir Nova Aba": quem abrir entra na colaboração desta sala.
      const link = new URL(window.location.href);
      link.searchParams.set('collab', 'true');
      let copied = true;
      try {
        await navigator.clipboard.writeText(link.toString());
      } catch {
        copied = false;
      }
      shell?.notify(copied ? 'Link copiado' : 'Não foi possível copiar o link');
      // Em `off` o mesmo clique liga a colaboração; nos outros estados só copia o link.
      if (sharing === 'off') {
        const started = await collabManager.startSharing();
        if (!started.ok) shell?.notify('Não foi possível compartilhar');
      }
    },
  });

  const getViewport = (): Viewport => section.getSnapshot().session.viewport;

  const setViewport = (next: Viewport): void => {
    section.setViewport(next);
  };

  const toWorld = (screenPoint: Point): Point => {
    return screenToWorld(getViewport(), screenPoint);
  };

  const toScreen = (worldPoint: Point): Point => {
    return worldToScreen(getViewport(), worldPoint);
  };

  const hitTestScreen = (
    screenPoint: Point,
    options?: { tolerance?: number; includeLocked?: boolean },
  ): readonly string[] => {
    const worldPoint = toWorld(screenPoint);
    return section.hitTestAll(worldPoint, { includePreview: false, ...options });
  };

  // ==========================================
  // PERSISTÊNCIA & COLABORAÇÃO
  // ==========================================
  const collabManager = createCollabPersistenceManager({
    section,
    canvasContainer: container,
    appName: 'Vanilla',
    onAutosaveStatusChange: (status) => {
      if (autosaveInfoEl) autosaveInfoEl.textContent = status;
    },
    onCollabInfoChange: (info) => {
      if (collabInfoEl) collabInfoEl.textContent = info;
    },
    onParticipantsChange: (participants) => shell?.setParticipants(participants),
    onFollowChange: (sessionId, reason, name) => {
      shell?.setFollowing(sessionId);
      if (reason === 'left' && name) shell?.notify(`${name} saiu; você parou de seguir`);
    },
    onLockLost: (_nodeId, holder) => {
      shell?.notify(`${holder.name} já está editando este elemento`);
    },
    onSharingChange: (state) => {
      shell?.setSharing(state);
      const toggle = document.getElementById('btn-toggle-collab');
      if (toggle) {
        toggle.textContent = state === 'off' ? '👥 Colaboração: Pausada' : '👥 Colaboração: Ativa';
      }
    },
  });
  // O link com `?collab=true` abre a sessão já compartilhando.
  if (collabManager.autoShare) {
    void collabManager.startSharing().then((started) => {
      if (!started.ok) shell?.notify('Não foi possível compartilhar');
    });
  }

  const btnSaveNow = document.getElementById('btn-save-now');
  btnSaveNow?.addEventListener('click', () => {
    collabManager.saveNow();
  });

  const btnLoadSaved = document.getElementById('btn-load-saved');
  btnLoadSaved?.addEventListener('click', () => {
    collabManager.loadSaved();
  });

  const btnResetDoc = document.getElementById('btn-reset-doc');
  btnResetDoc?.addEventListener('click', () => {
    collabManager.resetDoc();
  });

  // No layout clássico não há shell: os botões de exportação voltam a ser soltos e agem direto.
  if (!shell) {
    document.getElementById('btn-export-svg')?.addEventListener('click', () => {
      collabManager.exportSvgDoc();
    });
    document.getElementById('btn-export-png')?.addEventListener('click', () => {
      collabManager.exportPngDoc();
    });
  }

  const btnToggleCollab = document.getElementById('btn-toggle-collab');
  btnToggleCollab?.addEventListener('click', async () => {
    const wasOn = collabManager.getSharing() === 'on';
    const stillOn = await collabManager.toggleCollab();
    // O texto do botão acompanha o estado pelo `onSharingChange`; aqui só o aviso de parada pendente.
    if (wasOn && stillOn)
      shell?.notify('Há alterações pendentes; o compartilhamento continua ativo');
  });

  const btnOpenTab = document.getElementById('btn-open-tab');
  btnOpenTab?.addEventListener('click', () => {
    collabManager.openNewTab();
  });

  // Botões de Zoom
  const btnZoomIn = document.getElementById('btn-zoom-in');
  btnZoomIn?.addEventListener('click', () => {
    const vp = getViewport();
    const anchor = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    const nextZoom = clampZoom(vp.zoom * 1.25);
    section.setViewport(zoomAt(vp, anchor, nextZoom));
  });

  const btnZoomOut = document.getElementById('btn-zoom-out');
  btnZoomOut?.addEventListener('click', () => {
    const vp = getViewport();
    const anchor = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    const nextZoom = clampZoom(vp.zoom / 1.25);
    section.setViewport(zoomAt(vp, anchor, nextZoom));
  });

  const btnZoomReset = document.getElementById('btn-zoom-reset');
  btnZoomReset?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, zoom: 1 });
  });

  const btnZoomMin = document.getElementById('btn-zoom-min');
  btnZoomMin?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, zoom: DEFAULT_ZOOM_LIMITS.min });
  });

  const btnZoomMax = document.getElementById('btn-zoom-max');
  btnZoomMax?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, zoom: DEFAULT_ZOOM_LIMITS.max });
  });

  // Botões de Pan
  const btnPanLeft = document.getElementById('btn-pan-left');
  btnPanLeft?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, x: vp.x - 50 });
  });

  const btnPanRight = document.getElementById('btn-pan-right');
  btnPanRight?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, x: vp.x + 50 });
  });

  const btnPanUp = document.getElementById('btn-pan-up');
  btnPanUp?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, y: vp.y - 50 });
  });

  const btnPanDown = document.getElementById('btn-pan-down');
  btnPanDown?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, y: vp.y + 50 });
  });

  const btnPanReset = document.getElementById('btn-pan-reset');
  btnPanReset?.addEventListener('click', () => {
    const vp = getViewport();
    section.setViewport({ ...vp, x: 0, y: 0 });
  });

  // Hit-test sob ponteiro e atualização de presença
  if (canvas) {
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const worldPoint = toWorld(screenPoint);
      const hits = hitTestScreen(screenPoint);

      if (hittestInfoEl) {
        hittestInfoEl.textContent = `Tela: (${Math.round(screenPoint.x)}, ${Math.round(screenPoint.y)}) | Mundo: (${Math.round(worldPoint.x)}, ${Math.round(worldPoint.y)}) | Hit: ${hits.join(', ') || 'nenhum'}`;
      }
    });

    canvas.addEventListener('pointerleave', () => {
      if (hittestInfoEl) {
        hittestInfoEl.textContent = 'Cursor: nenhum';
      }
    });
  }

  // Controle de Grade
  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  const setGridEnabled = (enabled: boolean): void => {
    gridState.enabled = enabled;
    handle.invalidate();
    if (btnToggleGrid) {
      btnToggleGrid.textContent = `Grade: ${enabled ? 'Ativa' : 'Desativada'}`;
    }
  };
  const isGridEnabled = (): boolean => gridState.enabled;

  btnToggleGrid?.addEventListener('click', () => {
    setGridEnabled(!isGridEnabled());
  });

  // Controle de Snapping
  const btnToggleSnap = document.getElementById('btn-toggle-snap');
  const setSnappingEnabled = (enabled: boolean): void => {
    snappingState.enabled = enabled;
    if (btnToggleSnap) {
      btnToggleSnap.textContent = `Snap: ${enabled ? 'Ativo' : 'Desativado'}`;
    }
  };
  const isSnappingEnabled = (): boolean => snappingState.enabled;

  btnToggleSnap?.addEventListener('click', () => {
    setSnappingEnabled(!isSnappingEnabled());
  });

  // Botões de Ferramentas
  const btnToolSelect = document.getElementById('btn-tool-select');
  btnToolSelect?.addEventListener('click', () => {
    section.setTool('select');
  });

  const btnToolHand = document.getElementById('btn-tool-hand');
  btnToolHand?.addEventListener('click', () => {
    section.setTool('hand');
  });

  const btnToolRect = document.getElementById('btn-tool-rect');
  btnToolRect?.addEventListener('click', () => {
    section.setTool('rectangle');
  });

  const btnToolSquare = document.getElementById('btn-tool-square');
  btnToolSquare?.addEventListener('click', () => {
    section.setTool('square');
  });

  btnConvertType?.addEventListener('click', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node) return;
    if (node.type === 'square') {
      section.dispatch({
        type: 'shape.update',
        id: node.id,
        patch: { type: 'rectangle' },
      });
    } else if (node.type === 'rectangle') {
      section.dispatch({
        type: 'shape.update',
        id: node.id,
        patch: { type: 'square' },
      });
    } else if (node.type === 'circle') {
      section.dispatch({
        type: 'shape.update',
        id: node.id,
        patch: { type: 'ellipse' },
      });
    } else if (node.type === 'ellipse') {
      section.dispatch({
        type: 'shape.update',
        id: node.id,
        patch: { type: 'circle' },
      });
    }
  });

  const btnToolEllipse = document.getElementById('btn-tool-ellipse');
  btnToolEllipse?.addEventListener('click', () => {
    section.setTool('ellipse');
  });

  const btnToolCircle = document.getElementById('btn-tool-circle');
  btnToolCircle?.addEventListener('click', () => {
    section.setTool('circle');
  });

  const btnToolDiamond = document.getElementById('btn-tool-diamond');
  btnToolDiamond?.addEventListener('click', () => {
    section.setTool('diamond');
  });

  const btnToolTriangle = document.getElementById('btn-tool-triangle');
  btnToolTriangle?.addEventListener('click', () => {
    section.setTool('triangle');
  });

  selectTriangleVariant?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'triangle') return;
    const val = selectTriangleVariant.value as 'isosceles' | 'equilateral' | 'right' | 'scalene';
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { variant: val },
    });
  });

  inputTriangleApex?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'triangle' || node.variant !== 'scalene') return;
    const rawVal = parseFloat(inputTriangleApex.value);
    if (Number.isNaN(rawVal)) return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { apex: Math.max(0, Math.min(1, rawVal)) },
    });
  });

  const btnToolPolygon = document.getElementById('btn-tool-polygon');
  btnToolPolygon?.addEventListener('click', () => {
    section.setTool('polygon');
  });

  for (const tool of Object.keys(POLYGON_PRESETS)) {
    document.getElementById(`btn-tool-${tool}`)?.addEventListener('click', () => {
      section.setTool(tool);
    });
  }

  document.getElementById('btn-tool-cross')?.addEventListener('click', () => {
    section.setTool('cross');
  });

  document.getElementById('btn-tool-chevron')?.addEventListener('click', () => {
    section.setTool('chevron');
  });

  selectFontSize?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || (node.type !== 'text' && node.type !== 'sticky')) return;
    const value = selectFontSize.value;
    if (value === 'auto') {
      section.dispatch({ type: 'shape.update', id: node.id, patch: { fontSizeMode: 'auto' } });
      return;
    }
    const size = parseFloat(value);
    if (!Number.isFinite(size) || size <= 0) return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { fontSizeMode: 'fixed', fontSize: size },
    });
  });

  const selectStickyColor = document.getElementById(
    'select-sticky-color',
  ) as HTMLSelectElement | null;
  const stickyColorOf = (name: string): string | undefined =>
    (STICKY_COLORS as Record<string, string>)[name];

  const selectPenKind = document.getElementById('select-pen-kind') as HTMLSelectElement | null;
  const selectPenWidth = document.getElementById('select-pen-width') as HTMLSelectElement | null;
  const inputPenColor = document.getElementById('input-pen-color') as HTMLInputElement | null;

  const selectEraserSize = document.getElementById(
    'select-eraser-size',
  ) as HTMLSelectElement | null;

  document.getElementById('btn-tool-eraser')?.addEventListener('click', () => {
    section.setTool('eraser');
  });

  selectEraserSize?.addEventListener('change', () => {
    interactionHandle.setEraserSize(selectEraserSize.value as EraserSize);
    section.setTool('eraser');
  });

  document.getElementById('btn-tool-pen')?.addEventListener('click', () => {
    section.setTool('pen');
  });

  const applyPenSettings = (): void => {
    interactionHandle.setPenSettings({
      kind: selectPenKind?.value as InkKind | undefined,
      width: selectPenWidth?.value as InkWidth | undefined,
      color: inputPenColor?.value,
    });
    section.setTool('pen');
  };
  selectPenKind?.addEventListener('change', applyPenSettings);
  selectPenWidth?.addEventListener('change', applyPenSettings);
  inputPenColor?.addEventListener('input', applyPenSettings);

  document.getElementById('btn-tool-sticky')?.addEventListener('click', () => {
    section.setTool('sticky');
  });

  // Ilhas de grupo da toolbar (layout shell): Figuras, Nota e Desenho.
  let ghostIslands: GhostIslandsHandle | null = null;

  selectStickyColor?.addEventListener('change', () => {
    const color = stickyColorOf(selectStickyColor.value);
    if (color === undefined) return;
    interactionHandle.setStickyColor(color);
    ghostIslands?.noteStickyColor(color);
    section.setTool('sticky');
  });

  ghostIslands = mountGhostIslands({
    section,
    stickyColors: STICKY_COLORS,
    onStickyColor: (hex) => {
      interactionHandle.setStickyColor(hex);
      const name = Object.keys(STICKY_COLORS).find(
        (key) => (STICKY_COLORS as Record<string, string>)[key] === hex,
      );
      if (name !== undefined && selectStickyColor) selectStickyColor.value = name;
    },
  });

  selectStickyNodeColor?.addEventListener('change', () => {
    const color = stickyColorOf(selectStickyNodeColor.value);
    if (color === undefined) return;
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'sticky') return;
    section.dispatch({ type: 'shape.update', id: node.id, patch: { style: { fill: color } } });
  });

  document.getElementById('btn-tool-brace')?.addEventListener('click', () => {
    section.setTool('brace');
  });

  const patchSelectedBrace = (patch: Record<string, unknown>): void => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'brace') return;
    section.dispatch({ type: 'shape.update', id: node.id, patch });
  };

  selectBraceOrientation?.addEventListener('change', () => {
    const value = selectBraceOrientation.value;
    if (value !== 'right' && value !== 'left' && value !== 'up' && value !== 'down') return;
    patchSelectedBrace({ orientation: value });
  });

  for (const [input, field] of [
    [inputBraceTipPosition, 'tipPosition'],
    [inputBraceCurvature, 'curvature'],
  ] as const) {
    input?.addEventListener('change', () => {
      const rawVal = parseFloat(input.value);
      if (Number.isNaN(rawVal)) return;
      patchSelectedBrace({ [field]: Math.max(0, Math.min(1, rawVal)) });
    });
  }

  selectChevronDirection?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'chevron') return;
    const value = selectChevronDirection.value;
    if (value !== 'right' && value !== 'left' && value !== 'up' && value !== 'down') return;
    section.dispatch({ type: 'shape.update', id: node.id, patch: { direction: value } });
  });

  inputChevronNotchDepth?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'chevron') return;
    const rawVal = parseFloat(inputChevronNotchDepth.value);
    if (Number.isNaN(rawVal)) return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { notchDepth: Math.max(0, Math.min(0.5, rawVal)) },
    });
  });

  inputCrossArmRatio?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'cross') return;
    const rawVal = parseFloat(inputCrossArmRatio.value);
    if (Number.isNaN(rawVal)) return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { armRatio: Math.max(0.05, Math.min(1, rawVal)) },
    });
  });

  inputPolygonSides?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'polygon') return;
    const rawVal = Math.round(parseFloat(inputPolygonSides.value));
    if (Number.isNaN(rawVal)) return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { sides: Math.max(3, Math.min(12, rawVal)) },
    });
  });

  const btnToolBezier = document.getElementById('btn-tool-bezier');
  btnToolBezier?.addEventListener('click', () => {
    section.setTool('bezier');
  });

  inputBezierSymmetric?.addEventListener('change', () => {
    const snap = section.getSnapshot();
    if (snap.session.selectedIds.length !== 1) return;
    const node = snap.document.nodes[snap.session.selectedIds[0]!];
    if (!node || node.type !== 'bezier') return;
    section.dispatch({
      type: 'shape.update',
      id: node.id,
      patch: { symmetric: inputBezierSymmetric.checked },
    });
  });

  const btnToolLine = document.getElementById('btn-tool-line');
  btnToolLine?.addEventListener('click', () => {
    section.setTool('line');
  });

  const btnToolArrow = document.getElementById('btn-tool-arrow');
  btnToolArrow?.addEventListener('click', () => {
    section.setTool('arrow');
  });

  const btnToolText = document.getElementById('btn-tool-text');
  btnToolText?.addEventListener('click', () => {
    section.setTool('text');
  });

  btnToolBoard?.addEventListener('click', () => {
    section.setTool('board');
  });

  return {
    section,
    handle,
    interaction: interactionHandle,
    container,
    canvas,
    setViewport,
    setTool: (tool: string) => section.setTool(tool),
    screenToWorld: toWorld,
    worldToScreen: toScreen,
    hitTestScreen,
    setGridEnabled,
    isGridEnabled,
    setSnappingEnabled,
    isSnappingEnabled,
    storage: collabManager.storage,
    autosave: collabManager.autosave,
    getSession: collabManager.getSession,
    getSharing: collabManager.getSharing,
    startSharing: collabManager.startSharing,
    stopSharing: collabManager.stopSharing,
    server: collabManager.server,
    transport: collabManager.transport,
  };
}

import * as Collaboration from '@canvash/collaboration';
import * as CollaborationYjs from '@canvash/collaboration-yjs';
import * as Core from '@canvash/core';
import * as Export from '@canvash/export';
import * as Interaction from '@canvash/interaction';
import * as Persistence from '@canvash/persistence';

declare global {
  interface Window {
    __CANVASH_PLAYGROUND__?: PlaygroundInstance;
    __CANVASH_CORE__?: typeof Core;
    __CANVASH_INTERACTION__?: typeof Interaction;
    __CANVASH_PERSISTENCE__?: typeof Persistence;
    __CANVASH_EXPORT__?: typeof Export;
    __CANVASH_COLLABORATION__?: typeof Collaboration;
    __CANVASH_COLLABORATION_YJS__?: typeof CollaborationYjs;
  }
}

if (typeof document !== 'undefined') {
  window.__CANVASH_CORE__ = Core;
  window.__CANVASH_INTERACTION__ = Interaction;
  window.__CANVASH_PERSISTENCE__ = Persistence;
  window.__CANVASH_EXPORT__ = Export;
  window.__CANVASH_COLLABORATION__ = Collaboration;
  window.__CANVASH_COLLABORATION_YJS__ = CollaborationYjs;

  const container = document.getElementById('canvas-container');
  if (container) {
    const instance = setupPlayground(container);
    window.__CANVASH_PLAYGROUND__ = instance;
  }
}
