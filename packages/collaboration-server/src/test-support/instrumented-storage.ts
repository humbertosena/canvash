import type { CollaborationError, Result } from '@canvash/collaboration';
import { createMemoryRoomStorage } from '../storage-memory.js';
import type { RoomStorage } from '../storage.js';

export type StorageMethod = 'load' | 'create' | 'append' | 'compact' | 'reset';

export interface InstrumentedStorage extends RoomStorage {
  readonly inner: RoomStorage;
  /** Quantas vezes cada método foi chamado. */
  readonly calls: Record<StorageMethod, number>;
  /** Os `documentId` de cada chamada, em ordem. */
  readonly log: Array<{ readonly method: StorageMethod; readonly documentId: string }>;
  /** Faz a próxima chamada do método devolver este erro, sem tocar os dados. */
  failNext(method: StorageMethod, error: CollaborationError, times?: number): void;
  /** Segura as chamadas do método até `release()`; devolve a função que solta. */
  hold(method: StorageMethod): () => void;
}

/** Armazenamento em memória que conta chamadas, falha sob comando e pode segurar chamadas. */
export function createInstrumentedStorage(
  inner: RoomStorage = createMemoryRoomStorage(),
): InstrumentedStorage {
  const calls: Record<StorageMethod, number> = {
    load: 0,
    create: 0,
    append: 0,
    compact: 0,
    reset: 0,
  };
  const log: Array<{ method: StorageMethod; documentId: string }> = [];
  const failures = new Map<StorageMethod, { error: CollaborationError; times: number }>();
  const holds = new Map<StorageMethod, Promise<void>>();

  async function run<T>(
    method: StorageMethod,
    documentId: string,
    call: () => Promise<Result<T, CollaborationError>>,
  ): Promise<Result<T, CollaborationError>> {
    calls[method] += 1;
    log.push({ method, documentId });
    const held = holds.get(method);
    if (held !== undefined) await held;
    const failure = failures.get(method);
    if (failure !== undefined && failure.times > 0) {
      failure.times -= 1;
      return { ok: false, error: failure.error };
    }
    return call();
  }

  return {
    inner,
    calls,
    log,
    failNext(method, error, times = 1) {
      failures.set(method, { error, times });
    },
    hold(method) {
      let release: () => void = () => undefined;
      holds.set(
        method,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        holds.delete(method);
        release();
      };
    },
    load: (documentId) => run('load', documentId, () => inner.load(documentId)),
    create: (documentId, room) => run('create', documentId, () => inner.create(documentId, room)),
    append: (documentId, batch) => run('append', documentId, () => inner.append(documentId, batch)),
    compact: (documentId, snapshot, through, options) =>
      run('compact', documentId, () => inner.compact(documentId, snapshot, through, options)),
    reset: (documentId, room) => run('reset', documentId, () => inner.reset(documentId, room)),
  };
}
