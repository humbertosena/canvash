import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF, resolveBackoff } from './backoff.js';

describe('backoff exponencial com jitter completo', () => {
  it('sem opções, vale 0,5 s a 30 s com fator 2', () => {
    const resolved = resolveBackoff();

    expect(resolved.ok && resolved.value).toEqual({ initialMs: 500, maxMs: 30_000, factor: 2 });
    expect(DEFAULT_BACKOFF).toEqual({ initialMs: 500, maxMs: 30_000, factor: 2 });
  });

  it('com o sorteio no teto, a sequência dobra até o máximo e para nele', () => {
    const delays = Array.from({ length: 9 }, (_, attempt) =>
      backoffDelay(attempt, DEFAULT_BACKOFF, () => 1),
    );

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('o sorteio escolhe um ponto entre zero e o teto da tentativa', () => {
    expect(backoffDelay(0, DEFAULT_BACKOFF, () => 0)).toBe(0);
    expect(backoffDelay(2, DEFAULT_BACKOFF, () => 0.5)).toBe(1_000);
    expect(backoffDelay(3, DEFAULT_BACKOFF, () => 0.25)).toBe(1_000);
  });

  it('sequência exata com sorteio fixo e opções próprias', () => {
    const resolved = resolveBackoff({ initialMs: 100, maxMs: 1_000, factor: 3 });
    if (!resolved.ok) throw new Error('opções recusadas');
    const draws = [0.1, 0.9, 0.5, 1, 0.3];

    const delays = draws.map((draw, attempt) => backoffDelay(attempt, resolved.value, () => draw));

    expect(delays).toEqual([10, 270, 450, 1_000, 300]);
  });

  it('tentativa enorme não estoura: fica no máximo', () => {
    expect(backoffDelay(10_000, DEFAULT_BACKOFF, () => 1)).toBe(30_000);
  });

  it.each([
    [{ initialMs: 0 }, 'initialMs'],
    [{ initialMs: -1 }, 'initialMs'],
    [{ maxMs: 0 }, 'maxMs'],
    [{ maxMs: Number.POSITIVE_INFINITY }, 'maxMs'],
    [{ factor: 0.5 }, 'factor'],
    [{ factor: Number.NaN }, 'factor'],
    [{ initialMs: 2_000, maxMs: 1_000 }, 'maxMs'],
  ])('recusa %o sem lançar', (options, field) => {
    const resolved = resolveBackoff(options);

    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.error.code).toBe('CONNECTION_FAILED');
    expect(!resolved.ok && resolved.error.details).toEqual({ reason: 'invalid_backoff', field });
  });
});
