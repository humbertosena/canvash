import type { CanvasDocument, Result } from '@canvash/core';
import { err, ok, type PersistenceError } from './errors.js';
import { parseDocument } from './parse.js';

export interface StorageRecord {
  readonly key: string;
  readonly document: CanvasDocument;
  readonly revision: number;
  readonly updatedAt: number;
}

export interface SaveOptions {
  /** Revisão esperada no armazenamento para controle de concorrência otimista (IO-03). */
  readonly expectedRevision?: number;
}

export interface StorageAdapter {
  load(
    key: string,
  ): Promise<Result<{ document: CanvasDocument; revision: number }, PersistenceError>>;
  save(
    key: string,
    document: CanvasDocument,
    options?: SaveOptions,
  ): Promise<Result<{ revision: number }, PersistenceError>>;
  delete?(key: string): Promise<Result<void, PersistenceError>>;
}

export interface IndexedDbStorageOptions {
  /** Nome do banco IndexedDB (padrão: 'canvash_storage'). */
  dbName?: string;
  /** Nome da object store (padrão: 'documents'). */
  storeName?: string;
}

/**
 * Adaptador de armazenamento local em IndexedDB com controle de concorrência (IO-03, IO-04).
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  private readonly dbName: string;
  private readonly storeName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbStorageOptions = {}) {
    this.dbName = options.dbName ?? 'canvash_storage';
    this.storeName = options.storeName ?? 'documents';
  }

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is not available in this environment.'));
    }

    const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // O navegador pode fechar a conexão (descarte da aba, limpeza de dados); sem esquecer o
        // cache, toda operação seguinte falharia para sempre com InvalidStateError.
        db.onclose = () => {
          this.forgetConnection(dbPromise);
        };
        // Sem close(), o upgrade ou deleteDatabase de outra aba fica bloqueado indefinidamente.
        db.onversionchange = () => {
          db.close();
          this.forgetConnection(dbPromise);
        };
        resolve(db);
      };

      request.onerror = () => {
        reject(request.error ?? new Error('Failed to open IndexedDB.'));
      };
    });

    this.dbPromise = dbPromise;
    // Uma abertura que falhou (erro ou throw síncrono do open) não fica em cache: a próxima
    // operação tenta de novo em vez de repetir a mesma rejeição para sempre.
    void dbPromise.catch(() => {
      this.forgetConnection(dbPromise);
    });
    return dbPromise;
  }

  private forgetConnection(dbPromise: Promise<IDBDatabase>): void {
    if (this.dbPromise === dbPromise) this.dbPromise = null;
  }

  async load(
    key: string,
  ): Promise<Result<{ document: CanvasDocument; revision: number }, PersistenceError>> {
    try {
      const db = await this.getDB();
      // O await mantém dentro deste try o throw síncrono de db.transaction (conexão fechada).
      return await new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result as StorageRecord | undefined;
          if (!record) {
            resolve(err('INVALID_DOCUMENT', `Document with key "${key}" not found in storage.`));
            return;
          }

          const parsed = parseDocument(record.document);
          if (!parsed.ok) {
            resolve(parsed);
            return;
          }

          resolve(ok({ document: parsed.value, revision: record.revision }));
        };

        req.onerror = () => {
          resolve(
            err('STORAGE_UNAVAILABLE', 'Failed to read document from IndexedDB.', {
              details: req.error,
            }),
          );
        };
      });
    } catch (error) {
      return err('STORAGE_UNAVAILABLE', 'IndexedDB is unavailable.', { details: error });
    }
  }

  async save(
    key: string,
    document: CanvasDocument,
    options: SaveOptions = {},
  ): Promise<Result<{ revision: number }, PersistenceError>> {
    try {
      const db = await this.getDB();

      return await new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const getReq = store.get(key);

        getReq.onsuccess = () => {
          const currentRecord = getReq.result as StorageRecord | undefined;
          const currentRevision = currentRecord ? currentRecord.revision : 0;

          // Verificação de concorrência estrita (IO-03)
          if (
            options.expectedRevision !== undefined &&
            currentRevision !== options.expectedRevision
          ) {
            resolve(
              err(
                'CONFLICT',
                `Storage conflict: expected revision ${options.expectedRevision}, but storage is at revision ${currentRevision}.`,
                { details: { expected: options.expectedRevision, actual: currentRevision } },
              ),
            );
            return;
          }

          const nextRevision = currentRevision + 1;
          const recordToSave: StorageRecord = {
            key,
            document,
            revision: nextRevision,
            updatedAt: Date.now(),
          };

          const putReq = store.put(recordToSave);
          putReq.onsuccess = () => {
            resolve(ok({ revision: nextRevision }));
          };
          putReq.onerror = () => {
            const domErr = putReq.error;
            if (
              domErr &&
              (domErr.name === 'QuotaExceededError' || domErr.name === 'QuotaExceeded')
            ) {
              resolve(
                err('QUOTA_EXCEEDED', 'IndexedDB storage quota exceeded.', { details: domErr }),
              );
            } else {
              resolve(
                err('STORAGE_UNAVAILABLE', 'Failed to write document to IndexedDB.', {
                  details: domErr,
                }),
              );
            }
          };
        };

        getReq.onerror = () => {
          resolve(
            err('STORAGE_UNAVAILABLE', 'Failed to inspect document in IndexedDB.', {
              details: getReq.error,
            }),
          );
        };

        tx.onerror = () => {
          const domErr = tx.error;
          if (domErr && (domErr.name === 'QuotaExceededError' || domErr.name === 'QuotaExceeded')) {
            resolve(
              err('QUOTA_EXCEEDED', 'IndexedDB storage quota exceeded on transaction.', {
                details: domErr,
              }),
            );
          }
        };
      });
    } catch (error) {
      return err('STORAGE_UNAVAILABLE', 'IndexedDB is unavailable.', { details: error });
    }
  }

  async delete(key: string): Promise<Result<void, PersistenceError>> {
    try {
      const db = await this.getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.delete(key);

        req.onsuccess = () => resolve(ok(undefined));
        req.onerror = () =>
          resolve(
            err('STORAGE_UNAVAILABLE', 'Failed to delete document from IndexedDB.', {
              details: req.error,
            }),
          );
      });
    } catch (error) {
      return err('STORAGE_UNAVAILABLE', 'IndexedDB is unavailable.', { details: error });
    }
  }
}

/**
 * Adaptador de armazenamento em memória para testes e sessões efêmeras.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, StorageRecord>();

  async load(
    key: string,
  ): Promise<Result<{ document: CanvasDocument; revision: number }, PersistenceError>> {
    const record = this.store.get(key);
    if (!record) {
      return err('INVALID_DOCUMENT', `Document with key "${key}" not found.`);
    }
    const parsed = parseDocument(record.document);
    if (!parsed.ok) return parsed;
    return ok({ document: parsed.value, revision: record.revision });
  }

  async save(
    key: string,
    document: CanvasDocument,
    options: SaveOptions = {},
  ): Promise<Result<{ revision: number }, PersistenceError>> {
    const current = this.store.get(key);
    const currentRevision = current ? current.revision : 0;

    if (options.expectedRevision !== undefined && currentRevision !== options.expectedRevision) {
      return err(
        'CONFLICT',
        `Storage conflict: expected revision ${options.expectedRevision}, but current is ${currentRevision}.`,
      );
    }

    const nextRevision = currentRevision + 1;
    this.store.set(key, {
      key,
      document,
      revision: nextRevision,
      updatedAt: Date.now(),
    });

    return ok({ revision: nextRevision });
  }

  async delete(key: string): Promise<Result<void, PersistenceError>> {
    this.store.delete(key);
    return ok(undefined);
  }
}
