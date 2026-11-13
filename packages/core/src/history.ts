import type { DocumentPatch } from './draft.js';
import { must } from './invariant.js';

/** O que o histórico de um canvas permite fazer agora. */
export interface HistoryState {
  /** Há alteração para desfazer. */
  readonly canUndo: boolean;
  /** Há alteração desfeita para refazer. */
  readonly canRedo: boolean;
}

// Um objeto fixo por combinação: enquanto os dois valores não mudam, o snapshot carrega a
// mesma referência.
const STATES: readonly HistoryState[] = [
  Object.freeze({ canUndo: false, canRedo: false }),
  Object.freeze({ canUndo: false, canRedo: true }),
  Object.freeze({ canUndo: true, canRedo: false }),
  Object.freeze({ canUndo: true, canRedo: true }),
];

export const EMPTY_HISTORY = STATES[0] as HistoryState;

/** Limite padrão de transações guardadas. */
const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Pilhas de desfazer e refazer de um canvas. Cada entrada é o patch de uma transação: aplicar o
 * lado `before` desfaz, aplicar o lado `after` refaz.
 */
export class History {
  readonly #limit: number;
  #done: DocumentPatch[] = [];
  #undone: DocumentPatch[] = [];

  /**
   * @param limit Quantas transações guardar. Além disso, as mais antigas são descartadas.
   * @throws {RangeError} Se `limit` não for um inteiro maior ou igual a zero.
   */
  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new RangeError('historyLimit must be a non-negative integer');
    }
    this.#limit = limit;
  }

  get state(): HistoryState {
    const index = (this.#done.length > 0 ? 2 : 0) + (this.#undone.length > 0 ? 1 : 0);
    return STATES[index] as HistoryState;
  }

  /** Registra uma alteração nova. O que estava desfeito deixa de poder ser refeito. */
  record(patch: DocumentPatch): void {
    this.#done.push(patch);
    if (this.#done.length > this.#limit) this.#done.shift();
    this.#undone = [];
  }

  /** A alteração que o próximo undo desfaz. */
  get lastDone(): DocumentPatch | undefined {
    return this.#done.at(-1);
  }

  /** A alteração que o próximo redo refaz. */
  get lastUndone(): DocumentPatch | undefined {
    return this.#undone.at(-1);
  }

  /** Move a última alteração feita para a pilha das desfeitas. */
  markUndone(): void {
    this.#undone.push(must(this.#done.pop(), 'a change to undo'));
  }

  /** Move a última alteração desfeita de volta para a pilha das feitas. */
  markRedone(): void {
    this.#done.push(must(this.#undone.pop(), 'a change to redo'));
  }

  /** Esquece tudo: o documento foi substituído e os patches guardados não se aplicam mais. */
  clear(): void {
    this.#done = [];
    this.#undone = [];
  }
}
