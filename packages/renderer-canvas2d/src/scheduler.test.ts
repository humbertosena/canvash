import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { RafCallback, Scheduler } from './scheduler.js';
import { createScheduler } from './scheduler.js';

describe('createScheduler', () => {
  it('respeita o contrato estrito de tipos', () => {
    const scheduler = createScheduler({ onPaint: () => {} });
    expectTypeOf(scheduler).toMatchTypeOf<Scheduler>();
    expectTypeOf(scheduler.invalidate).toEqualTypeOf<() => void>();
    expectTypeOf(scheduler.flush).toEqualTypeOf<() => void>();
    expectTypeOf(scheduler.getPaintCount).toEqualTypeOf<() => number>();
    expectTypeOf(scheduler.isPending).toEqualTypeOf<() => boolean>();
    expectTypeOf(scheduler.destroy).toEqualTypeOf<() => void>();
    scheduler.destroy();
  });

  it('em repouso inicial não agenda nenhum frame nem executa pintura', () => {
    const onPaint = vi.fn();
    const raf = vi.fn();
    const caf = vi.fn();

    const scheduler = createScheduler({
      onPaint,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
    });

    expect(scheduler.getPaintCount()).toBe(0);
    expect(scheduler.isPending()).toBe(false);
    expect(raf).not.toHaveBeenCalled();
    expect(onPaint).not.toHaveBeenCalled();
    expect(caf).not.toHaveBeenCalled();

    scheduler.destroy();
  });

  it('coalesce múltiplas invalidações no mesmo frame em uma única pintura (RENDER-04)', () => {
    let pendingCallback: RafCallback | null = null;
    let nextHandle = 1;
    const rafCalls: number[] = [];

    const raf = vi.fn((cb: RafCallback): number => {
      pendingCallback = cb;
      const handle = nextHandle++;
      rafCalls.push(handle);
      return handle;
    });
    const onPaint = vi.fn();

    const scheduler = createScheduler({
      onPaint,
      requestAnimationFrame: raf,
    });

    expect(scheduler.isPending()).toBe(false);

    // 10 invalidações simultâneas no mesmo ciclo
    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.invalidate();

    expect(scheduler.isPending()).toBe(true);
    // Apenas 1 requestAnimationFrame deve ter sido solicitado
    expect(raf).toHaveBeenCalledTimes(1);
    expect(onPaint).not.toHaveBeenCalled();
    expect(scheduler.getPaintCount()).toBe(0);

    // O frame do navegador dispara o callback
    expect(pendingCallback).not.toBeNull();
    pendingCallback!(16.6);

    // Agora a pintura ocorreu exatamente uma vez
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(scheduler.getPaintCount()).toBe(1);
    expect(scheduler.isPending()).toBe(false);

    // Em repouso: nenhum novo frame é agendado
    expect(raf).toHaveBeenCalledTimes(1);

    scheduler.destroy();
  });

  it('permite novos agendamentos após o frame anterior estabilizar', () => {
    let pendingCallback: RafCallback | null = null;
    let nextHandle = 1;

    const raf = vi.fn((cb: RafCallback): number => {
      pendingCallback = cb;
      return nextHandle++;
    });
    const onPaint = vi.fn();

    const scheduler = createScheduler({
      onPaint,
      requestAnimationFrame: raf,
    });

    // Frame 1
    scheduler.invalidate();
    expect(raf).toHaveBeenCalledTimes(1);
    pendingCallback!(16.6);
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(scheduler.getPaintCount()).toBe(1);

    // Frame 2
    scheduler.invalidate();
    expect(raf).toHaveBeenCalledTimes(2);
    pendingCallback!(33.3);
    expect(onPaint).toHaveBeenCalledTimes(2);
    expect(scheduler.getPaintCount()).toBe(2);

    scheduler.destroy();
  });

  it('flush executa a pintura imediatamente e cancela o frame pendente', () => {
    let nextHandle = 100;
    const cancelledHandles: number[] = [];
    const caf = vi.fn((handle: number) => cancelledHandles.push(handle));
    const raf = vi.fn(() => nextHandle++);
    const onPaint = vi.fn();

    const scheduler = createScheduler({
      onPaint,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
    });

    scheduler.invalidate();
    expect(scheduler.isPending()).toBe(true);

    scheduler.flush();
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(scheduler.getPaintCount()).toBe(1);
    expect(scheduler.isPending()).toBe(false);
    expect(caf).toHaveBeenCalledWith(100);

    // Flush sem frame pendente executa pintura direta
    scheduler.flush();
    expect(onPaint).toHaveBeenCalledTimes(2);
    expect(scheduler.getPaintCount()).toBe(2);

    scheduler.destroy();
  });

  it('destroy cancela o frame pendente e neutraliza agendamentos futuros', () => {
    let pendingCallback: RafCallback | null = null;
    const caf = vi.fn();
    const raf = vi.fn((cb: RafCallback): number => {
      pendingCallback = cb;
      return 42;
    });
    const onPaint = vi.fn();

    const scheduler = createScheduler({
      onPaint,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
    });

    scheduler.invalidate();
    expect(scheduler.isPending()).toBe(true);

    scheduler.destroy();
    expect(caf).toHaveBeenCalledWith(42);
    expect(scheduler.isPending()).toBe(false);

    // Se o callback antigo for disparado por engano pelo motor, não deve pintar
    if (pendingCallback) {
      (pendingCallback as RafCallback)(50.0);
    }
    expect(onPaint).not.toHaveBeenCalled();

    // Novas invalidações ou flushes após destroy são ignoradas
    scheduler.invalidate();
    scheduler.flush();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(onPaint).not.toHaveBeenCalled();
    expect(scheduler.getPaintCount()).toBe(0);

    // Chamadas repetidas a destroy são idempotentes
    expect(() => scheduler.destroy()).not.toThrow();
  });
});
