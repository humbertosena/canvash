import {
  computeSiblingReorderIndex,
  fitViewportToBounds,
  zoomAt,
  type CanvasSectionApi,
  type CanvasCommand,
  type CanvasDocument,
  type BoardNode,
  type CanvasNode,
  type GroupNode,
  type Layer,
  type Point,
  type SiblingReorderAction,
  type ViewportSize,
} from '@canvash/core';
import { hasPeerLocks, isPeerLocked } from './peer-lock.js';
import { buildMoveCommands, getMovableNodes } from './tools/move.js';

export type KeyboardAction =
  | 'delete'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'bring-to-front'
  | 'send-to-back'
  | 'bring-forward'
  | 'send-backward'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'zoom-fit'
  | 'zoom-selection'
  | 'edit-text';

export interface ShortcutKeyDefinition {
  readonly key?: string;
  readonly code?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export type KeyboardShortcutMap = Partial<
  Record<KeyboardAction, readonly ShortcutKeyDefinition[] | ShortcutKeyDefinition>
>;

export interface KeyboardShortcutEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
}

export const DEFAULT_SHORTCUTS: Record<KeyboardAction, readonly ShortcutKeyDefinition[]> = {
  delete: [{ key: 'Delete' }, { key: 'Backspace' }],
  'move-left': [{ key: 'ArrowLeft' }],
  'move-right': [{ key: 'ArrowRight' }],
  'move-up': [{ key: 'ArrowUp' }],
  'move-down': [{ key: 'ArrowDown' }],
  undo: [
    { key: 'z', ctrl: true, shift: false },
    { key: 'Z', ctrl: true, shift: false },
    { key: 'z', meta: true, shift: false },
    { key: 'Z', meta: true, shift: false },
  ],
  redo: [
    { key: 'z', ctrl: true, shift: true },
    { key: 'Z', ctrl: true, shift: true },
    { key: 'z', meta: true, shift: true },
    { key: 'Z', meta: true, shift: true },
    { key: 'y', ctrl: true, shift: false },
    { key: 'Y', ctrl: true, shift: false },
    { key: 'y', meta: true, shift: false },
    { key: 'Y', meta: true, shift: false },
  ],
  group: [
    { key: 'g', ctrl: true, shift: false },
    { key: 'G', ctrl: true, shift: false },
    { key: 'g', meta: true, shift: false },
    { key: 'G', meta: true, shift: false },
  ],
  ungroup: [
    { key: 'g', ctrl: true, shift: true },
    { key: 'G', ctrl: true, shift: true },
    { key: 'g', meta: true, shift: true },
    { key: 'G', meta: true, shift: true },
  ],
  'bring-to-front': [
    { key: ']', ctrl: true, shift: true },
    { key: '}', ctrl: true, shift: true },
    { key: ']', meta: true, shift: true },
    { key: '}', meta: true, shift: true },
  ],
  'send-to-back': [
    { key: '[', ctrl: true, shift: true },
    { key: '{', ctrl: true, shift: true },
    { key: '[', meta: true, shift: true },
    { key: '{', meta: true, shift: true },
  ],
  'bring-forward': [
    { key: ']', ctrl: true, shift: false },
    { key: ']', meta: true, shift: false },
  ],
  'send-backward': [
    { key: '[', ctrl: true, shift: false },
    { key: '[', meta: true, shift: false },
  ],
  // Zoom: identificado pelo `code` da tecla física, porque `=` e `+` ficam em lugares diferentes
  // conforme o layout. Ctrl cobre Meta (ver matchesDefinition); Shift é livre em Ctrl + =, para
  // aceitar também Ctrl + + digitado com Shift.
  'zoom-in': [
    { code: 'Equal', ctrl: true },
    { code: 'NumpadAdd', ctrl: true },
  ],
  'zoom-out': [
    { code: 'Minus', ctrl: true },
    { code: 'NumpadSubtract', ctrl: true },
  ],
  'zoom-reset': [{ code: 'Digit0', shift: true, ctrl: false, alt: false }],
  'zoom-fit': [{ code: 'Digit1', shift: true, ctrl: false, alt: false }],
  'zoom-selection': [{ code: 'Digit2', shift: true, ctrl: false, alt: false }],
  // Enter sozinho abre o texto da forma selecionada; com modificador, não (Ctrl/⌘+Enter confirma
  // o editor, e Shift+Enter quebra linha dentro dele).
  'edit-text': [{ key: 'Enter', ctrl: false, shift: false, alt: false }],
};

/** Fator de cada passo de Aproximar e Afastar. */
export const ZOOM_STEP_FACTOR = 1.2;

/**
 * Verifica se um elemento é um campo editável (input, textarea, select ou contenteditable).
 */
export function isEditableElement(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;

  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };

  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }

  if (el.isContentEditable === true) {
    return true;
  }

  if (typeof el.getAttribute === 'function') {
    const ce = el.getAttribute('contenteditable');
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') {
      return true;
    }
  }

  return false;
}

/**
 * Verifica se o foco atual pertence ao editor (ao container principal ou raízes de toolbar associadas).
 */
export function isFocusOnEditor(
  element: HTMLElement | null,
  activeElement: Element | null,
  additionalRoots?: readonly HTMLElement[],
): boolean {
  if (!element || !activeElement) return false;

  if (element === activeElement || element.contains(activeElement)) {
    return true;
  }

  if (additionalRoots) {
    for (const root of additionalRoots) {
      if (root === activeElement || root.contains(activeElement)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Elemento com o foco, descendo pelos Shadow DOMs abertos: `document.activeElement` devolve o
 * host de um componente, não o elemento focado dentro dele.
 */
function deepActiveElement(doc: Document | undefined): Element | null {
  let active = doc?.activeElement ?? null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function matchesDefinition(def: ShortcutKeyDefinition, event: KeyboardShortcutEvent): boolean {
  if (def.key !== undefined && def.key.toLowerCase() !== event.key.toLowerCase()) {
    return false;
  }
  if (def.code !== undefined && def.code !== event.code) {
    return false;
  }

  const hasCtrl = event.ctrlKey ?? false;
  const hasMeta = event.metaKey ?? false;
  const hasShift = event.shiftKey ?? false;
  const hasAlt = event.altKey ?? false;

  if (def.ctrl !== undefined && def.ctrl !== (hasCtrl || hasMeta)) {
    return false;
  }
  if (def.meta !== undefined && def.meta !== hasMeta) {
    return false;
  }
  if (def.shift !== undefined && def.shift !== hasShift) {
    return false;
  }
  if (def.alt !== undefined && def.alt !== hasAlt) {
    return false;
  }

  return true;
}

/**
 * Corresponde um evento de teclado a uma ação com base no mapa de atalhos configurado ou padrão.
 */
export function matchKeyboardShortcut(
  event: KeyboardShortcutEvent,
  customMap?: KeyboardShortcutMap,
): KeyboardAction | null {
  if (event.isComposing) return null;

  const actions: KeyboardAction[] = [
    'undo',
    'redo',
    'ungroup',
    'group',
    'bring-to-front',
    'send-to-back',
    'bring-forward',
    'send-backward',
    'delete',
    'move-left',
    'move-right',
    'move-up',
    'move-down',
    'zoom-in',
    'zoom-out',
    'zoom-reset',
    'zoom-fit',
    'zoom-selection',
    'edit-text',
  ];

  for (const action of actions) {
    const custom = customMap?.[action];
    const defs =
      custom !== undefined
        ? Array.isArray(custom)
          ? custom
          : [custom]
        : DEFAULT_SHORTCUTS[action];

    for (const def of defs) {
      if (matchesDefinition(def, event)) {
        return action;
      }
    }
  }

  return null;
}

/**
 * Remove os nós selecionados que são elegíveis (não bloqueados e pertencentes a camadas desbloqueadas).
 */
export function executeDelete(section: CanvasSectionApi, selectedIds: readonly string[]): boolean {
  if (section.getSnapshot().session.readOnly) return false;
  // O board sozinho: remover o board já leva os descendentes, e um `shape.remove` por descendente
  // falharia depois dele.
  const deletable = getMovableNodes(section, selectedIds, { expandBoards: false });
  if (deletable.length === 0) return false;

  const commands: CanvasCommand[] = deletable.map((node) => ({
    type: 'shape.remove',
    id: node.id,
  }));

  section.transact(commands);

  const deletedIds = new Set(deletable.map((n) => n.id));
  const remaining = selectedIds.filter((id) => !deletedIds.has(id));
  section.setSelection(remaining);
  return true;
}

/**
 * Desloca os nós selecionados em passos de 1 px (ou 10 px com Shift ativo).
 */
export function executeNudge(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  direction: 'left' | 'right' | 'up' | 'down',
  shiftKey: boolean,
): boolean {
  if (section.getSnapshot().session.readOnly) return false;
  const movable = getMovableNodes(section, selectedIds);
  if (movable.length === 0) return false;

  const step = shiftKey ? 10 : 1;
  const delta: Point = {
    x: direction === 'left' ? -step : direction === 'right' ? step : 0,
    y: direction === 'up' ? -step : direction === 'down' ? step : 0,
  };

  const commands = buildMoveCommands(movable, delta);
  section.transact(commands);
  return true;
}

/**
 * Desfaz a última transação no canvas (respeitando readOnly).
 */
export function executeUndo(section: CanvasSectionApi): boolean {
  if (section.getSnapshot().session.readOnly) return false;
  const res = section.undo();
  return res.ok && res.value.changed;
}

/**
 * Refaz a última transação desfeita no canvas (respeitando readOnly).
 */
export function executeRedo(section: CanvasSectionApi): boolean {
  if (section.getSnapshot().session.readOnly) return false;
  const res = section.redo();
  return res.ok && res.value.changed;
}

/** Como uma ação de grupo aparece: fora do menu, no menu sem efeito ou pronta para usar. */
export type ActionAvailability = 'hidden' | 'disabled' | 'enabled';

/** O estado de Agrupar e de Desagrupar para uma seleção. */
export interface GroupActionsAvailability {
  readonly group: ActionAvailability;
  readonly ungroup: ActionAvailability;
}

const NO_GROUP_ACTIONS: GroupActionsAvailability = { group: 'hidden', ungroup: 'hidden' };

/** Camada de cada nó e grupo de cada membro, lidos do documento uma vez. */
interface GroupIndex {
  readonly layerOf: ReadonlyMap<string, Layer>;
  readonly groupOf: ReadonlyMap<string, GroupNode>;
  /** Board que lista o nó como filho direto (o grupo dentro do board também conta). */
  readonly boardOf: ReadonlyMap<string, BoardNode>;
}

// O índice vale para um documento; o cursor de outra pessoa ou a seleção mudam sem trocá-lo.
const GROUP_INDEX = new WeakMap<CanvasDocument, GroupIndex>();

function groupIndexOf(document: CanvasDocument): GroupIndex {
  const known = GROUP_INDEX.get(document);
  if (known !== undefined) return known;
  const layerOf = new Map<string, Layer>();
  const groupOf = new Map<string, GroupNode>();
  const boardOf = new Map<string, BoardNode>();
  const addMembers = (layer: Layer, group: GroupNode): void => {
    for (const memberId of group.childIds) {
      layerOf.set(memberId, layer);
      groupOf.set(memberId, group);
    }
  };
  for (const layer of document.layers) {
    for (const id of layer.childIds) {
      layerOf.set(id, layer);
      const node = document.nodes[id];
      if (node?.type === 'group') addMembers(layer, node);
      if (node?.type !== 'board') continue;
      for (const childId of node.childIds) {
        layerOf.set(childId, layer);
        boardOf.set(childId, node);
        const child = document.nodes[childId];
        if (child?.type === 'group') addMembers(layer, child);
      }
    }
  }
  const index: GroupIndex = { layerOf, groupOf, boardOf };
  GROUP_INDEX.set(document, index);
  return index;
}

/**
 * Um grupo se desfaz se ele, a camada dele e o board que o contém não têm `locked`
 * (`group.ungroup` do core).
 */
function canUngroup(group: GroupNode, index: GroupIndex): boolean {
  return (
    !group.locked &&
    index.layerOf.get(group.id)?.locked === false &&
    index.boardOf.get(group.id)?.locked !== true
  );
}

/** Os nós da seleção que existem e que outra pessoa não bloqueou, sem repetição. */
function freeNodes(
  section: CanvasSectionApi,
  document: CanvasDocument,
  selectedIds: readonly string[],
): CanvasNode[] {
  const free: CanvasNode[] = [];
  for (const id of new Set(selectedIds)) {
    const node = document.nodes[id];
    if (node !== undefined && !isPeerLocked(section, id)) free.push(node);
  }
  return free;
}

/**
 * Diz se Agrupar e Desagrupar aparecem para a seleção e se valem (US-GA.1 a US-GA.4 e US-GA.8).
 * Só entram na conta os nós que existem e que outra pessoa não bloqueou. As regras são as de
 * `group.create` e `group.ungroup` do core, então `enabled` é o que `executeGroup` e
 * `executeUngroup` conseguem fazer.
 *
 * @example
 * const { selectedIds } = section.getSnapshot().session;
 * const { group, ungroup } = getGroupActions(section, selectedIds);
 * if (group === 'enabled') executeGroup(section, selectedIds);
 * if (ungroup === 'enabled') executeUngroup(section, selectedIds);
 */
export function getGroupActions(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
): GroupActionsAvailability {
  const snapshot = section.getSnapshot();
  if (snapshot.session.readOnly) return NO_GROUP_ACTIONS;

  const { document } = snapshot;
  const index = groupIndexOf(document);
  // Sem bloqueio de outra pessoa na sessão, a consulta por nó é dispensada.
  const checkLocks = hasPeerLocks(section);

  // Uma passada só, sem copiar a seleção: com milhares de nós selecionados e a conta refeita a
  // cada mudança de cursor remoto, o custo é o do laço.
  let first: CanvasNode | undefined;
  let layer: Layer | undefined;
  let firstBoard: string | undefined; // o board do primeiro nó livre, se ele estiver num
  let distinct = false; // há dois nós livres diferentes (IDs repetidos contam uma vez)
  let groupable = false; // as regras de group.create valem para todos os livres até aqui
  let hasGroup = false;
  let ungroupable = false;
  for (const id of selectedIds) {
    const node = document.nodes[id];
    if (node === undefined || (checkLocks && isPeerLocked(section, id))) continue;
    if (first === undefined) {
      first = node;
      layer = index.layerOf.get(id);
      firstBoard = index.boardOf.get(id)?.id;
      groupable = layer !== undefined && !layer.locked;
    } else if (node.id !== first.id) {
      distinct = true;
    }
    if (node.type === 'group') {
      hasGroup = true;
      groupable = false;
      if (!ungroupable && canUngroup(node, index)) ungroupable = true;
    } else if (
      groupable &&
      (node.type === 'board' ||
        node.locked ||
        index.groupOf.has(id) ||
        index.layerOf.get(id) !== layer ||
        // Os livres têm de ter o mesmo pai: todos na camada, ou todos no mesmo board, que não pode
        // estar `locked`.
        index.boardOf.get(id)?.id !== firstBoard ||
        index.boardOf.get(id)?.locked === true)
    ) {
      groupable = false;
    }
  }
  if (first === undefined) return NO_GROUP_ACTIONS;

  const ungroup: ActionAvailability = !hasGroup ? 'hidden' : ungroupable ? 'enabled' : 'disabled';
  const group: ActionAvailability = !distinct ? 'hidden' : groupable ? 'enabled' : 'disabled';
  return { group, ungroup };
}

/**
 * Agrupa os nós selecionados no canvas quando `getGroupActions` diz que vale (INPUT-08). Os nós
 * bloqueados por outra pessoa ficam de fora, e o grupo criado passa a ser a seleção.
 */
export function executeGroup(section: CanvasSectionApi, selectedIds: readonly string[]): boolean {
  if (getGroupActions(section, selectedIds).group !== 'enabled') return false;

  const free = freeNodes(section, section.getSnapshot().document, selectedIds);
  const res = section.dispatch({
    type: 'group.create',
    childIds: free.map((node) => node.id),
  });

  if (res.ok && res.value.createdIds.length > 0) {
    section.setSelection(res.value.createdIds);
    return true;
  }
  return false;
}

/**
 * Desfaz os grupos selecionados que valem, todos numa transação só (um passo de histórico), e
 * seleciona os filhos liberados (INPUT-08). Grupo com `locked`, em camada com `locked` ou
 * bloqueado por outra pessoa fica como está.
 */
export function executeUngroup(section: CanvasSectionApi, selectedIds: readonly string[]): boolean {
  if (getGroupActions(section, selectedIds).ungroup !== 'enabled') return false;

  const { document } = section.getSnapshot();
  const index = groupIndexOf(document);
  const groups = freeNodes(section, document, selectedIds).filter(
    (node): node is GroupNode => node.type === 'group' && canUngroup(node, index),
  );
  if (groups.length === 0) return false;

  const res = section.transact(groups.map((group) => ({ type: 'group.ungroup', id: group.id })));
  if (!res.ok) return false;

  section.setSelection(groups.flatMap((group) => group.childIds));
  return true;
}

/**
 * Executa reordenação de irmãos no documento para os nós selecionados (INPUT-08).
 */
export function executeReorder(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  action: SiblingReorderAction,
): boolean {
  if (section.getSnapshot().session.readOnly) return false;
  if (selectedIds.length === 0) return false;

  const doc = section.getSnapshot().document;
  const commands: CanvasCommand[] = [];

  for (const id of selectedIds) {
    if (isPeerLocked(section, id)) continue;
    const targetIndex = computeSiblingReorderIndex(doc, id, action);
    if (targetIndex !== undefined) {
      commands.push({
        type: 'node.reorder',
        id,
        index: targetIndex,
      });
    }
  }

  if (commands.length === 0) return false;
  const res = section.transact(commands);
  return res.ok && res.value.changed;
}

const hasArea = (size: ViewportSize): boolean => size.width > 0 && size.height > 0;

/** Leva o zoom a `zoom`, mantendo no lugar o ponto central da área de apresentação. */
function zoomAtCenter(section: CanvasSectionApi, size: ViewportSize, zoom: number): boolean {
  if (!hasArea(size) || !Number.isFinite(zoom) || zoom <= 0) return false;
  const viewport = section.getSnapshot().session.viewport;
  const next = zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, zoom);
  // Sem mudança de zoom (já no limite), `zoomAt` devolve o mesmo objeto: nada a publicar.
  return next !== viewport && section.setViewport(next).ok;
}

/** Multiplica o zoom por `factor` em torno do centro. Zoom é visualização: vale em somente leitura. */
export function executeZoomBy(
  section: CanvasSectionApi,
  size: ViewportSize,
  factor: number,
): boolean {
  if (!Number.isFinite(factor) || factor <= 0) return false;
  return zoomAtCenter(section, size, section.getSnapshot().session.viewport.zoom * factor);
}

/** Leva o zoom a 100% em torno do centro. */
export function executeZoomReset(section: CanvasSectionApi, size: ViewportSize): boolean {
  return zoomAtCenter(section, size, 1);
}

function fitToIds(section: CanvasSectionApi, size: ViewportSize, ids: readonly string[]): boolean {
  if (!hasArea(size) || ids.length === 0) return false;
  const bounds = section.getBounds(ids, { includePreview: false, stroke: true });
  if (!bounds) return false;
  const viewport = fitViewportToBounds(bounds, size);
  return viewport !== null && section.setViewport(viewport).ok;
}

/** Enquadra todos os nós do documento. */
export function executeFitContent(section: CanvasSectionApi, size: ViewportSize): boolean {
  return fitToIds(section, size, Object.keys(section.getSnapshot().document.nodes));
}

/** Enquadra os nós selecionados. */
export function executeFitSelection(section: CanvasSectionApi, size: ViewportSize): boolean {
  return fitToIds(section, size, section.getSnapshot().session.selectedIds);
}

export interface KeyboardAdapterOptions {
  element: HTMLElement;
  section: CanvasSectionApi;
  shortcuts?: KeyboardShortcutMap;
  additionalFocusRoots?: readonly HTMLElement[];
  targetWindow?: Window;
  targetDocument?: Document;
  /**
   * Abre o editor do texto da forma selecionada. Devolve `true` quando abriu: só então o Enter é
   * consumido (com mais de um nó, texto livre ou nota, o Enter segue o caminho normal).
   */
  onEditText?: () => boolean;
}

/**
 * Adaptador de teclado para manipulação de atalhos do editor com isolamento de foco (INPUT-10).
 */
export class KeyboardAdapter {
  private readonly element: HTMLElement;
  private readonly section: CanvasSectionApi;
  private readonly shortcuts?: KeyboardShortcutMap | undefined;
  private readonly additionalFocusRoots?: readonly HTMLElement[] | undefined;
  private readonly targetWindow?: Window | undefined;
  private readonly targetDocument?: Document | undefined;
  private readonly onEditText?: (() => boolean) | undefined;
  private destroyed = false;

  constructor(options: KeyboardAdapterOptions) {
    this.element = options.element;
    this.section = options.section;
    this.shortcuts = options.shortcuts;
    this.additionalFocusRoots = options.additionalFocusRoots;
    this.onEditText = options.onEditText;
    this.targetWindow =
      options.targetWindow ?? (typeof window !== 'undefined' ? window : undefined);
    this.targetDocument =
      options.targetDocument ?? (typeof document !== 'undefined' ? document : undefined);

    if (
      typeof this.element.getAttribute === 'function' &&
      this.element.getAttribute('tabindex') === null
    ) {
      this.element.setAttribute('tabindex', '0');
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    if (this.targetWindow) {
      this.targetWindow.addEventListener('keydown', this.onKeyDown, { capture: true });
    }
    if (typeof this.element.addEventListener === 'function') {
      this.element.addEventListener('pointerdown', this.onPointerDown);
    }
  }

  private readonly onPointerDown = (): void => {
    if (this.destroyed) return;
    const active = this.targetDocument?.activeElement;
    if (
      typeof this.element.focus === 'function' &&
      active !== this.element &&
      !(typeof this.element.contains === 'function' && active && this.element.contains(active))
    ) {
      try {
        this.element.focus({ preventScroll: true });
      } catch {
        try {
          this.element.focus();
        } catch {
          // Ignora falhas de foco
        }
      }
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return;
    if (event.isComposing) return;
    // No `window`, um evento vindo de dentro de um Shadow DOM chega com o alvo reajustado para o
    // host: o alvo real é o primeiro item do caminho composto.
    const origin = typeof event.composedPath === 'function' ? event.composedPath()[0] : undefined;
    if (isEditableElement(origin ?? event.target)) return;

    // Isolamento de foco: apenas reage se o foco atual pertencer a este editor (INPUT-10)
    const active = deepActiveElement(this.targetDocument);
    if (!isFocusOnEditor(this.element, active, this.additionalFocusRoots)) {
      return;
    }

    const action = matchKeyboardShortcut(event, this.shortcuts);
    if (!action) return;

    // O Enter só é tomado se abriu o editor do texto da forma; do contrário segue o caminho normal.
    if (action === 'edit-text') {
      if (this.onEditText?.() === true) event.preventDefault();
      return;
    }

    // Atalho correspondido com foco no editor: previne comportamentos nativos (ex: Backspace voltar página, setas scrollarem)
    event.preventDefault();

    const selectedIds = this.section.getSnapshot().session.selectedIds;

    switch (action) {
      case 'delete':
        executeDelete(this.section, selectedIds);
        break;
      case 'move-left':
        executeNudge(this.section, selectedIds, 'left', event.shiftKey);
        break;
      case 'move-right':
        executeNudge(this.section, selectedIds, 'right', event.shiftKey);
        break;
      case 'move-up':
        executeNudge(this.section, selectedIds, 'up', event.shiftKey);
        break;
      case 'move-down':
        executeNudge(this.section, selectedIds, 'down', event.shiftKey);
        break;
      case 'undo':
        executeUndo(this.section);
        break;
      case 'redo':
        executeRedo(this.section);
        break;
      case 'group':
        executeGroup(this.section, selectedIds);
        break;
      case 'ungroup':
        executeUngroup(this.section, selectedIds);
        break;
      case 'bring-to-front':
        executeReorder(this.section, selectedIds, 'bringToFront');
        break;
      case 'send-to-back':
        executeReorder(this.section, selectedIds, 'sendToBack');
        break;
      case 'bring-forward':
        executeReorder(this.section, selectedIds, 'bringForward');
        break;
      case 'send-backward':
        executeReorder(this.section, selectedIds, 'sendBackward');
        break;
      case 'zoom-in':
        executeZoomBy(this.section, this.viewportSize(), ZOOM_STEP_FACTOR);
        break;
      case 'zoom-out':
        executeZoomBy(this.section, this.viewportSize(), 1 / ZOOM_STEP_FACTOR);
        break;
      case 'zoom-reset':
        executeZoomReset(this.section, this.viewportSize());
        break;
      case 'zoom-fit':
        executeFitContent(this.section, this.viewportSize());
        break;
      case 'zoom-selection':
        executeFitSelection(this.section, this.viewportSize());
        break;
    }
  };

  /** Tamanho atual do elemento do editor, medido no momento da tecla. */
  private viewportSize(): ViewportSize {
    return { width: this.element.clientWidth, height: this.element.clientHeight };
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.targetWindow) {
      this.targetWindow.removeEventListener('keydown', this.onKeyDown, { capture: true });
    }
    if (typeof this.element.removeEventListener === 'function') {
      this.element.removeEventListener('pointerdown', this.onPointerDown);
    }
  }
}
