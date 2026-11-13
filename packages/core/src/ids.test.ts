import { describe, expect, it } from 'vitest';
import { createIdGenerator } from './ids.js';

/** Fonte "aleatória" determinística: devolve os valores dados em ciclo. */
function cycle(...values: number[]): () => number {
  let next = 0;
  return () => values[next++ % values.length] ?? 0;
}

function take(generate: () => string, count: number): string[] {
  return Array.from({ length: count }, () => generate());
}

describe('createIdGenerator', () => {
  it('gera strings não vazias', () => {
    const generate = createIdGenerator(() => 1_700_000_000_000, Math.random);

    for (const id of take(generate, 20)) {
      expect(id).toEqual(expect.any(String));
      expect(id).not.toBe('');
    }
  });

  it('não repete IDs mesmo com relógio parado e fonte aleatória constante', () => {
    const generate = createIdGenerator(
      () => 0,
      () => 0,
    );

    const ids = take(generate, 2000);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('é determinístico para o mesmo relógio e a mesma fonte aleatória', () => {
    const first = createIdGenerator(() => 1234, cycle(0.1, 0.9, 0.5));
    const second = createIdGenerator(() => 1234, cycle(0.1, 0.9, 0.5));

    expect(take(second, 10)).toEqual(take(first, 10));
  });

  it('muda com o relógio', () => {
    const early = createIdGenerator(() => 1000, cycle(0.25));
    const late = createIdGenerator(() => 2000, cycle(0.25));

    expect(late()).not.toBe(early());
  });

  it('muda com a fonte aleatória, o que separa dois geradores criados no mesmo instante', () => {
    const first = createIdGenerator(() => 1000, cycle(0.25));
    const second = createIdGenerator(() => 1000, cycle(0.75));

    expect(second()).not.toBe(first());
  });

  it('lê o relógio a cada ID gerado', () => {
    let time = 1000;
    const generate = createIdGenerator(() => time, cycle(0.25));

    const before = generate();
    time = 2000;
    const after = generate();

    expect(after.slice(0, 2)).not.toBe(before.slice(0, 2));
  });

  it('compõe o ID com o instante, dois sorteios de largura fixa e o contador', () => {
    const generate = createIdGenerator(() => 1000, cycle(0, 1 - Number.EPSILON));

    // 1000 em base 36 é 'rs'; cada sorteio ocupa sempre oito dígitos.
    expect(generate()).toBe('rs00000000zzzzzzzz-1');
    expect(generate()).toBe('rs00000000zzzzzzzz-2');
  });

  it('aguenta o maior valor que a fonte aleatória pode devolver', () => {
    const generate = createIdGenerator(() => 1000, cycle(1 - Number.EPSILON));

    expect(new Set(take(generate, 50)).size).toBe(50);
  });

  it('arredonda para baixo um relógio fracionário: o ID não ganha ponto', () => {
    const whole = createIdGenerator(() => 1000, cycle(0.25));
    const fractional = createIdGenerator(() => 1000.75, cycle(0.25));

    const id = fractional();

    expect(id).toBe(whole());
    expect(id).not.toContain('.');
  });
});
