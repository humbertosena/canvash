import type { CanvasSectionApi, Result } from '@canvash/core';
import { err, ok, type PersistenceError } from './errors.js';
import type { StorageAdapter } from './storage.js';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions {
  /** Chave de identificação do documento no armazenamento. */
  readonly key: string;
  /** Tempo de espera em ms após última mutação para disparar a escrita (padrão: 500 ms). */
  readonly debounceMs?: number;
  /** Callback para notificação de transição de estado. */
  readonly onStatusChange?: (status: AutosaveStatus) => void;
  /** Callback para notificação de falhas de gravação. */
  readonly onError?: (error: PersistenceError) => void;
}

export interface AutosaveManager {
  readonly status: AutosaveStatus;
  readonly lastSavedRevision: number;
  flush(): Promise<Result<void, PersistenceError>>;
  destroy(): void;
}

/**
 * Cria um gerenciador de salvamento automático resiliente e serializado (IO-03, IO-04).
 *
 * Aplica debounce de 500 ms (configurável), serializa escritas assíncronas concorrentes,
 * garante que respostas antigas nunca confirmem revisões novas e preserva a integridade
 * em memória em caso de falha de armazenamento.
 */
export function createAutosaveManager(
  section: CanvasSectionApi,
  adapter: StorageAdapter,
  options: AutosaveOptions,
): AutosaveManager {
  const debounceMs = options.debounceMs ?? 500;
  let status: AutosaveStatus = 'idle';
  let lastSavedRevision = -1;
  let lastStorageRevision: number | undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let isSaving = false;
  let hasPendingSave = false;
  let isDestroyed = false;

  const setStatus = (next: AutosaveStatus) => {
    if (status !== next) {
      status = next;
      options.onStatusChange?.(status);
    }
  };

  const executeSave = async (): Promise<Result<void, PersistenceError>> => {
    if (isDestroyed) return ok(undefined);

    const snapshot = section.getSnapshot();
    const docToSave = snapshot.document;
    const revisionToSave = snapshot.revision;

    // Se já foi salvo nesta revisão e não há novas pendências
    if (revisionToSave === lastSavedRevision && !hasPendingSave) {
      setStatus('saved');
      return ok(undefined);
    }

    isSaving = true;
    hasPendingSave = false;
    setStatus('saving');

    // Um adapter que lança ou rejeita deixaria isSaving preso em true (nenhum save volta a
    // rodar e flush() não termina); a exceção vira Result e segue o caminho de erro normal.
    let saveResult: Result<{ revision: number }, PersistenceError>;
    try {
      saveResult = await adapter.save(options.key, docToSave, {
        expectedRevision: lastStorageRevision,
      });
    } catch (error) {
      saveResult = err('STORAGE_UNAVAILABLE', 'Storage adapter failed while saving.', {
        details: error,
      });
    }

    isSaving = false;

    if (!saveResult.ok) {
      setStatus('error');
      options.onError?.(saveResult.error);

      // Se houver nova mutação durante a falha, re-agenda
      if (hasPendingSave && !isDestroyed) {
        scheduleSave();
      }
      return saveResult;
    }

    lastStorageRevision = saveResult.value.revision;
    // Uma resposta antiga não pode marcar uma revisão nova como salva (IO-03)
    if (revisionToSave >= lastSavedRevision) {
      lastSavedRevision = revisionToSave;
    }

    // Se uma nova mutação ocorreu enquanto a escrita estava em voo, dispara imediatamente a próxima
    if (hasPendingSave && !isDestroyed) {
      return executeSave();
    }

    setStatus('saved');
    return ok(undefined);
  };

  const scheduleSave = () => {
    if (isDestroyed) return;
    hasPendingSave = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    timer = setTimeout(() => {
      timer = null;
      if (!isSaving) {
        void executeSave();
      }
    }, debounceMs);
  };

  const unsubscribe = section.subscribe((event) => {
    if (event.areas.includes('document')) {
      scheduleSave();
    }
  });

  return {
    get status() {
      return status;
    },
    get lastSavedRevision() {
      return lastSavedRevision;
    },
    async flush(): Promise<Result<void, PersistenceError>> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (isSaving) {
        hasPendingSave = true;
        // Aguarda a escrita atual e a pendente. Depois de destroy() a pendente nunca roda, então
        // só a escrita em voo é aguardada; senão o laço não terminaria.
        while (isSaving || (hasPendingSave && !isDestroyed)) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (status === 'error') break;
        }
        return status === 'error'
          ? {
              ok: false,
              error: { code: 'STORAGE_UNAVAILABLE', message: 'Flush failed due to storage error.' },
            }
          : ok(undefined);
      }
      return executeSave();
    },
    destroy() {
      isDestroyed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}
