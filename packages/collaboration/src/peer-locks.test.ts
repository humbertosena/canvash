import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lockKey, resolveLocks, type LockContender } from './peer-locks.js';

const contender = (
  sessionId: string,
  selectedAt: number | null,
  selection: string[],
): LockContender => ({ sessionId, selectedAt, selection });

describe('resolveLocks (desempate do bloqueio)', () => {
  it('um nó selecionado por uma só sessão é dela', () => {
    const locks = resolveLocks([contender('a', 10, ['n1']), contender('b', 5, ['n2'])]);

    expect(locks.get('n1')).toBe('a');
    expect(locks.get('n2')).toBe('b');
  });

  it('vence o menor selectedAt', () => {
    const locks = resolveLocks([contender('a', 20, ['n1']), contender('b', 10, ['n1'])]);

    expect(locks.get('n1')).toBe('b');
  });

  it('no empate vence o menor sessionId em ordem lexicográfica', () => {
    const locks = resolveLocks([contender('b', 10, ['n1']), contender('a', 10, ['n1'])]);

    expect(locks.get('n1')).toBe('a');
  });

  it('sem selectedAt perde para quem tem, e entre os sem selectedAt vence o menor sessionId', () => {
    expect(resolveLocks([contender('a', null, ['n1']), contender('z', 99, ['n1'])]).get('n1')).toBe(
      'z',
    );
    expect(
      resolveLocks([contender('b', null, ['n1']), contender('a', null, ['n1'])]).get('n1'),
    ).toBe('a');
  });

  it('um nó e o grupo dele disputam a mesma chave', () => {
    const groupOf = new Map([['m1', 'g1']]);
    const locks = resolveLocks([contender('a', 20, ['m1']), contender('b', 10, ['g1'])], groupOf);

    expect(lockKey('m1', groupOf)).toBe('g1');
    expect(locks.get('g1')).toBe('b');
  });

  it('seleção vazia não trava nada', () => {
    expect(resolveLocks([contender('a', 1, [])]).size).toBe(0);
  });

  it('propriedade: a ordem em que as sessões chegam não muda o vencedor (US-RL.4)', () => {
    const selection = fc.subarray(['n1', 'n2', 'n3', 'g1', 'm1'], { minLength: 0 });
    const one = (id: string) =>
      fc.record({
        sessionId: fc.constant(id),
        selectedAt: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
        selection,
      });
    const groupOf = new Map([['m1', 'g1']]);

    fc.assert(
      fc.property(
        fc.tuple(one('a'), one('b'), one('c'), one('d')),
        fc.func(fc.double({ min: 0, max: 1, noNaN: true })),
        (all, order) => {
          const shuffled = [...all].sort((x, y) => order(x.sessionId) - order(y.sessionId));
          const base = resolveLocks(all, groupOf);
          const other = resolveLocks(shuffled, groupOf);

          expect([...other.entries()].sort()).toEqual([...base.entries()].sort());
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('resolveLocks com board (US-BD.15)', () => {
  // O board `b` tem os descendentes `c`, `d` e `g` (o grupo, que também vale pelos membros).
  const descendants = new Map([['b', ['c', 'd', 'g']]]);
  const groupOf = new Map([
    ['m1', 'g'],
    ['m2', 'g'],
  ]);

  it('quem seleciona o board disputa a chave dele e as de cada descendente', () => {
    const locks = resolveLocks([contender('a', 10, ['b'])], groupOf, descendants);

    expect([...locks.entries()].sort()).toEqual([
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'a'],
      ['g', 'a'],
    ]);
  });

  it('board primeiro: quem selecionou o board antes vence o filho que o outro selecionou depois', () => {
    const locks = resolveLocks(
      [contender('a', 10, ['b']), contender('b', 20, ['c'])],
      groupOf,
      descendants,
    );

    expect(locks.get('b')).toBe('a');
    expect(locks.get('c')).toBe('a');
    expect(locks.get('d')).toBe('a');
  });

  it('filho primeiro: quem selecionou o filho antes o mantém, e o board fica com o outro', () => {
    const locks = resolveLocks(
      [contender('a', 20, ['b']), contender('b', 10, ['c'])],
      groupOf,
      descendants,
    );

    expect(locks.get('b')).toBe('a');
    expect(locks.get('c')).toBe('b');
    expect(locks.get('d')).toBe('a');
  });

  it('um membro do grupo dentro do board disputa pela chave do grupo', () => {
    const locks = resolveLocks(
      [contender('a', 20, ['b']), contender('b', 10, ['m1'])],
      groupOf,
      descendants,
    );

    expect(locks.get('g')).toBe('b');
    expect(locks.get('b')).toBe('a');
  });

  it('o empate de selectedAt entre o board e o filho decide pelo menor sessionId', () => {
    const locks = resolveLocks(
      [contender('b', 10, ['b']), contender('a', 10, ['c'])],
      groupOf,
      descendants,
    );

    expect(locks.get('c')).toBe('a');
    expect(locks.get('d')).toBe('b');
  });

  it('sem o mapa dos descendentes, o resultado é o de antes', () => {
    const locks = resolveLocks([contender('a', 10, ['b'])], groupOf);

    expect([...locks.entries()]).toEqual([['b', 'a']]);
  });

  it('propriedade: a ordem em que as sessões chegam não muda o vencedor com board (US-BD.15)', () => {
    const selection = fc.subarray(['b', 'c', 'd', 'g', 'm1', 'fora'], { minLength: 0 });
    const one = (id: string) =>
      fc.record({
        sessionId: fc.constant(id),
        selectedAt: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
        selection,
      });

    fc.assert(
      fc.property(
        fc.tuple(one('a'), one('b'), one('c'), one('d')),
        fc.func(fc.double({ min: 0, max: 1, noNaN: true })),
        (all, order) => {
          const shuffled = [...all].sort((x, y) => order(x.sessionId) - order(y.sessionId));
          const base = resolveLocks(all, groupOf, descendants);
          const other = resolveLocks(shuffled, groupOf, descendants);

          expect([...other.entries()].sort()).toEqual([...base.entries()].sort());
        },
      ),
      { numRuns: 200 },
    );
  });
});
