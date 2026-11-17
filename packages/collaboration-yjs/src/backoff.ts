import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
} from '@canvash/collaboration';

export interface BackoffOptions {
  /** Teto da primeira espera, em ms. Padrão 500. */
  readonly initialMs?: number;
  /** Teto de qualquer espera, em ms. Padrão 30 000. */
  readonly maxMs?: number;
  /** Quanto o teto cresce a cada tentativa. Padrão 2. */
  readonly factor?: number;
}

export type ResolvedBackoff = Required<BackoffOptions>;

export const DEFAULT_BACKOFF: ResolvedBackoff = { initialMs: 500, maxMs: 30_000, factor: 2 };

function invalid(field: keyof BackoffOptions): Result<never, CollaborationError> {
  return err(
    createCollaborationError('CONNECTION_FAILED', `Opção de backoff inválida: ${field}`, {
      reason: 'invalid_backoff',
      field,
    }),
  );
}

/** Completa as opções com os padrões e recusa, sem lançar, o que não é um número utilizável. */
export function resolveBackoff(
  options: BackoffOptions = {},
): Result<ResolvedBackoff, CollaborationError> {
  const resolved: ResolvedBackoff = { ...DEFAULT_BACKOFF, ...options };
  if (!Number.isFinite(resolved.initialMs) || resolved.initialMs <= 0) return invalid('initialMs');
  if (!Number.isFinite(resolved.maxMs) || resolved.maxMs < resolved.initialMs) {
    return invalid('maxMs');
  }
  if (!Number.isFinite(resolved.factor) || resolved.factor < 1) return invalid('factor');
  return ok(resolved);
}

/**
 * Espera antes da tentativa `attempt` (a primeira é 0): um ponto sorteado entre zero e
 * `min(maxMs, initialMs × factor^attempt)`. É o jitter completo: clientes que caíram juntos não
 * voltam juntos. `random` devolve um número em [0, 1].
 */
export function backoffDelay(
  attempt: number,
  options: ResolvedBackoff,
  random: () => number,
): number {
  const grown = options.initialMs * Math.pow(options.factor, Math.max(0, attempt));
  const ceiling = Math.floor(
    Number.isFinite(grown) ? Math.min(options.maxMs, grown) : options.maxMs,
  );
  return Math.min(ceiling, Math.floor(random() * (ceiling + 1)));
}
