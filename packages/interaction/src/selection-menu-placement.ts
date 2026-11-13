/** Retângulo em CSS px, no mesmo espaço de coordenadas da área. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export interface SelectionMenuPlacementOptions {
  /** Distância mínima entre o menu e as bordas da área. */
  readonly margin: number;
  /** Intervalo entre o menu e a caixa da seleção. */
  readonly gap: number;
  /** Faixa do topo da área, ocupada pelas ilhas do shell: o menu não entra nela. */
  readonly topInset: number;
  /** Distância extra acima da seleção quando a alça de rotação está visível. */
  readonly rotationHandleOffset: number;
}

export interface SelectionMenuPlacement {
  readonly x: number;
  readonly y: number;
  /** De que lado da seleção o menu ficou; `inside` quando não coube nem acima nem abaixo. */
  readonly side: 'above' | 'below' | 'inside';
}

/** Mantém `value` em `[low, high]`; se a faixa é inválida (`high < low`), vale `low`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** A caixa da seleção cruza a área, mesmo em parte? */
export function isSelectionVisible(selection: ScreenRect, area: ScreenRect): boolean {
  return (
    selection.x < area.x + area.width &&
    selection.x + selection.width > area.x &&
    selection.y < area.y + area.height &&
    selection.y + selection.height > area.y
  );
}

/**
 * Posição do mini-menu da seleção: centralizado sobre a caixa dela, acima; abaixo quando acima
 * não há espaço sob a faixa do topo; dentro da área, sobre a seleção, quando não cabe nem acima
 * nem abaixo. Na horizontal fica sempre a `margin` das bordas da área.
 */
export function placeSelectionMenu(
  selection: ScreenRect,
  menu: ScreenSize,
  area: ScreenRect,
  options: SelectionMenuPlacementOptions,
): SelectionMenuPlacement {
  const x = clamp(
    selection.x + selection.width / 2 - menu.width / 2,
    area.x + options.margin,
    area.x + area.width - options.margin - menu.width,
  );

  const minY = area.y + options.topInset;
  const maxY = area.y + area.height - options.margin - menu.height;
  const aboveY = selection.y - options.gap - options.rotationHandleOffset - menu.height;
  const belowY = selection.y + selection.height + options.gap;

  if (aboveY >= minY && aboveY <= maxY) return { x, y: aboveY, side: 'above' };
  if (belowY >= minY && belowY <= maxY) return { x, y: belowY, side: 'below' };
  return { x, y: clamp(aboveY, minY, maxY), side: 'inside' };
}

export interface PanelPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: 'above' | 'below';
  /** Altura máxima do painel nesta posição; acima disso ele rola por dentro. */
  readonly maxHeight: number;
}

/**
 * Posição do painel de propriedades junto do mini-menu (`anchor`): abaixo dele, alinhado à
 * esquerda; acima quando abaixo não cabe e acima cabe; senão abaixo, com a altura limitada ao
 * espaço que sobra.
 */
export function placePanel(
  anchor: ScreenRect,
  panel: ScreenSize,
  area: ScreenRect,
  options: { readonly margin: number; readonly gap: number },
): PanelPlacement {
  const x = clamp(
    anchor.x,
    area.x + options.margin,
    area.x + area.width - options.margin - panel.width,
  );
  const bottom = area.y + area.height - options.margin;
  const belowY = anchor.y + anchor.height + options.gap;
  const aboveY = anchor.y - options.gap - panel.height;

  if (belowY + panel.height <= bottom) {
    return { x, y: belowY, side: 'below', maxHeight: panel.height };
  }
  if (aboveY >= area.y + options.margin) {
    return { x, y: aboveY, side: 'above', maxHeight: panel.height };
  }
  return { x, y: belowY, side: 'below', maxHeight: Math.max(0, bottom - belowY) };
}
