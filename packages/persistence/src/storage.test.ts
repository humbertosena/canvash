import { createCanvasSection, type CanvasDocument } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { IndexedDbStorageAdapter, MemoryStorageAdapter, type StorageRecord } from './storage.js';

describe('Storage Adapters (IO-03, IO-04)', () => {
  describe('MemoryStorageAdapter', () => {
    it('salva e recupera documentos com controle de revisão', async () => {
      const adapter = new MemoryStorageAdapter();
      const section = createCanvasSection();
      const doc = section.getSnapshot().document;

      const save1 = await adapter.save('doc-1', doc);
      expect(save1.ok).toBe(true);
      if (!save1.ok) return;
      expect(save1.value.revision).toBe(1);

      const load1 = await adapter.load('doc-1');
      expect(load1.ok).toBe(true);
      if (!load1.ok) return;
      expect(load1.value.revision).toBe(1);
      expect(load1.value.document.id).toBe(doc.id);

      // Salva segunda versão especificando expectedRevision correta
      const save2 = await adapter.save('doc-1', doc, { expectedRevision: 1 });
      expect(save2.ok).toBe(true);
      if (!save2.ok) return;
      expect(save2.value.revision).toBe(2);

      // Salva com expectedRevision desatualizada -> CONFLICT (IO-03)
      const saveConflict = await adapter.save('doc-1', doc, { expectedRevision: 1 });
      expect(saveConflict.ok).toBe(false);
      if (saveConflict.ok) return;
      expect(saveConflict.error.code).toBe('CONFLICT');

      // Exclusão
      await adapter.delete('doc-1');
      const loadAfterDelete = await adapter.load('doc-1');
      expect(loadAfterDelete.ok).toBe(false);
      if (loadAfterDelete.ok) return;
      expect(loadAfterDelete.error.code).toBe('INVALID_DOCUMENT');
    });
  });

  describe('IndexedDbStorageAdapter', () => {
    it('reporta STORAGE_UNAVAILABLE em ambiente sem indexedDB global (IO-04)', async () => {
      const adapter = new IndexedDbStorageAdapter();
      const section = createCanvasSection();
      const doc = section.getSnapshot().document;

      const loadRes = await adapter.load('doc-offline');
      expect(loadRes.ok).toBe(false);
      if (loadRes.ok) return;
      expect(loadRes.error.code).toBe('STORAGE_UNAVAILABLE');

      const saveRes = await adapter.save('doc-offline', doc);
      expect(saveRes.ok).toBe(false);
      if (saveRes.ok) return;
      expect(saveRes.error.code).toBe('STORAGE_UNAVAILABLE');

      const delRes = await adapter.delete('doc-offline');
      expect(delRes.ok).toBe(false);
      if (delRes.ok) return;
      expect(delRes.error.code).toBe('STORAGE_UNAVAILABLE');
    });

    describe('com mock de IndexedDB', () => {
      let originalIndexedDB: unknown;
      const fakeRecords = new Map<string, StorageRecord>();
      let failQuotaOnPut = false;

      beforeEach(() => {
        originalIndexedDB = (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
        fakeRecords.clear();
        failQuotaOnPut = false;

        const fakeDB: unknown = {
          objectStoreNames: {
            contains: () => true,
          },
          createObjectStore: () => ({}),
          transaction: () => ({
            objectStore: () => ({
              get: (key: string) => {
                const req: {
                  result?: unknown;
                  error?: unknown;
                  onsuccess: null | (() => void);
                  onerror: null | (() => void);
                } = {
                  result: fakeRecords.get(key),
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => req.onsuccess?.());
                return req;
              },
              put: (record: StorageRecord) => {
                const req: {
                  result?: unknown;
                  error?: unknown;
                  onsuccess: null | (() => void);
                  onerror: null | (() => void);
                } = {
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => {
                  if (failQuotaOnPut) {
                    req.error = { name: 'QuotaExceededError' };
                    req.onerror?.();
                  } else {
                    fakeRecords.set(record.key, record);
                    req.onsuccess?.();
                  }
                });
                return req;
              },
              delete: (key: string) => {
                const req: {
                  result?: unknown;
                  error?: unknown;
                  onsuccess: null | (() => void);
                  onerror: null | (() => void);
                } = {
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => {
                  fakeRecords.delete(key);
                  req.onsuccess?.();
                });
                return req;
              },
            }),
          }),
        };

        (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
          open: () => {
            const req: {
              result?: unknown;
              error?: unknown;
              onupgradeneeded: null | (() => void);
              onsuccess: null | (() => void);
              onerror: null | (() => void);
            } = {
              result: fakeDB,
              onupgradeneeded: null,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => {
              req.onupgradeneeded?.();
              req.onsuccess?.();
            });
            return req;
          },
        };
      });

      afterEach(() => {
        (globalThis as unknown as { indexedDB: unknown }).indexedDB = originalIndexedDB;
      });

      it('salva, carrega e detecta conflitos em IndexedDB', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const section = createCanvasSection();
        const doc = section.getSnapshot().document;

        // 1. Salva documento
        const save1 = await adapter.save('doc-idb', doc);
        expect(save1.ok).toBe(true);
        if (!save1.ok) return;
        expect(save1.value.revision).toBe(1);

        // 2. Carrega documento
        const load1 = await adapter.load('doc-idb');
        expect(load1.ok).toBe(true);
        if (!load1.ok) return;
        expect(load1.value.revision).toBe(1);
        expect(load1.value.document.id).toBe(doc.id);

        // 3. Salva segunda revisão
        const save2 = await adapter.save('doc-idb', doc, { expectedRevision: 1 });
        expect(save2.ok).toBe(true);
        if (!save2.ok) return;
        expect(save2.value.revision).toBe(2);

        // 4. Conflito de concorrência com expectedRevision desatualizada
        const saveConflict = await adapter.save('doc-idb', doc, { expectedRevision: 1 });
        expect(saveConflict.ok).toBe(false);
        if (saveConflict.ok) return;
        expect(saveConflict.error.code).toBe('CONFLICT');

        // 5. Exclusão
        const delRes = await adapter.delete('doc-idb');
        expect(delRes.ok).toBe(true);

        const loadAfterDel = await adapter.load('doc-idb');
        expect(loadAfterDel.ok).toBe(false);
      });

      it('reporta QUOTA_EXCEEDED quando IndexedDB atinge limite (IO-04)', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const section = createCanvasSection();
        const doc = section.getSnapshot().document;

        failQuotaOnPut = true;
        const saveRes = await adapter.save('doc-large', doc);
        expect(saveRes.ok).toBe(false);
        if (saveRes.ok) return;
        expect(saveRes.error.code).toBe('QUOTA_EXCEEDED');
      });

      it('reporta INVALID_DOCUMENT se o registro armazenado estiver corrompido', async () => {
        const adapter = new IndexedDbStorageAdapter();
        fakeRecords.set('doc-corrupt', {
          key: 'doc-corrupt',
          document: { invalid: true } as unknown as CanvasDocument,
          revision: 1,
          updatedAt: Date.now(),
        });

        const loadRes = await adapter.load('doc-corrupt');
        expect(loadRes.ok).toBe(false);
        if (loadRes.ok) return;
        expect(loadRes.error.code).toBe('INVALID_DOCUMENT');
      });
    });

    it('reporta STORAGE_UNAVAILABLE se o open() falhar', async () => {
      const orig = (globalThis as unknown as { indexedDB: unknown }).indexedDB;
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
        open: () => {
          const req: {
            result?: unknown;
            error?: unknown;
            onsuccess: null | (() => void);
            onerror: null | (() => void);
          } = {
            onsuccess: null,
            onerror: null,
            error: new Error('Permission denied to open IDB'),
          };
          queueMicrotask(() => req.onerror?.());
          return req;
        },
      };

      try {
        const adapter = new IndexedDbStorageAdapter();
        const loadRes = await adapter.load('fail-key');
        expect(loadRes.ok).toBe(false);
        if (loadRes.ok) return;
        expect(loadRes.error.code).toBe('STORAGE_UNAVAILABLE');
      } finally {
        (globalThis as unknown as { indexedDB: unknown }).indexedDB = orig;
      }
    });

    describe('com conexão IndexedDB fechada pelo navegador', () => {
      interface FakeRequest {
        result?: unknown;
        error?: unknown;
        onupgradeneeded?: null | (() => void);
        onsuccess: null | (() => void);
        onerror: null | (() => void);
      }

      interface FakeConnection {
        closed: boolean;
        close: ReturnType<typeof vi.fn>;
        onclose: null | (() => void);
        onversionchange: null | (() => void);
        objectStoreNames: { contains: () => boolean };
        createObjectStore: () => unknown;
        transaction: () => unknown;
      }

      let originalIndexedDB: unknown;
      let connections: FakeConnection[];
      let records: Map<string, StorageRecord>;
      let open: ReturnType<typeof vi.fn>;

      const succeed = (result?: unknown): FakeRequest => {
        const req: FakeRequest = { result, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      };

      const createConnection = (): FakeConnection => {
        const connection: FakeConnection = {
          closed: false,
          close: vi.fn(() => {
            connection.closed = true;
          }),
          onclose: null,
          onversionchange: null,
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          transaction: () => {
            if (connection.closed) {
              throw new DOMException(
                "IDBDatabase.transaction: Can't start a transaction on a closed database",
                'InvalidStateError',
              );
            }
            return {
              objectStore: () => ({
                get: (key: string) => succeed(records.get(key)),
                put: (record: StorageRecord) => {
                  records.set(record.key, record);
                  return succeed();
                },
                delete: (key: string) => {
                  records.delete(key);
                  return succeed();
                },
              }),
            };
          },
        };
        return connection;
      };

      beforeEach(() => {
        originalIndexedDB = (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
        connections = [];
        records = new Map<string, StorageRecord>();
        open = vi.fn(() => {
          const connection = createConnection();
          connections.push(connection);
          return succeed(connection);
        });
        (globalThis as unknown as { indexedDB: unknown }).indexedDB = { open };
      });

      afterEach(() => {
        (globalThis as unknown as { indexedDB: unknown }).indexedDB = originalIndexedDB;
      });

      it('devolve STORAGE_UNAVAILABLE sem rejeitar quando transaction() lança InvalidStateError', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const doc = createCanvasSection().getSnapshot().document;

        const first = await adapter.save('doc-closed', doc);
        expect(first.ok).toBe(true);
        // Fecha a conexão sem disparar onclose, como no descarte da página.
        connections[0]!.closed = true;

        const saveRes = await adapter.save('doc-closed', doc);
        expect(saveRes.ok).toBe(false);
        if (saveRes.ok) return;
        expect(saveRes.error.code).toBe('STORAGE_UNAVAILABLE');
        expect(saveRes.error.details).toBeInstanceOf(DOMException);
        expect((saveRes.error.details as DOMException).name).toBe('InvalidStateError');

        const loadRes = await adapter.load('doc-closed');
        expect(loadRes.ok).toBe(false);
        if (loadRes.ok) return;
        expect(loadRes.error.code).toBe('STORAGE_UNAVAILABLE');

        const delRes = await adapter.delete('doc-closed');
        expect(delRes.ok).toBe(false);
        if (delRes.ok) return;
        expect(delRes.error.code).toBe('STORAGE_UNAVAILABLE');
      });

      it('reabre o banco depois do evento close da conexão', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const doc = createCanvasSection().getSnapshot().document;

        expect((await adapter.save('doc-reopen', doc)).ok).toBe(true);
        expect(open).toHaveBeenCalledTimes(1);

        connections[0]!.closed = true;
        connections[0]!.onclose?.();

        const saveRes = await adapter.save('doc-reopen', doc);
        expect(saveRes.ok).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      });

      it('fecha a conexão no versionchange e reabre na próxima operação', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const doc = createCanvasSection().getSnapshot().document;

        expect((await adapter.save('doc-version', doc)).ok).toBe(true);
        connections[0]!.onversionchange?.();
        expect(connections[0]!.close).toHaveBeenCalledTimes(1);

        const loadRes = await adapter.load('doc-version');
        expect(open).toHaveBeenCalledTimes(2);
        expect(loadRes.ok).toBe(true);
        if (!loadRes.ok) return;
        expect(loadRes.value.revision).toBe(1);

        // Um close tardio da conexão antiga não descarta a conexão nova.
        connections[0]!.onclose?.();
        expect((await adapter.save('doc-version', doc)).ok).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      });

      it('tenta abrir de novo depois de uma falha do open()', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const doc = createCanvasSection().getSnapshot().document;
        open.mockImplementationOnce(() => {
          const req: FakeRequest = {
            error: new DOMException('Falha ao abrir o banco.', 'UnknownError'),
            onsuccess: null,
            onerror: null,
          };
          queueMicrotask(() => req.onerror?.());
          return req;
        });

        const failed = await adapter.save('doc-retry', doc);
        expect(failed.ok).toBe(false);
        if (failed.ok) return;
        expect(failed.error.code).toBe('STORAGE_UNAVAILABLE');

        expect((await adapter.save('doc-retry', doc)).ok).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      });

      it('tenta abrir de novo depois de um throw síncrono do open()', async () => {
        const adapter = new IndexedDbStorageAdapter();
        const doc = createCanvasSection().getSnapshot().document;
        open.mockImplementationOnce(() => {
          throw new DOMException('Acesso ao IndexedDB negado.', 'SecurityError');
        });

        const failed = await adapter.load('doc-security');
        expect(failed.ok).toBe(false);
        if (failed.ok) return;
        expect(failed.error.code).toBe('STORAGE_UNAVAILABLE');
        expect((failed.error.details as DOMException).name).toBe('SecurityError');

        expect((await adapter.save('doc-security', doc)).ok).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      });
    });
  });
});
