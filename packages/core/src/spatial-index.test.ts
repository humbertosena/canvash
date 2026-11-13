import { describe, expect, it } from 'vitest';
import type { Bounds } from './geometry/bounds.js';
import { boundsIntersect } from './geometry/bounds.js';
import { createGridIndex } from './spatial-index.js';

function box(x: number, y: number, width: number, height: number): Bounds {
  return { x, y, width, height };
}

/** Gerador determinístico de números em [0, 1). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('índice espacial em grade', () => {
  it('devolve os itens cuja caixa toca a consulta, e só eles', () => {
    const index = createGridIndex();
    index.set('a', box(0, 0, 10, 10));
    index.set('b', box(100, 100, 10, 10));
    index.set('c', box(5, 5, 200, 200));

    expect(index.query(box(0, 0, 1, 1)).sort()).toEqual(['a']);
    expect(index.query(box(8, 8, 1, 1)).sort()).toEqual(['a', 'c']);
    expect(index.query(box(105, 105, 1, 1)).sort()).toEqual(['b', 'c']);
    expect(index.query(box(-50, -50, 10, 10))).toEqual([]);
    expect(index.query(box(1000, 1000, 10, 10))).toEqual([]);
  });

  it('conta encostar na borda como tocar', () => {
    const index = createGridIndex();
    index.set('a', box(0, 0, 10, 10));

    expect(index.query(box(10, 10, 5, 5))).toEqual(['a']);
    expect(index.query(box(-5, -5, 5, 5))).toEqual(['a']);
    expect(index.query(box(10.001, 0, 5, 5))).toEqual([]);
  });

  it('não repete um item que ocupa várias células', () => {
    const index = createGridIndex();
    index.set('wide', box(-300, -300, 900, 900));

    expect(index.query(box(-400, -400, 1200, 1200))).toEqual(['wide']);
  });

  it('atualiza a caixa de um item já indexado', () => {
    const index = createGridIndex();
    index.set('a', box(0, 0, 10, 10));

    index.set('a', box(5000, 5000, 10, 10));

    expect(index.query(box(0, 0, 10, 10))).toEqual([]);
    expect(index.query(box(5000, 5000, 1, 1))).toEqual(['a']);
  });

  it('remove itens, e remover o que não existe não faz nada', () => {
    const index = createGridIndex();
    index.set('a', box(0, 0, 10, 10));
    index.set('big', box(-1e6, -1e6, 2e6, 2e6));

    index.delete('a');
    index.delete('big');
    index.delete('never');

    expect(index.query(box(0, 0, 10, 10))).toEqual([]);
  });

  it('esvazia', () => {
    const index = createGridIndex();
    index.set('a', box(0, 0, 10, 10));
    index.set('big', box(-1e6, -1e6, 2e6, 2e6));

    index.clear();

    expect(index.query(box(-1e7, -1e7, 2e7, 2e7))).toEqual([]);
  });

  it('acha item enorme em qualquer ponto dele e fora dele não', () => {
    const index = createGridIndex();
    index.set('big', box(-5e6, -5e6, 1e7, 1e7));
    index.set('small', box(10, 10, 1, 1));

    expect(index.query(box(4_999_990, 4_999_990, 5, 5))).toEqual(['big']);
    expect(index.query(box(10, 10, 1, 1)).sort()).toEqual(['big', 'small']);
    expect(index.query(box(5_000_001, 0, 5, 5))).toEqual([]);
  });

  it('responde a uma consulta enorme sem percorrer célula por célula', () => {
    const index = createGridIndex();
    index.set('a', box(-9e6, -9e6, 10, 10));
    index.set('b', box(9e6, 9e6, 10, 10));
    index.set('c', box(2e7, 2e7, 10, 10));

    expect(index.query(box(-1e7, -1e7, 2e7, 2e7)).sort()).toEqual(['a', 'b']);
  });

  it('aceita coordenadas além do alcance da grade', () => {
    const index = createGridIndex();
    index.set('far', box(1e12, -1e12, 10, 10));
    index.set('farther', box(1e15, -1e15, 10, 10));

    expect(index.query(box(1e12, -1e12, 1, 1))).toEqual(['far']);
    expect(index.query(box(1e15, -1e15, 1, 1))).toEqual(['farther']);
    expect(index.query(box(1e13, -1e13, 1, 1))).toEqual([]);
  });

  it('em coordenada finita extrema, guarda, acha e termina', () => {
    // Sem o teto de células, somar 1 a uma coordenada de célula de 1e297 não a muda, e o laço
    // que percorre as células não acaba.
    const index = createGridIndex();
    index.set('low', box(-1e300, -1e300, 10, 10));
    index.set('high', box(1e300, 1e300, 10, 10));

    expect(index.query(box(-1e300, -1e300, 1, 1))).toEqual(['low']);
    expect(index.query(box(1e300, 1e300, 1, 1))).toEqual(['high']);
    expect(index.query(box(1e300, -1e300, 1, 1))).toEqual([]);
  });

  it('trata caixa de largura ou altura zero', () => {
    const index = createGridIndex();
    index.set('dot', box(50, 50, 0, 0));
    index.set('hline', box(0, 300, 1000, 0));

    expect(index.query(box(50, 50, 0, 0))).toEqual(['dot']);
    expect(index.query(box(500, 290, 1, 20))).toEqual(['hline']);
  });

  it('dá o mesmo resultado que a varredura completa em cenas geradas', () => {
    const random = lcg(20261011);
    const index = createGridIndex();
    const items = new Map<string, Bounds>();
    for (let i = 0; i < 600; i++) {
      // Tamanhos de 1 a 10.000 e posições em uma área de 40.000: de itens de uma célula a enormes.
      const size = 10 ** (random() * 4);
      const bounds = box(
        (random() - 0.5) * 40_000,
        (random() - 0.5) * 40_000,
        size,
        size * random(),
      );
      items.set(`n${i}`, bounds);
      index.set(`n${i}`, bounds);
    }
    for (let i = 0; i < 600; i += 7) {
      items.delete(`n${i}`);
      index.delete(`n${i}`);
    }
    for (let i = 1; i < 600; i += 11) {
      if (!items.has(`n${i}`)) continue;
      const moved = box((random() - 0.5) * 40_000, (random() - 0.5) * 40_000, 30, 30);
      items.set(`n${i}`, moved);
      index.set(`n${i}`, moved);
    }

    for (let q = 0; q < 300; q++) {
      const size = 10 ** (random() * 5);
      const query = box((random() - 0.5) * 50_000, (random() - 0.5) * 50_000, size, size);
      const expected = [...items]
        .filter(([, bounds]) => boundsIntersect(bounds, query))
        .map(([id]) => id);

      expect(index.query(query).sort()).toEqual(expected.sort());
    }
  });
});
