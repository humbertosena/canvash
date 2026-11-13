import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareOrderKeys, generateOrderKey } from './fractional-index.js';

describe('Indexação Fracionária Determinística (COLLAB-09)', () => {
  it('gera chave inicial quando a lista está vazia', () => {
    const k = generateOrderKey(null, null);
    expect(k).toBeTruthy();
    expect(typeof k).toBe('string');
  });

  it('gera chaves em ordem estrita para inserções contínuas no início e fim', () => {
    const k1 = generateOrderKey(null, null);
    const k2 = generateOrderKey(k1, null);
    const k3 = generateOrderKey(k2, null);
    expect(k1 < k2).toBe(true);
    expect(k2 < k3).toBe(true);

    const k0 = generateOrderKey(null, k1);
    expect(k0 < k1).toBe(true);
  });

  it('gera chaves intermediárias entre dois nós vizinhos', () => {
    const first = 'a0';
    const last = 'z0';
    const middle = generateOrderKey(first, last);
    expect(first < middle).toBe(true);
    expect(middle < last).toBe(true);

    // Inserção entre caracteres adjacentes
    const kA = 'a';
    const kB = 'b';
    const kMid = generateOrderKey(kA, kB);
    expect(kA < kMid).toBe(true);
    expect(kMid < kB).toBe(true);
  });

  it('desempata deterministicamente colisões concorrentes com tieBreakerId (COLLAB-09)', () => {
    const sameKey = 'm5';
    // Dois clientes inseriram no mesmo lugar simultaneamente gerando sameKey
    const tieA = generateOrderKey(sameKey, sameKey, 'client_A');
    const tieB = generateOrderKey(sameKey, sameKey, 'client_B');

    expect(tieA).not.toBe(tieB);
    expect(tieA < tieB).toBe(true);

    // E podemos continuar inserindo entre os dois nós empatados sem quebrar a ordem
    const inBetween = generateOrderKey(tieA, tieB, 'client_C');
    expect(tieA < inBetween).toBe(true);
    expect(inBetween < tieB).toBe(true);
  });

  it('ordena coleções de nós de forma estável com compareOrderKeys', () => {
    const items = [
      { orderKey: 'b', id: '2' },
      { orderKey: 'a', id: '1' },
      { orderKey: 'b', id: '1' }, // Empate em orderKey -> id desempata
      { orderKey: 'c', id: '3' },
    ];

    items.sort(compareOrderKeys);

    expect(items.map((i) => `${i.orderKey}:${i.id}`)).toEqual(['a:1', 'b:1', 'b:2', 'c:3']);
  });
});

describe('compareOrderKeys: desempate por ordem binária das strings (code units UTF-16), independente de locale', () => {
  const ids = ['b', 'B', '_x', '1', '\u00e9', 'e\u0301'];

  it('ordena ids empatados em orderKey pela ordem binária, sem depender do locale', () => {
    const items = ids.map((id) => ({ orderKey: 'm', id }));

    items.sort(compareOrderKeys);

    expect(items.map((i) => i.id)).toEqual(['1', 'B', '_x', 'b', 'e\u0301', '\u00e9']);
  });

  it('é uma ordem total: nenhum par de ids distintos compara 0 e todo item compara 0 consigo mesmo', () => {
    const items = ids.map((id) => ({ orderKey: 'm', id }));

    for (const a of items) {
      expect(compareOrderKeys(a, a)).toBe(0);
      for (const b of items) {
        if (a === b) continue;
        const ab = compareOrderKeys(a, b);
        expect(ab).not.toBe(0);
        expect(Math.sign(ab)).toBe(-Math.sign(compareOrderKeys(b, a)));
      }
    }
  });
});

function expectStrictlyBetween(prev: string | null, key: string, next: string | null): void {
  if (prev !== null) expect(prev < key).toBe(true);
  if (next !== null) expect(key < next).toBe(true);
}

type OrderOperation = { kind: 'prepend' | 'append' | 'insert'; at: number };

/** Aplica uma sequência de inserções e verifica, a cada passo, que a chave cai entre os vizinhos. */
function applyOperations(operations: readonly OrderOperation[]): string[] {
  const keys: string[] = [];
  for (const { kind, at } of operations) {
    let index: number;
    if (kind === 'prepend') index = 0;
    else if (kind === 'append') index = keys.length;
    else index = keys.length === 0 ? 0 : (at % keys.length) + 1;
    const prev = keys[index - 1] ?? null;
    const next = keys[index] ?? null;
    const key = generateOrderKey(prev, next);
    expectStrictlyBetween(prev, key, next);
    keys.splice(index, 0, key);
  }
  return keys;
}

describe('generateOrderKey: prev < chave < next para todo par válido', () => {
  it('insere antes de next formado só pelo menor dígito (null, "0000")', () => {
    expectStrictlyBetween(null, generateOrderKey(null, '0000'), '0000');
    expectStrictlyBetween(null, generateOrderKey(null, '0'), '0');
  });

  it('insere entre prev e prev seguido do menor dígito ("a", "a0")', () => {
    expectStrictlyBetween('a', generateOrderKey('a', 'a0'), 'a0');
    expectStrictlyBetween('a', generateOrderKey('a', 'a00'), 'a00');
  });

  it('insere antes de next que começa pelo menor dígito (null, "0a")', () => {
    const key = generateOrderKey(null, '0a');
    expect(key).toBe('05');
    expectStrictlyBetween(null, key, '0a');
  });

  it('insere depois do maior dígito ("z", null)', () => {
    expect(generateOrderKey('z', null)).toBe('zm');
  });

  it('desempata com "0" quando tieBreakerId é vazio ou só tem símbolos', () => {
    expect(generateOrderKey('m', 'm')).toBe('m_0');
    expect(generateOrderKey('m', 'm', '!!!')).toBe('m_0');
  });

  it('6 inserções seguidas no início a partir de "m" mantêm a ordem', () => {
    let first = generateOrderKey(null, null);
    for (let i = 0; i < 6; i++) {
      const key = generateOrderKey(null, first);
      expectStrictlyBetween(null, key, first);
      first = key;
    }
  });

  it('200 inserções seguidas no início, no fim e logo após o mesmo item mantêm a ordem', () => {
    const prepends = applyOperations(
      Array.from({ length: 200 }, () => ({ kind: 'prepend', at: 0 })),
    );
    const appends = applyOperations(Array.from({ length: 200 }, () => ({ kind: 'append', at: 0 })));
    const afterSame = applyOperations([
      { kind: 'append', at: 0 },
      { kind: 'append', at: 0 },
      ...Array.from({ length: 200 }, (): OrderOperation => ({ kind: 'insert', at: 0 })),
    ]);

    for (const keys of [prepends, appends, afterSame]) {
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('nunca gera chave terminada no menor dígito', () => {
    const keys = applyOperations([
      ...Array.from({ length: 50 }, (): OrderOperation => ({ kind: 'prepend', at: 0 })),
      ...Array.from({ length: 50 }, (): OrderOperation => ({ kind: 'insert', at: 3 })),
    ]);

    expect(keys.filter((key) => key.endsWith('0'))).toEqual([]);
  });

  it('propriedade: sequências de inserções do próprio gerador ficam em ordem estrita e sem repetição', () => {
    // Cada passo repete a mesma operação algumas vezes para formar rajadas no mesmo ponto.
    const step = fc.record({
      kind: fc.constantFrom<OrderOperation['kind']>('prepend', 'append', 'insert'),
      at: fc.nat({ max: 1000 }),
      times: fc.integer({ min: 1, max: 12 }),
    });

    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const keys = applyOperations(
          steps.flatMap(({ kind, at, times }) =>
            Array.from({ length: times }, () => ({ kind, at })),
          ),
        );
        expect([...keys].sort()).toEqual(keys);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('propriedade: para strings arbitrárias com prev < next, a chave fica estritamente entre as duas', () => {
    const text = fc.string({ unit: 'binary', maxLength: 6 });

    fc.assert(
      fc.property(fc.option(text, { nil: null }), fc.option(text, { nil: null }), (a, b) => {
        const prev = a === '' ? null : a;
        const next = b === '' ? null : b;
        fc.pre(prev === null || next === null || prev < next);
        fc.pre(next !== `${prev ?? ''}\u0000`);
        expectStrictlyBetween(prev, generateOrderKey(prev, next), next);
      }),
    );
  });

  it('insere antes e entre chaves com U+0000 e caracteres abaixo do menor dígito', () => {
    for (const next of ['\u0000\u0000', '\u0000a', '\u0000/', '/', '0/', '00!']) {
      expectStrictlyBetween(null, generateOrderKey(null, next), next);
    }
    expectStrictlyBetween('a', generateOrderKey('a', 'a\u0000\u0000'), 'a\u0000\u0000');
  });

  it('recusa com RangeError pares sem chave possível entre eles ou fora de ordem', () => {
    expect(() => generateOrderKey(null, '\u0000')).toThrow(RangeError);
    expect(() => generateOrderKey('a', 'a\u0000')).toThrow(RangeError);
    expect(() => generateOrderKey('b', 'a')).toThrow(RangeError);
  });
});
