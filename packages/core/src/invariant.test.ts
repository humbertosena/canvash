import { describe, expect, it } from 'vitest';
import { must } from './invariant.js';

describe('must', () => {
  it.each([0, '', false, null])('devolve %j, que não é undefined', (value) => {
    expect(must(value, 'a value')).toBe(value);
  });

  it('lança um erro de defeito interno quando o valor é undefined', () => {
    expect(() => must(undefined, 'the layer of a node')).toThrow(
      'Canvash internal error: missing the layer of a node',
    );
  });
});
