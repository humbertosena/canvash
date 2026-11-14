import { expect, test, type Page } from '@playwright/test';

type ResultSuccess<T> = { ok: true; value: T };
type ResultFailure<E> = { ok: false; error: E };
type Result<T, E> = ResultSuccess<T> | ResultFailure<E>;

interface PersistenceErrorLike {
  code: string;
  message: string;
}

interface CanvasSectionLike {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  getSnapshot: () => { document: unknown; session: unknown };
  replaceDocument: (doc: unknown) => void;
  [key: string]: unknown;
}

interface AutosaveManagerLike {
  flush: () => Promise<Result<void, PersistenceErrorLike>>;
  destroy: () => void;
  [key: string]: unknown;
}

interface StorageAdapterLike {
  load: (
    key: string,
  ) => Promise<Result<{ document: unknown; revision: number }, PersistenceErrorLike>>;
  save: (
    key: string,
    document: unknown,
    options?: { expectedRevision?: number },
  ) => Promise<Result<{ revision: number }, PersistenceErrorLike>>;
  [key: string]: unknown;
}

interface CanvashWindow {
  __CANVASH_CORE__: {
    createCanvasSection: (...args: unknown[]) => CanvasSectionLike;
    [key: string]: unknown;
  };
  __CANVASH_PERSISTENCE__: {
    IndexedDbStorageAdapter: new (...args: unknown[]) => StorageAdapterLike;
    createAutosaveManager: (
      section: CanvasSectionLike,
      adapter: StorageAdapterLike,
      options: { key: string; debounceMs?: number; [key: string]: unknown },
    ) => AutosaveManagerLike;
    serializeDocument: (...args: unknown[]) => string;
    parseDocument: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  };
}

async function waitForGlobals(page: Page) {
  await page.waitForFunction(() => {
    const win = window as unknown as Partial<CanvashWindow>;
    return win.__CANVASH_CORE__ !== undefined && win.__CANVASH_PERSISTENCE__ !== undefined;
  });
}

test.describe('Persistência e Autosave E2E (IO-03, IO-04)', () => {
  test('concorrência entre abas e controle de revisão em IndexedDB real (IO-03)', async ({
    context,
  }) => {
    // Cria duas abas no mesmo contexto compartilhando o mesmo IndexedDB de origem
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/?layout=classic');
    await page2.goto('/?layout=classic');

    await waitForGlobals(page1);
    await waitForGlobals(page2);

    // Inicializa e salva documento na aba 1
    const saveResult1 = await page1.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { IndexedDbStorageAdapter } = win.__CANVASH_PERSISTENCE__;

      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_concurrency' });
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, rotation: 0 },
      });

      const doc = section.getSnapshot().document;
      const saveRes = await adapter.save('doc-concurrent', doc);
      return saveRes;
    });

    expect(saveResult1.ok).toBe(true);
    if (!saveResult1.ok) return;
    expect(saveResult1.value.revision).toBe(1);

    // Aba 2 carrega o documento salvo
    const loadResult2 = await page2.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { IndexedDbStorageAdapter } = win.__CANVASH_PERSISTENCE__;
      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_concurrency' });
      return await adapter.load('doc-concurrent');
    });

    expect(loadResult2.ok).toBe(true);
    if (!loadResult2.ok) return;
    expect(loadResult2.value.revision).toBe(1);

    // Aba 1 avança para revisão 2 (salvando com expectedRevision: 1)
    const saveResult2 = await page1.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { IndexedDbStorageAdapter } = win.__CANVASH_PERSISTENCE__;
      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_concurrency' });
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's2', type: 'rectangle', x: 100, y: 100, width: 50, height: 50, rotation: 0 },
      });
      return await adapter.save('doc-concurrent', section.getSnapshot().document, {
        expectedRevision: 1,
      });
    });

    expect(saveResult2.ok).toBe(true);
    if (!saveResult2.ok) return;
    expect(saveResult2.value.revision).toBe(2);

    // Aba 2 tenta salvar esperando revisão 1 -> CONFLITO detectado sem sobrescrita silenciosa (IO-03)
    const conflictResult = await page2.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { IndexedDbStorageAdapter } = win.__CANVASH_PERSISTENCE__;
      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_concurrency' });
      const section = createCanvasSection();
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's3', type: 'rectangle', x: 200, y: 200, width: 50, height: 50, rotation: 0 },
      });
      return await adapter.save('doc-concurrent', section.getSnapshot().document, {
        expectedRevision: 1,
      });
    });

    expect(conflictResult.ok).toBe(false);
    if (conflictResult.ok) return;
    expect(conflictResult.error.code).toBe('CONFLICT');

    // Aba 2 recarrega o estado atualizado (revisão 2) e aplica sua alteração em expectedRevision: 2
    const resolveConflict = await page2.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { IndexedDbStorageAdapter } = win.__CANVASH_PERSISTENCE__;
      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_concurrency' });

      const latest = await adapter.load('doc-concurrent');
      if (!latest.ok) return latest;

      const section = createCanvasSection();
      section.replaceDocument(latest.value.document);
      section.dispatch({
        type: 'shape.create',
        shape: { id: 's3', type: 'rectangle', x: 200, y: 200, width: 50, height: 50, rotation: 0 },
      });

      return await adapter.save('doc-concurrent', section.getSnapshot().document, {
        expectedRevision: latest.value.revision,
      });
    });

    expect(resolveConflict.ok).toBe(true);
    if (!resolveConflict.ok) return;
    expect(resolveConflict.value.revision).toBe(3);
  });

  test('autosave com debounce e flush em navegador real', async ({ page }) => {
    await page.goto('/?layout=classic');
    await waitForGlobals(page);

    const autosaveCheck = await page.evaluate(async () => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { IndexedDbStorageAdapter, createAutosaveManager } = win.__CANVASH_PERSISTENCE__;

      const adapter = new IndexedDbStorageAdapter({ dbName: 'e2e_db_autosave' });
      const section = createCanvasSection();
      const statuses: string[] = [];

      const manager = createAutosaveManager(section, adapter, {
        key: 'autosave-real',
        debounceMs: 150,
        onStatusChange: (s: string) => statuses.push(s),
      });

      // Dispara alteração
      section.dispatch({
        type: 'shape.create',
        shape: { id: 'auto-1', type: 'rectangle', x: 5, y: 5, width: 20, height: 20, rotation: 0 },
      });

      // Aguarda o autosave gravar: debounce de 150 ms e depois o IndexedDB, que no runner lento pode
      // passar de um tempo fixo. O limite de 5 s fica abaixo do timeout do teste.
      const deadline = Date.now() + 5000;
      while (manager.status !== 'saved' && manager.status !== 'error' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }

      const afterDebounceStatus = manager.status;
      const lastSavedRev = manager.lastSavedRevision;

      // Força nova mutação e executa flush imediato
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'auto-2',
          type: 'rectangle',
          x: 40,
          y: 40,
          width: 20,
          height: 20,
          rotation: 0,
        },
      });

      const flushResult = await manager.flush();
      const finalRev = manager.lastSavedRevision;
      manager.destroy();

      return {
        statuses,
        afterDebounceStatus,
        lastSavedRev,
        flushSuccess: flushResult.ok,
        finalRev,
      };
    });

    expect(autosaveCheck.statuses).toContain('saving');
    expect(autosaveCheck.statuses).toContain('saved');
    expect(autosaveCheck.afterDebounceStatus).toBe('saved');
    expect(autosaveCheck.lastSavedRev).toBe(1);
    expect(autosaveCheck.flushSuccess).toBe(true);
    expect(autosaveCheck.finalRev).toBe(2);
  });
});
