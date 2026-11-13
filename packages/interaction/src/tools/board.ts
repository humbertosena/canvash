import type {
  CanvasCommand,
  CanvasDocument,
  CanvasSectionApi,
  Point,
  PreviewBoard,
} from '@canvash/core';
import { isPeerLocked } from '../peer-lock.js';

/** Largura do board criado por um clique, em unidades do documento. */
/** Tamanho máximo do título do board, em caracteres (o mesmo limite do core). */
export const BOARD_TITLE_MAX_LENGTH = 200;

export const DEFAULT_BOARD_WIDTH = 640;

/** Altura do board criado por um clique, em unidades do documento. */
export const DEFAULT_BOARD_HEIGHT = 400;

/** O título do board novo quando o host não dá o próprio. */
const defaultBoardTitle = (n: number): string => `Board ${n}`;

export interface BoardBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Caixa do board criado pelo gesto. Um clique, ou um arrasto menor que `minDrag` em algum eixo,
 * põe o board de 640 × 400 com o canto superior esquerdo no ponto; um arrasto maior usa a caixa
 * do gesto, em qualquer direção.
 */
export function computeBoardCreation(start: Point, end: Point, minDrag: number): BoardBox {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < minDrag || height < minDrag) {
    return { x: start.x, y: start.y, width: DEFAULT_BOARD_WIDTH, height: DEFAULT_BOARD_HEIGHT };
  }
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
}

/**
 * O título do próximo board: `titleFor(N)`, com N o menor inteiro a partir de 1 cujo título
 * nenhum board do documento usa.
 */
export function nextBoardTitle(
  document: CanvasDocument,
  titleFor: (n: number) => string = defaultBoardTitle,
): string {
  const used = new Set<string>();
  for (const node of Object.values(document.nodes)) {
    if (node.type === 'board') used.add(node.title);
  }
  let n = 1;
  while (used.has(titleFor(n))) n += 1;
  return titleFor(n);
}

/** O board provisório do arrasto: só a moldura e o título, sem filhos. */
export function buildBoardPreview(box: BoardBox, title: string, id: string): PreviewBoard {
  return { id, type: 'board', ...box, title };
}

/**
 * Os nós que o board novo adota: os de nível superior da camada com o centro dentro do
 * retângulo, visíveis, livres (sem `locked`, sem camada bloqueada e sem bloqueio de outra
 * sessão) e que não são boards. A ordem é a da camada, de baixo para cima.
 */
export function boardAdoptees(section: CanvasSectionApi, layerId: string, box: BoardBox): string[] {
  const snapshot = section.getSnapshot();
  const layer = snapshot.document.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) return [];
  const adopted: string[] = [];
  for (const id of layer.childIds) {
    const node = snapshot.document.nodes[id];
    if (node === undefined || node.type === 'board') continue;
    const info = section.getNodeInfo(id);
    if (info === undefined || !info.visible || info.locked || isPeerLocked(section, id)) continue;
    const bounds = section.getBounds([id], { includePreview: false, stroke: false });
    if (bounds === undefined) continue;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    if (
      centerX >= box.x &&
      centerX <= box.x + box.width &&
      centerY >= box.y &&
      centerY <= box.y + box.height
    ) {
      adopted.push(id);
    }
  }
  return adopted;
}

/** Um ID novo para o board, livre no documento: o comando de adoção precisa dele antes do commit. */
export function newBoardId(document: CanvasDocument): string {
  let id: string;
  do {
    id = `board-${Math.random().toString(36).slice(2, 10)}`;
  } while (document.nodes[id] !== undefined || document.id === id);
  return id;
}

/**
 * Os comandos do commit: criar o board na camada e adotar os nós, na mesma transação. Sem nós
 * para adotar, só a criação.
 */
export function buildBoardCommands(
  boardId: string,
  box: BoardBox,
  title: string,
  layerId: string,
  adoptees: readonly string[],
): CanvasCommand[] {
  return [
    { type: 'shape.create', layerId, shape: { id: boardId, type: 'board', ...box, title } },
    ...(adoptees.length > 0
      ? [{ type: 'board.attach', boardId, ids: adoptees } as CanvasCommand]
      : []),
  ];
}
