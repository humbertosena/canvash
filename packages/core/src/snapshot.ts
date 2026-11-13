import type { CanvasDocument } from './document.js';
import type { HistoryState } from './history.js';
import type { SessionState } from './session.js';

/**
 * Estado público de um canvas em um instante. É somente leitura em todos os níveis, e
 * `getSnapshot` devolve a mesma referência enquanto nada muda.
 */
export interface CanvasSnapshot {
  readonly document: CanvasDocument;
  /** Seleção, viewport, ferramenta e modo de leitura. A referência só muda quando um deles muda. */
  readonly session: SessionState;
  /** O que undo e redo podem fazer agora. A referência só muda quando um dos valores muda. */
  readonly history: HistoryState;
  /**
   * Contador local de commits de documento desta instância, começando em 0. Mudança só de
   * sessão publica um snapshot novo com a mesma revisão. Não é a versão do schema nem um
   * relógio distribuído.
   */
  readonly revision: number;
}
