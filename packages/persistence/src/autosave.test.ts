import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectTypeOf } from 'vitest';
import { createAutosaveManager } from './autosave.js';
import { MemoryStorageAdapter } from './storage.js';

describe('AutosaveManager (IO-03, IO-04)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recebe a instância do canvas como primeiro parâmetro', () => {
    expectTypeOf<Parameters<typeof createAutosaveManager>[0]>().toEqualTypeOf<CanvasSectionApi>();
  });

  it('salva com debounce após mutações no documento', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');

    const statuses: string[] = [];
    const manager = createAutosaveManager(section, adapter, {
      key: 'test-doc',
      debounceMs: 500,
      onStatusChange: (s) => statuses.push(s),
    });

    expect(manager.status).toBe('idle');

    // Mutação 1
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    // Antes do debounce expirar, não deve ter chamado save
    expect(saveSpy).not.toHaveBeenCalled();

    // Avança 200 ms e faz mutação 2 (reinicia debounce)
    vi.advanceTimersByTime(200);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 20, y: 20, width: 10, height: 10, rotation: 0 },
    });

    // Avança 499 ms (ainda dentro do novo debounce)
    vi.advanceTimersByTime(499);
    expect(saveSpy).not.toHaveBeenCalled();

    // Avança mais 2 ms (passou de 500 ms)
    await vi.advanceTimersByTimeAsync(2);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(manager.lastSavedRevision).toBe(2);
    expect(statuses).toContain('saving');
    expect(statuses).toContain('saved');

    manager.destroy();
  });

  it('flush() força gravação imediata sem esperar debounce', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');

    const manager = createAutosaveManager(section, adapter, {
      key: 'flush-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    expect(saveSpy).not.toHaveBeenCalled();

    const flushResult = await manager.flush();
    expect(flushResult.ok).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(manager.lastSavedRevision).toBe(1);

    manager.destroy();
  });

  it('preserva integridade e notifica erro se o adapter falhar (IO-04)', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();

    // Força erro de quota
    vi.spyOn(adapter, 'save').mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: 'Disk quota exceeded' },
    });

    let reportedError: unknown = null;
    const manager = createAutosaveManager(section, adapter, {
      key: 'error-doc',
      debounceMs: 500,
      onError: (err) => {
        reportedError = err;
      },
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's-fail', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    await vi.advanceTimersByTimeAsync(550);

    expect(manager.status).toBe('error');
    expect(reportedError).not.toBeNull();
    // O documento em memória no canvas permanece 100% íntegro e funcional (IO-04)
    expect(section.getSnapshot().document.nodes['s-fail']).toBeDefined();

    manager.destroy();
  });

  it('ignora eventos que não afetam a área "document"', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');

    const manager = createAutosaveManager(section, adapter, {
      key: 'viewport-doc',
      debounceMs: 500,
    });

    // Mudança de ferramenta não altera documento
    section.setTool('rectangle');
    await vi.advanceTimersByTimeAsync(600);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(manager.status).toBe('idle');
    manager.destroy();
  });

  it('encadeia novas mutações ocorridas durante uma gravação em voo', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();

    let resolveSave: ((val: { ok: true; value: { revision: number } }) => void) | null = null;
    let saveCount = 0;

    vi.spyOn(adapter, 'save').mockImplementation(async () => {
      saveCount++;
      if (saveCount === 1) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return { ok: true, value: { revision: 2 } };
    });

    const manager = createAutosaveManager(section, adapter, {
      key: 'inflight-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(saveCount).toBe(1);
    expect(manager.status).toBe('saving');

    // Mutação enquanto saveCount === 1 está em voo
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 20, y: 20, width: 10, height: 10, rotation: 0 },
    });

    // Libera a primeira gravação
    resolveSave!({ ok: true, value: { revision: 1 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // A segunda gravação deve ter sido disparada e concluída
    expect(saveCount).toBe(2);
    expect(manager.status).toBe('saved');
    manager.destroy();
  });

  it('re-agenda salvamento se nova mutação ocorrer durante uma falha', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();

    let resolveSave:
      | ((val: { ok: false; error: { code: 'STORAGE_UNAVAILABLE'; message: string } }) => void)
      | null = null;
    let saveCount = 0;

    vi.spyOn(adapter, 'save').mockImplementation(async () => {
      saveCount++;
      if (saveCount === 1) {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return { ok: true, value: { revision: 2 } };
    });

    const manager = createAutosaveManager(section, adapter, {
      key: 'fail-retry-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(saveCount).toBe(1);

    // Mutação enquanto save está em voo
    section.dispatch({
      type: 'shape.create',
      shape: { id: 's2', type: 'rectangle', x: 20, y: 20, width: 10, height: 10, rotation: 0 },
    });

    // Falha o primeiro save
    resolveSave!({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'Fail 1' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.status).toBe('error');

    // O agendamento deve rodar após o debounce
    await vi.advanceTimersByTimeAsync(500);
    expect(saveCount).toBe(2);
    manager.destroy();
  });

  it('flush() aguarda salvamento em andamento e lida com erro', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();

    let resolveSave:
      | ((val: { ok: false; error: { code: 'STORAGE_UNAVAILABLE'; message: string } }) => void)
      | null = null;

    vi.spyOn(adapter, 'save').mockImplementation(async () => {
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    });

    const manager = createAutosaveManager(section, adapter, {
      key: 'flush-error-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(manager.status).toBe('saving');

    // Dispara flush enquanto saving está ativo
    const flushPromise = manager.flush();

    // Resolve save com erro
    resolveSave!({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage error' } });
    await vi.advanceTimersByTimeAsync(50);

    const flushRes = await flushPromise;
    expect(flushRes.ok).toBe(false);
    manager.destroy();
  });

  it('respeita destroy() e não executa gravações pendentes nem pós-destruição', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');

    const manager = createAutosaveManager(section, adapter, {
      key: 'destroy-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    manager.destroy();
    await vi.advanceTimersByTimeAsync(600);
    expect(saveSpy).not.toHaveBeenCalled();

    const flushRes = await manager.flush();
    expect(flushRes.ok).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('flush() subsequente sem novas mutações retorna ok imediatamente sem salvar novamente', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');

    const manager = createAutosaveManager(section, adapter, {
      key: 'flush-idempotent-doc',
      debounceMs: 500,
    });

    section.dispatch({
      type: 'shape.create',
      shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });

    await manager.flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // Segundo flush sem mudanças
    const flush2 = await manager.flush();
    expect(flush2.ok).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  describe('adapter que lança ou rejeita', () => {
    const closedDbError = () =>
      new DOMException(
        "IDBDatabase.transaction: Can't start a transaction on a closed database",
        'InvalidStateError',
      );

    it('converte a rejeição do save do timer em status de erro e onError', async () => {
      const section = createCanvasSection();
      const adapter = new MemoryStorageAdapter();
      const failure = closedDbError();
      vi.spyOn(adapter, 'save').mockRejectedValueOnce(failure);
      const onError = vi.fn();

      const manager = createAutosaveManager(section, adapter, {
        key: 'reject-doc',
        debounceMs: 500,
        onError,
      });

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      await vi.advanceTimersByTimeAsync(550);

      expect(manager.status).toBe('error');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'STORAGE_UNAVAILABLE', details: failure }),
      );
      manager.destroy();
    });

    it('volta a salvar depois de uma exceção síncrona do adapter', async () => {
      const section = createCanvasSection();
      const adapter = new MemoryStorageAdapter();
      const saveSpy = vi.spyOn(adapter, 'save').mockImplementationOnce(() => {
        throw closedDbError();
      });

      const manager = createAutosaveManager(section, adapter, {
        key: 'recover-doc',
        debounceMs: 500,
      });

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      await vi.advanceTimersByTimeAsync(550);
      expect(manager.status).toBe('error');

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's2', type: 'rectangle', x: 20, y: 20, width: 10, height: 10, rotation: 0 },
      });
      await vi.advanceTimersByTimeAsync(550);

      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(manager.status).toBe('saved');
      expect(manager.lastSavedRevision).toBe(2);
      manager.destroy();
    });

    it('flush() devolve erro em vez de rejeitar quando o adapter rejeita', async () => {
      const section = createCanvasSection();
      const adapter = new MemoryStorageAdapter();
      vi.spyOn(adapter, 'save').mockRejectedValueOnce(closedDbError());

      const manager = createAutosaveManager(section, adapter, {
        key: 'flush-reject-doc',
        debounceMs: 500,
      });

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });

      const flushRes = await manager.flush();
      expect(flushRes.ok).toBe(false);
      if (flushRes.ok) return;
      expect(flushRes.error.code).toBe('STORAGE_UNAVAILABLE');
      expect(manager.status).toBe('error');
      manager.destroy();
    });

    it('flush() termina quando a gravação em voo rejeita', async () => {
      const section = createCanvasSection();
      const adapter = new MemoryStorageAdapter();
      let rejectSave: ((reason: unknown) => void) | null = null;
      vi.spyOn(adapter, 'save').mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectSave = reject;
          }),
      );

      const manager = createAutosaveManager(section, adapter, {
        key: 'flush-inflight-reject-doc',
        debounceMs: 500,
      });

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.status).toBe('saving');

      const flushPromise = manager.flush();
      rejectSave!(closedDbError());
      await vi.advanceTimersByTimeAsync(50);

      const flushRes = await flushPromise;
      expect(flushRes.ok).toBe(false);
      expect(manager.status).toBe('error');
      manager.destroy();
    }, 1000);

    it('flush() termina quando destroy() acontece com a gravação em voo', async () => {
      const section = createCanvasSection();
      const adapter = new MemoryStorageAdapter();
      let resolveSave: ((value: { ok: true; value: { revision: number } }) => void) | undefined;
      vi.spyOn(adapter, 'save').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      );

      const manager = createAutosaveManager(section, adapter, {
        key: 'flush-destroy-doc',
        debounceMs: 500,
      });

      section.dispatch({
        type: 'shape.create',
        shape: { id: 's1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(manager.status).toBe('saving');

      const flushPromise = manager.flush();
      manager.destroy();
      resolveSave?.({ ok: true, value: { revision: 1 } });
      await vi.advanceTimersByTimeAsync(50);

      const flushRes = await flushPromise;
      expect(flushRes.ok).toBe(true);
      expect(manager.status).toBe('saved');
    }, 1000);
  });
});
