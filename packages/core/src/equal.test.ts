import { describe, expect, it } from 'vitest';
import { jsonEqual } from './equal.js';

describe('jsonEqual', () => {
  it.each([
    ['o mesmo objeto', [{ a: 1 }].map((value) => [value, value])[0]],
    ['primitivos iguais', ['a', 'a']],
    ['null e null', [null, null]],
    ['undefined e undefined', [undefined, undefined]],
    [
      'objetos com as mesmas chaves em outra ordem',
      [
        { a: 1, b: [1, 2] },
        { b: [1, 2], a: 1 },
      ],
    ],
    [
      'arrays iguais',
      [
        [1, 'a', null, { x: true }],
        [1, 'a', null, { x: true }],
      ],
    ],
    ['aninhamento profundo', [{ a: { b: { c: [{ d: 0 }] } } }, { a: { b: { c: [{ d: 0 }] } } }]],
    ['objetos vazios', [{}, {}]],
  ])('considera iguais: %s', (_label, pair) => {
    expect(jsonEqual(pair?.[0], pair?.[1])).toBe(true);
  });

  it.each([
    ['números diferentes', [1, 2]],
    ['número e texto', [1, '1']],
    ['objeto e null', [{}, null]],
    ['null e objeto', [null, {}]],
    ['objeto e undefined', [{ a: 1 }, undefined]],
    ['objeto e primitivo', [{ a: 1 }, 1]],
    ['array e objeto com as mesmas chaves', [['a'], { 0: 'a' }]],
    ['objeto e array com as mesmas chaves', [{ 0: 'a' }, ['a']]],
    ['chave a mais', [{ a: 1 }, { a: 1, b: 2 }]],
    ['chave a menos', [{ a: 1, b: 2 }, { a: 1 }]],
    ['mesma quantidade de chaves com nomes diferentes', [{ a: 1 }, { b: 1 }]],
    ['chave ausente contra chave com undefined', [{ a: undefined }, { b: undefined }]],
    ['valor aninhado diferente', [{ a: { b: [1, 2] } }, { a: { b: [1, 3] } }]],
    ['arrays de tamanhos diferentes', [[1], [1, 2]]],
    [
      'arrays em outra ordem',
      [
        [1, 2],
        [2, 1],
      ],
    ],
  ])('considera diferentes: %s', (_label, pair) => {
    expect(jsonEqual(pair[0], pair[1])).toBe(false);
  });
});
