import type { BoardNode } from '../shapes.js';

/** Altura da faixa do título, logo acima da borda superior do board, em unidades do documento. */
export const BOARD_TITLE_BAND = 24;

/** Tamanho da fonte do título do board, em unidades do documento. */
export const BOARD_TITLE_FONT_SIZE = 14;

/** Largura da borda do board, em unidades do documento. */
export const BOARD_BORDER_WIDTH = 1;

/** A caixa de um board, no mesmo formato de `Bounds`. */
interface BoardBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A faixa do título: a largura do board, logo acima da borda superior. */
export function boardTitleBounds(board: Pick<BoardNode, 'x' | 'y' | 'width'>): BoardBox {
  return {
    x: board.x,
    y: board.y - BOARD_TITLE_BAND,
    width: board.width,
    height: BOARD_TITLE_BAND,
  };
}

/**
 * Metade da borda do board, que é o que ela pinta para fora do retângulo: zero quando o board
 * não tem borda.
 */
export function boardHalfStroke(board: Pick<BoardNode, 'style'>): number {
  return board.style.stroke === null ? 0 : BOARD_BORDER_WIDTH / 2;
}

/**
 * A caixa do board com a faixa do título. Com `stroke`, soma meia unidade de cada lado, que é o
 * que a borda pinta para fora.
 */
export function boardBox(board: BoardNode, stroke: boolean): BoardBox {
  const reach = stroke ? boardHalfStroke(board) : 0;
  return {
    x: board.x - reach,
    y: board.y - BOARD_TITLE_BAND - reach,
    width: board.width + 2 * reach,
    height: board.height + BOARD_TITLE_BAND + 2 * reach,
  };
}
