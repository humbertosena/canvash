import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isSelectionVisible,
  placePanel,
  placeSelectionMenu,
  type SelectionMenuPlacementOptions,
} from './selection-menu-placement.js';

const AREA = { x: 0, y: 0, width: 1000, height: 700 };
const MENU = { width: 200, height: 40 };
const OPTIONS: SelectionMenuPlacementOptions = {
  margin: 16,
  gap: 12,
  topInset: 72,
  rotationHandleOffset: 0,
};

describe('placeSelectionMenu', () => {
  it('fica centralizado sobre a seleção, 12 px acima dela', () => {
    const selection = { x: 400, y: 300, width: 200, height: 100 };

    const placement = placeSelectionMenu(selection, MENU, AREA, OPTIONS);

    expect(placement).toEqual({ x: 400, y: 300 - 12 - 40, side: 'above' });
  });

  it('desce a distância da alça de rotação quando ela está visível', () => {
    const selection = { x: 400, y: 300, width: 200, height: 100 };

    const placement = placeSelectionMenu(selection, MENU, AREA, {
      ...OPTIONS,
      rotationHandleOffset: 28,
    });

    expect(placement.y).toBe(300 - 12 - 28 - 40);
  });

  it('vai para baixo da seleção quando acima não há espaço sob a faixa do topo', () => {
    const selection = { x: 400, y: 80, width: 200, height: 100 };

    const placement = placeSelectionMenu(selection, MENU, AREA, OPTIONS);

    expect(placement).toEqual({ x: 400, y: 80 + 100 + 12, side: 'below' });
  });

  it('não sai da área na horizontal: respeita a margem de 16 px nos dois lados', () => {
    const left = placeSelectionMenu({ x: 0, y: 300, width: 40, height: 40 }, MENU, AREA, OPTIONS);
    const right = placeSelectionMenu(
      { x: 960, y: 300, width: 40, height: 40 },
      MENU,
      AREA,
      OPTIONS,
    );

    expect(left.x).toBe(16);
    expect(right.x).toBe(1000 - 16 - 200);
  });

  it('com a área deslocada, a margem vale a partir da borda dela', () => {
    const area = { x: 300, y: 50, width: 700, height: 600 };

    const placement = placeSelectionMenu(
      { x: 300, y: 300, width: 20, height: 20 },
      MENU,
      area,
      OPTIONS,
    );

    expect(placement.x).toBe(316);
  });

  it('sem espaço acima nem abaixo, entra na área sobre a seleção', () => {
    const selection = { x: 400, y: -200, width: 200, height: 900 };

    const placement = placeSelectionMenu(selection, MENU, AREA, OPTIONS);

    expect(placement.side).toBe('inside');
    expect(placement.y).toBeGreaterThanOrEqual(72);
    expect(placement.y + 40).toBeLessThanOrEqual(700 - 16);
  });

  it('seleção perto do fundo: não deixa o menu passar da borda de baixo', () => {
    const selection = { x: 400, y: 690, width: 100, height: 100 };

    const placement = placeSelectionMenu(selection, MENU, AREA, OPTIONS);

    expect(placement.y + 40).toBeLessThanOrEqual(700 - 16);
  });

  it('área menor que o menu: alinha à margem esquerda em vez de ficar com valor inválido', () => {
    const tiny = { x: 0, y: 0, width: 100, height: 100 };

    const placement = placeSelectionMenu(
      { x: 10, y: 10, width: 20, height: 20 },
      MENU,
      tiny,
      OPTIONS,
    );

    expect(placement.x).toBe(16);
    expect(Number.isFinite(placement.y)).toBe(true);
  });

  it('propriedade: quando o menu cabe na área, ele nunca sai dela', () => {
    const coordinate = fc.integer({ min: -2000, max: 3000 });
    const length = fc.integer({ min: 1, max: 2500 });

    fc.assert(
      fc.property(coordinate, coordinate, length, length, (x, y, width, height) => {
        const placement = placeSelectionMenu({ x, y, width, height }, MENU, AREA, OPTIONS);

        expect(placement.x).toBeGreaterThanOrEqual(AREA.x + OPTIONS.margin);
        expect(placement.x + MENU.width).toBeLessThanOrEqual(AREA.x + AREA.width - OPTIONS.margin);
        expect(placement.y).toBeGreaterThanOrEqual(AREA.y + OPTIONS.topInset);
        expect(placement.y + MENU.height).toBeLessThanOrEqual(
          AREA.y + AREA.height - OPTIONS.margin,
        );
      }),
    );
  });
});

describe('isSelectionVisible', () => {
  it('é visível quando a caixa cruza a área, mesmo em parte', () => {
    expect(isSelectionVisible({ x: 10, y: 10, width: 50, height: 50 }, AREA)).toBe(true);
    expect(isSelectionVisible({ x: -30, y: 10, width: 50, height: 50 }, AREA)).toBe(true);
    expect(isSelectionVisible({ x: 980, y: 680, width: 100, height: 100 }, AREA)).toBe(true);
  });

  it('não é visível quando está inteira fora da área', () => {
    expect(isSelectionVisible({ x: -100, y: 10, width: 50, height: 50 }, AREA)).toBe(false);
    expect(isSelectionVisible({ x: 10, y: 800, width: 50, height: 50 }, AREA)).toBe(false);
    expect(isSelectionVisible({ x: 1000, y: 10, width: 50, height: 50 }, AREA)).toBe(false);
  });
});

describe('placePanel', () => {
  const PANEL = { width: 280, height: 300 };
  const anchor = { x: 400, y: 200, width: 200, height: 40 };

  it('abre abaixo do menu, alinhado à esquerda dele, com 8 px de intervalo', () => {
    const placement = placePanel(anchor, PANEL, AREA, { margin: 16, gap: 8 });

    expect(placement).toEqual({ x: 400, y: 200 + 40 + 8, side: 'below', maxHeight: 300 });
  });

  it('abre acima quando abaixo não cabe e acima cabe', () => {
    const low = { x: 400, y: 600, width: 200, height: 40 };

    const placement = placePanel(low, PANEL, AREA, { margin: 16, gap: 8 });

    expect(placement.side).toBe('above');
    expect(placement.y).toBe(600 - 8 - 300);
  });

  it('limita a altura ao espaço disponível quando não cabe nem acima nem abaixo', () => {
    const area = { x: 0, y: 0, width: 1000, height: 400 };
    const middle = { x: 400, y: 150, width: 200, height: 40 };

    const placement = placePanel(middle, PANEL, area, { margin: 16, gap: 8 });

    expect(placement.side).toBe('below');
    expect(placement.maxHeight).toBe(400 - 16 - (150 + 40 + 8));
    expect(placement.y + placement.maxHeight).toBeLessThanOrEqual(400 - 16);
  });

  it('não sai da área na horizontal', () => {
    const edge = { x: 900, y: 200, width: 100, height: 40 };

    const placement = placePanel(edge, PANEL, AREA, { margin: 16, gap: 8 });

    expect(placement.x).toBe(1000 - 16 - 280);
  });
});
