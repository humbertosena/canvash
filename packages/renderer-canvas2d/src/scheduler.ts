export type RafCallback = (timestamp: number) => void;
export type RequestAnimationFrameFn = (callback: RafCallback) => number;
export type CancelAnimationFrameFn = (handle: number) => void;

/** Opções de configuração do scheduler de pintura. */
export interface SchedulerOptions {
  /** Função de pintura a ser executada no frame de animação. */
  readonly onPaint: () => void;
  /** Injeção opcional de requestAnimationFrame para testes e portabilidade. */
  readonly requestAnimationFrame?: RequestAnimationFrameFn | undefined;
  /** Injeção opcional de cancelAnimationFrame para testes e portabilidade. */
  readonly cancelAnimationFrame?: CancelAnimationFrameFn | undefined;
}

/** Controlador de agendamento e coalescência de pinturas. */
export interface Scheduler {
  /** Agenda uma pintura no próximo frame se ainda não houver um callback pendente (coalescência). */
  readonly invalidate: () => void;
  /** Executa imediatamente a pintura pendente (se houver) ou força uma pintura síncrona. */
  readonly flush: () => void;
  /** Retorna a contagem acumulada de pinturas realizadas. */
  readonly getPaintCount: () => number;
  /** Informa se há uma pintura agendada aguardando o próximo frame. */
  readonly isPending: () => boolean;
  /** Cancela frames pendentes e neutraliza agendamentos futuros. */
  readonly destroy: () => void;
}

/**
 * Cria um scheduler para sincronizar a renderização com os frames de animação do navegador (RENDER-04).
 *
 * Características:
 * - No máximo um callback de animação pendente por ciclo;
 * - Múltiplas chamadas a `invalidate()` no mesmo frame resultam em exatamente uma pintura;
 * - Em repouso não mantém loop ativo (zero chamadas a requestAnimationFrame);
 * - Métrica estrita de contagem de pinturas para testes e diagnósticos.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  let isDisposed = false;
  let rafHandle: number | null = null;
  let paintCount = 0;

  const raf: RequestAnimationFrameFn =
    options.requestAnimationFrame ??
    (typeof globalThis !== 'undefined' &&
    typeof (globalThis as { requestAnimationFrame?: RequestAnimationFrameFn })
      .requestAnimationFrame === 'function'
      ? (globalThis as { requestAnimationFrame: RequestAnimationFrameFn }).requestAnimationFrame
      : (callback: RafCallback): number => {
          return setTimeout(() => callback(Date.now()), 0) as unknown as number;
        });

  const caf: CancelAnimationFrameFn =
    options.cancelAnimationFrame ??
    (typeof globalThis !== 'undefined' &&
    typeof (globalThis as { cancelAnimationFrame?: CancelAnimationFrameFn })
      .cancelAnimationFrame === 'function'
      ? (globalThis as { cancelAnimationFrame: CancelAnimationFrameFn }).cancelAnimationFrame
      : (handle: number): void => {
          clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        });

  const executePaint = (): void => {
    rafHandle = null;
    if (isDisposed) {
      return;
    }
    paintCount += 1;
    options.onPaint();
  };

  const invalidate = (): void => {
    if (isDisposed || rafHandle !== null) {
      return;
    }
    rafHandle = raf(() => {
      executePaint();
    });
  };

  const flush = (): void => {
    if (isDisposed) {
      return;
    }
    if (rafHandle !== null) {
      caf(rafHandle);
      rafHandle = null;
    }
    executePaint();
  };

  const destroy = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    if (rafHandle !== null) {
      caf(rafHandle);
      rafHandle = null;
    }
  };

  return {
    invalidate,
    flush,
    getPaintCount: () => paintCount,
    isPending: () => rafHandle !== null,
    destroy,
  };
}
