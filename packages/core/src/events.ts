import type { CanvasSnapshot } from './snapshot.js';

/**
 * De onde veio uma alteração: comando local, sincronização, carga de documento ou undo/redo.
 * `remote` vem da colaboração: hoje só `setPeers` o emite.
 */
export type ChangeOrigin = 'local' | 'remote' | 'load' | 'history';

/**
 * Parte do estado do canvas que uma alteração tocou.
 *
 * Esta união pode ganhar membros em versões futuras: ao tratá-la caso a caso, deixe um ramo
 * para o que não conhecer.
 */
export type ChangeArea =
  'document' | 'selection' | 'viewport' | 'tool' | 'readOnly' | 'history' | 'preview' | 'peers';

/** Alteração publicada pelo canvas. Chega aos listeners depois do commit, já em vigor. */
export interface CanvasChange {
  /** Snapshot posterior à alteração; é o mesmo que `getSnapshot()` devolve durante o evento. */
  readonly snapshot: CanvasSnapshot;
  readonly origin: ChangeOrigin;
  /** Toda área cujo valor mudou nesta alteração. */
  readonly areas: readonly ChangeArea[];
  /**
   * IDs dos nós e das camadas criados, alterados ou removidos. Descreve só a área `document`:
   * vem vazio quando ela não está em `areas`.
   */
  readonly affectedIds: readonly string[];
}

export type CanvasListener = (change: CanvasChange) => void;

/** Recebe o que um listener lançou. Não deve lançar. */
export type ErrorHandler = (error: unknown) => void;

/** Inscrições de um canvas e a entrega dos eventos a elas. */
export interface Listeners {
  /** `true` enquanto um evento está sendo entregue. */
  readonly notifying: boolean;
  subscribe(listener: CanvasListener): () => void;
  emit(change: CanvasChange): void;
  /**
   * Solta todas as inscrições e descarta os eventos que esperavam entrega. Depois disso nada
   * mais é entregue, e inscrever devolve um cancelamento que não faz nada.
   */
  dispose(): void;
}

// Sem handler do host, o erro vira uma rejeição não tratada: o ambiente a registra (o navegador
// no console, o Node encerrando o processo), e o commit que disparou o evento não é afetado.
const reportUnhandled: ErrorHandler = (error) => {
  void Promise.reject(error);
};

export function createListeners(onError: ErrorHandler = reportUnhandled): Listeners {
  // Cada inscrição é um objeto próprio: a mesma função pode ser inscrita mais de uma vez.
  const subscriptions = new Set<{ readonly listener: CanvasListener }>();
  const pending: CanvasChange[] = [];
  let notifying = false;
  let disposed = false;

  const report = (error: unknown): void => {
    try {
      onError(error);
    } catch (handlerError) {
      reportUnhandled(handlerError);
    }
  };

  return {
    get notifying() {
      return notifying;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      if (disposed) return () => {};
      const subscription = { listener };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    emit(change) {
      // Um evento emitido durante a entrega de outro espera na fila: nunca há entrega aninhada.
      pending.push(change);
      if (notifying) return;
      notifying = true;
      for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
        // A cópia fixa quem recebe este evento: inscrição feita durante a entrega fica para o
        // próximo, e a removida durante a entrega é pulada.
        for (const subscription of [...subscriptions]) {
          if (!subscriptions.has(subscription)) continue;
          // Chamado solto: o listener não recebe o registro interno da inscrição como `this`.
          const { listener } = subscription;
          try {
            listener(next);
          } catch (error) {
            report(error);
          }
        }
      }
      notifying = false;
    },
    dispose() {
      disposed = true;
      subscriptions.clear();
      pending.length = 0;
    },
  };
}
