import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from '../canvas-section.js';
import type { BoardNode } from '../shapes.js';
import { BOARD_TITLE_BAND, BOARD_TITLE_FONT_SIZE, boardTitleBounds } from './board.js';
import { boundsIntersect, shapeBounds } from './bounds.js';
import { shapeInsideRect, shapeIntersectsRect } from './intersect.js';
import { pointInShape } from './shapes.js';

// Geometria do board (spec boards, §3.1): a caixa inclui a faixa do título acima da borda.

const BOARD: BoardNode = {
  id: 'b',
  type: 'board',
  x: 100,
  y: 200,
  width: 300,
  height: 150,
  title: 'Planejamento',
  style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
  childIds: [],
  visible: true,
  locked: false,
};
const NO_BORDER: BoardNode = { ...BOARD, style: { ...BOARD.style, stroke: null } };
const NO_FILL: BoardNode = { ...BOARD, style: { ...BOARD.style, fill: null } };

describe('constantes e boardTitleBounds', () => {
  it('a faixa tem 24 unidades e a fonte do título, 14', () => {
    expect(BOARD_TITLE_BAND).toBe(24);
    expect(BOARD_TITLE_FONT_SIZE).toBe(14);
  });

  it('boardTitleBounds é só a faixa, logo acima da borda superior, na largura do board', () => {
    expect(boardTitleBounds(BOARD)).toEqual({ x: 100, y: 176, width: 300, height: 24 });
  });
});

describe('shapeBounds do board', () => {
  it('inclui a faixa do título e meia unidade da borda de 1', () => {
    expect(shapeBounds(BOARD)).toEqual({ x: 99.5, y: 175.5, width: 301, height: 175 });
  });

  it('sem borda, a caixa é a do board mais a faixa', () => {
    expect(shapeBounds(NO_BORDER)).toEqual({ x: 100, y: 176, width: 300, height: 174 });
  });

  it('stroke: false tira só a meia unidade da borda, e a faixa fica', () => {
    expect(shapeBounds(BOARD, { stroke: false })).toEqual({
      x: 100,
      y: 176,
      width: 300,
      height: 174,
    });
  });
});

describe('pointInShape do board', () => {
  it('acha o fundo, mesmo sem preenchimento', () => {
    expect(pointInShape(BOARD, { x: 250, y: 280 }, 0)).toBe(true);
    expect(pointInShape(NO_FILL, { x: 250, y: 280 }, 0)).toBe(true);
  });

  it('acha o título, na faixa acima da borda', () => {
    expect(pointInShape(BOARD, { x: 120, y: 188 }, 0)).toBe(true);
    expect(pointInShape(NO_FILL, { x: 399, y: 177 }, 0)).toBe(true);
  });

  it('não acha o que está fora, nem acima da faixa', () => {
    expect(pointInShape(BOARD, { x: 250, y: 150 }, 0)).toBe(false);
    expect(pointInShape(BOARD, { x: 450, y: 280 }, 0)).toBe(false);
    expect(pointInShape(BOARD, { x: 250, y: 400 }, 0)).toBe(false);
  });

  it('a tolerância alarga a área, como na borda das outras formas', () => {
    expect(pointInShape(NO_BORDER, { x: 95, y: 280 }, 6)).toBe(true);
    expect(pointInShape(NO_BORDER, { x: 93, y: 280 }, 6)).toBe(false);
  });
});

describe('shapeInsideRect e shapeIntersectsRect do board', () => {
  const around = { x: 90, y: 170, width: 320, height: 190 };

  it('shapeInsideRect só aceita o board contido inteiro, faixa incluída', () => {
    expect(shapeInsideRect(BOARD, around)).toBe(true);
    // Contém o corpo, mas a faixa do título fica de fora.
    expect(shapeInsideRect(BOARD, { x: 90, y: 190, width: 320, height: 170 })).toBe(false);
    expect(shapeInsideRect(BOARD, { x: 100, y: 200, width: 300, height: 150 })).toBe(false);
  });

  it('shapeIntersectsRect acha o board tocado no corpo ou no título', () => {
    expect(shapeIntersectsRect(BOARD, { x: 200, y: 250, width: 10, height: 10 })).toBe(true);
    expect(shapeIntersectsRect(BOARD, { x: 150, y: 170, width: 20, height: 10 })).toBe(true);
    expect(shapeIntersectsRect(BOARD, { x: 0, y: 0, width: 50, height: 50 })).toBe(false);
  });

  it('o retângulo todo dentro do board, sem tocar a borda, toca o board (o fundo é cheio)', () => {
    expect(shapeIntersectsRect(NO_FILL, { x: 200, y: 250, width: 10, height: 10 })).toBe(true);
  });
});

describe('o board nas consultas do canvas', () => {
  function sectionWithBoard(): CanvasSectionApi {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b', type: 'board', x: 100, y: 200, width: 300, height: 150, title: 'T' },
    } as never);
    return section;
  }

  it('hitTestAll acha o board no título e no fundo', () => {
    const section = sectionWithBoard();
    const options = { includePreview: false, tolerance: 0 };

    expect(section.hitTestAll({ x: 120, y: 188 }, options)).toEqual(['b']);
    expect(section.hitTestAll({ x: 250, y: 280 }, options)).toEqual(['b']);
    expect(section.hitTestAll({ x: 250, y: 150 }, options)).toEqual([]);
  });

  it('um nó da frente na mesma camada vence o fundo do board', () => {
    const section = sectionWithBoard();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 200, y: 250, width: 50, height: 50, rotation: 0 },
    });

    const hits = section.hitTestAll({ x: 220, y: 270 }, { includePreview: false, tolerance: 0 });

    expect(hits).toEqual(['r', 'b']);
  });

  it('getBounds([board]) devolve a caixa com a faixa', () => {
    const section = sectionWithBoard();

    expect(section.getBounds(['b'], { includePreview: false })).toEqual({
      x: 99.5,
      y: 175.5,
      width: 301,
      height: 175,
    });
  });

  it('o índice espacial acha o board numa consulta de retângulo', () => {
    const section = sectionWithBoard();

    expect(
      section.queryBounds({ x: 150, y: 170, width: 10, height: 10 }, { includePreview: false }),
    ).toEqual(['b']);
    expect(
      section.queryBounds({ x: 0, y: 0, width: 50, height: 50 }, { includePreview: false }),
    ).toEqual([]);
  });

  it('a marquee acha o board tocado (intersect) e o contido inteiro (contain)', () => {
    const section = sectionWithBoard();
    const options = { includePreview: false };

    expect(
      section.queryMarquee(
        { x: 90, y: 170, width: 320, height: 190 },
        { ...options, mode: 'contain' },
      ),
    ).toEqual(['b']);
    expect(
      section.queryMarquee(
        { x: 150, y: 250, width: 20, height: 20 },
        { ...options, mode: 'contain' },
      ),
    ).toEqual([]);
    expect(
      section.queryMarquee(
        { x: 150, y: 250, width: 20, height: 20 },
        { ...options, mode: 'intersect' },
      ),
    ).toEqual(['b']);
  });

  it('o índice acompanha a edição: mover o board muda onde ele é achado', () => {
    const section = sectionWithBoard();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { x: 1000, y: 1000 } } as never);

    expect(
      section.queryBounds({ x: 150, y: 170, width: 10, height: 10 }, { includePreview: false }),
    ).toEqual([]);
    expect(
      section.queryBounds({ x: 1100, y: 1100, width: 10, height: 10 }, { includePreview: false }),
    ).toEqual(['b']);
  });

  it('o board e a caixa dele se cruzam pelo helper de bounds', () => {
    expect(boundsIntersect(shapeBounds(BOARD), { x: 150, y: 170, width: 20, height: 10 })).toBe(
      true,
    );
  });
});
