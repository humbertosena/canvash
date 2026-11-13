import {
  isZeroLengthArrow,
  type ArrowEndpoint,
  type ArrowMarkerType,
  type Point,
} from './arrows.js';
import {
  at,
  boolean,
  colorOrNull,
  finite,
  isRecord,
  jsonObject,
  nonEmptyString,
  nonNegative,
  positive,
  readAll,
  readSome,
  rejectUnknownKeys,
  report,
  unitInterval,
  verticalAlignCheck,
  type Check,
  type JsonObject,
  type Path,
} from './checks.js';
import { defaultBezierControls, mirrorControl } from './geometry/bezier.js';
import {
  normalizeInkStrokes,
  readInkStrokes,
  type InkStroke,
  type InkStrokeInput,
  type InkStyle,
} from './ink.js';
import { fitAspect, type BoxGeometry } from './geometry/fit.js';
import type { BraceOrientation } from './geometry/brace.js';
import type { ValidationIssue } from './result.js';
import { DEFAULT_SHAPE_LABEL, type ShapeLabel } from './shape-label.js';
import { DEFAULT_STICKY_SIZE, STICKY_COLORS, fitStickyFontSize } from './sticky.js';
import {
  containsHtmlTags,
  layoutText,
  type FontSizeMode,
  type FontWeight,
  type TextAlign,
} from './text.js';

export type {
  ArrowEndpoint,
  ArrowMarkerType,
  BindingEndpoint,
  FreeEndpoint,
  Point,
} from './arrows.js';
export type { BoxGeometry } from './geometry/fit.js';
export type { BraceOrientation } from './geometry/brace.js';
export { FONT_SIZE_PRESETS } from './text.js';
export type { FontSizeMode, FontWeight, TextAlign } from './text.js';
export type { InkKind, InkStroke, InkStrokeInput, InkStyle, InkWidth } from './ink.js';

/** Cor sRGB em hexadecimal minúsculo: `#rrggbb` ou, com alfa, `#rrggbbaa`. */
export type Color = string;

/** Estilo de retângulos e elipses. `null` em `fill` ou `stroke` significa não pintar. */
export interface FillStrokeStyle {
  readonly fill: Color | null;
  readonly stroke: Color | null;
  /** Largura do contorno em unidades do documento. Nunca negativa. */
  readonly strokeWidth: number;
  /** De 0 (transparente) a 1 (opaco). */
  readonly opacity: number;
}

/** Estilo de linhas: não há área para preencher. */
export interface StrokeStyle {
  readonly stroke: Color | null;
  /** Largura do traço em unidades do documento. Nunca negativa. */
  readonly strokeWidth: number;
  /** De 0 (transparente) a 1 (opaco). */
  readonly opacity: number;
}

interface NodeBase {
  readonly id: string;
  /** Um nó só é visível de fato se a camada dele também for. */
  readonly visible: boolean;
  /** Um nó bloqueado, ou em camada bloqueada, não pode ser editado. */
  readonly locked: boolean;
  /**
   * Dados do consumidor, só com valores JSON. O core guarda uma cópia e nunca os interpreta.
   * Use chaves com o namespace da sua aplicação.
   */
  readonly metadata?: JsonObject;
}

export interface RectangleNode extends NodeBase, BoxGeometry {
  readonly type: 'rectangle';
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export interface SquareNode extends NodeBase, BoxGeometry {
  readonly type: 'square';
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export interface EllipseNode extends NodeBase, BoxGeometry {
  readonly type: 'ellipse';
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export interface CircleNode extends NodeBase, BoxGeometry {
  readonly type: 'circle';
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export interface DiamondNode extends NodeBase, BoxGeometry {
  readonly type: 'diamond';
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export type TriangleVariant = 'equilateral' | 'isosceles' | 'right' | 'scalene';

export interface TriangleNode extends NodeBase, BoxGeometry {
  readonly type: 'triangle';
  readonly variant: TriangleVariant;
  /** Posição horizontal do ápice na caixa, de 0 a 1. */
  readonly apex: number;
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

/**
 * Polígono regular inscrito no círculo de diâmetro `width`, com o primeiro vértice no topo.
 * A caixa é sempre 1:1, o que mantém as arestas iguais.
 */
export interface PolygonNode extends NodeBase, BoxGeometry {
  readonly type: 'polygon';
  /** Inteiro de 3 a 12. */
  readonly sides: number;
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

/** Predefinições do polígono regular: ferramenta → lados. Não são tipos novos de nó. */
export const POLYGON_PRESETS = Object.freeze({
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
} as const satisfies Record<string, number>);

export type PolygonPresetTool = keyof typeof POLYGON_PRESETS;

/**
 * Cruz de braços iguais, centrada na caixa. Cada braço tem espessura `armRatio × min(width, height)`
 * e vai de um lado ao outro da caixa; com 1 a cruz ocupa a caixa inteira.
 */
export interface CrossNode extends NodeBase, BoxGeometry {
  readonly type: 'cross';
  /** Espessura dos braços como fração do lado menor, de 0,05 a 1. Padrão 1/3. */
  readonly armRatio: number;
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

export type ChevronDirection = 'right' | 'left' | 'up' | 'down';

/**
 * Seta em "V": uma faixa com a ponta de um lado e o entalhe do outro. `direction` é para onde a
 * ponta aponta; a caixa não muda com ela.
 */
export interface ChevronNode extends NodeBase, BoxGeometry {
  readonly type: 'chevron';
  readonly direction: ChevronDirection;
  /** Profundidade da ponta e do entalhe como fração do comprimento na direção, de 0 a 0,5. */
  readonly notchDepth: number;
  /** Texto dentro da forma; ausente quer dizer sem texto. */
  readonly label?: ShapeLabel;
  readonly style: FillStrokeStyle;
}

/**
 * Chave `{` ou `}`, só contorno. A ponta central fica na borda da caixa indicada por
 * `orientation` e as duas pernas das pontas na borda oposta. A espessura do traço vem de
 * `style.strokeWidth`, em unidades do documento: esticar a caixa não a deforma.
 */
export interface BraceNode extends NodeBase, BoxGeometry {
  readonly type: 'brace';
  /** Para onde a ponta central aponta: `left` é `{`, `right` é `}`. */
  readonly orientation: BraceOrientation;
  /** Posição da ponta ao longo do eixo da chave, de 0 a 1. */
  readonly tipPosition: number;
  /** De 0 (cantos vivos) a 1 (raio máximo). */
  readonly curvature: number;
  readonly style: StrokeStyle;
}

export interface LineNode extends NodeBase {
  readonly type: 'line';
  /** Os dois extremos, em coordenadas de mundo. Nunca coincidem. */
  readonly start: Point;
  readonly end: Point;
  readonly style: StrokeStyle;
}

/**
 * Curva cúbica aberta de um segmento, sem preenchimento. Com `symmetric`, `control2` é sempre o
 * espelho de `control1` pela mediatriz da corda início→fim, e o core deriva um do outro.
 */
export interface BezierNode extends NodeBase {
  readonly type: 'bezier';
  /** As pontas, em coordenadas de mundo. Nunca coincidem. */
  readonly start: Point;
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
  readonly symmetric: boolean;
  readonly style: StrokeStyle;
}

export interface TextNode extends NodeBase, BoxGeometry {
  readonly type: 'text';
  readonly text: string;
  readonly fontSize: number;
  readonly fontSizeMode: FontSizeMode;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  readonly textAlign: TextAlign;
  readonly lineHeight: number;
  readonly style: FillStrokeStyle;
}

/**
 * Nota adesiva: um bloco de texto colorido sobre o quadro. `style.fill` é a cor da nota (nunca
 * nula) e a cor do texto é derivada dela (`stickyTextColor`). No modo `auto`, o core escolhe o
 * `fontSize` pelo maior tamanho da lista que cabe na nota.
 */
export interface StickyNode extends NodeBase, BoxGeometry {
  readonly type: 'sticky';
  readonly text: string;
  readonly fontSize: number;
  readonly fontSizeMode: FontSizeMode;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  readonly textAlign: TextAlign;
  readonly lineHeight: number;
  readonly style: FillStrokeStyle;
}

/**
 * Traço à mão livre: um ou mais traços dentro de uma caixa. Os pontos de cada traço ficam em
 * coordenadas locais da caixa (0 a 1 em cada eixo), então mover, redimensionar e rotacionar o
 * elemento não os toca. Cor, tipo e espessura são de cada traço; o estilo do elemento é só a opacidade.
 */
export interface InkNode extends NodeBase, BoxGeometry {
  readonly type: 'ink';
  /** De 1 a 500 traços, com no máximo 20.000 pontos no total. */
  readonly strokes: readonly InkStroke[];
  readonly style: InkStyle;
}

export interface ArrowNode extends NodeBase {
  readonly type: 'arrow';
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly startMarker: ArrowMarkerType;
  readonly endMarker: ArrowMarkerType;
  readonly style: StrokeStyle;
}

export interface GroupNode extends NodeBase {
  readonly type: 'group';
  readonly childIds: readonly string[];
  readonly style?: undefined;
}

/** Estilo do board: fundo com opacidade própria e borda fina. */
export interface BoardStyle {
  /** Cor do fundo. `null` não pinta o fundo; ele continua clicável. */
  readonly fill: Color | null;
  /** Opacidade só do fundo, de 0 a 1. Não afeta a borda, o título nem os filhos. */
  readonly fillOpacity: number;
  /** Cor da borda, com 1 unidade de largura. `null` não pinta a borda. */
  readonly stroke: Color | null;
}

/** Área do canvas com título e filhos. Os filhos ficam à frente do fundo, na ordem de `childIds`. */
export interface BoardNode extends NodeBase {
  readonly type: 'board';
  readonly x: number;
  readonly y: number;
  /** Sempre maior que zero. */
  readonly width: number;
  /** Sempre maior que zero. */
  readonly height: number;
  /** Uma linha, de 1 a 200 caracteres, sem tags HTML. */
  readonly title: string;
  readonly style: BoardStyle;
  /** Filhos diretos, do fundo para a frente: shapes e grupos, nunca boards. */
  readonly childIds: readonly string[];
}

/** Shape de geometria própria: não depende de outro nó. */
export type ShapeNode =
  | RectangleNode
  | SquareNode
  | EllipseNode
  | CircleNode
  | DiamondNode
  | TriangleNode
  | PolygonNode
  | CrossNode
  | ChevronNode
  | BraceNode
  | StickyNode
  | InkNode
  | LineNode
  | BezierNode
  | TextNode
  | ArrowNode;

/** Nó que ocupa uma caixa (`x`, `y`, `width`, `height`, `rotation`): as figuras de caixa e o texto. */
export type BoxShapeNode = Extract<ShapeNode, BoxGeometry>;

const BOX_SHAPE_TYPES: ReadonlySet<string> = new Set<BoxShapeNode['type']>([
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'diamond',
  'triangle',
  'polygon',
  'cross',
  'chevron',
  'brace',
  'sticky',
  'ink',
  'text',
]);

/** Diz se o nó tem caixa. Linha, curva, seta e grupo não têm. */
export function isBoxShape(node: { readonly type: string }): node is BoxShapeNode {
  return BOX_SHAPE_TYPES.has(node.type);
}

/** As nove formas fechadas que aceitam `label`. */
export type LabelableNode =
  | RectangleNode
  | SquareNode
  | EllipseNode
  | CircleNode
  | DiamondNode
  | TriangleNode
  | PolygonNode
  | CrossNode
  | ChevronNode;

const LABELABLE_TYPES: ReadonlySet<string> = new Set<LabelableNode['type']>([
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'diamond',
  'triangle',
  'polygon',
  'cross',
  'chevron',
]);

/** A forma aceita `label`? Estreita o tipo para as nove formas elegíveis. */
export function isLabelable(node: { readonly type: string }): node is LabelableNode {
  return LABELABLE_TYPES.has(node.type);
}

/**
 * Nó do documento: shape primitivo ou grupo de nós.
 *
 * Esta união pode ganhar membros em versões futuras: ao tratá-la caso a caso, deixe um ramo
 * para o que não conhecer.
 */
export type CanvasNode = ShapeNode | GroupNode | BoardNode;

/** O nó é um board? Estreita o tipo para `BoardNode`. */
export function isBoardNode(node: CanvasNode): node is BoardNode {
  return node.type === 'board';
}

/**
 * Os campos de `T`, todos opcionais. `undefined` explícito vale como campo ausente, inclusive
 * para o consumidor que compila com `exactOptionalPropertyTypes`.
 */
export type Optional<T> = { readonly [Key in keyof T]?: T[Key] | undefined };

interface ShapeInputBase {
  /** Sem ID, o canvas gera um. */
  readonly id?: string | undefined;
  readonly visible?: boolean | undefined;
  readonly locked?: boolean | undefined;
  readonly metadata?: JsonObject | undefined;
}

interface BoxInput extends ShapeInputBase, BoxGeometry {
  /** Só os campos dados substituem o estilo padrão. */
  readonly style?: Optional<FillStrokeStyle> | undefined;
  /** Texto dentro da forma; os campos que faltam vêm de `DEFAULT_SHAPE_LABEL`. */
  readonly label?: Optional<ShapeLabel> | undefined;
}

export interface RectangleInput extends BoxInput {
  readonly type: 'rectangle';
}

export interface SquareInput extends BoxInput {
  readonly type: 'square';
}

export interface EllipseInput extends BoxInput {
  readonly type: 'ellipse';
}

export interface CircleInput extends BoxInput {
  readonly type: 'circle';
}

export interface DiamondInput extends BoxInput {
  readonly type: 'diamond';
}

export interface TriangleInput extends BoxInput {
  readonly type: 'triangle';
  readonly variant?: TriangleVariant | undefined;
  readonly apex?: number | undefined;
}

export interface PolygonInput extends BoxInput {
  readonly type: 'polygon';
  /** Inteiro de 3 a 12; o padrão é 5. */
  readonly sides?: number | undefined;
}

export interface CrossInput extends BoxInput {
  readonly type: 'cross';
  /** De 0,05 a 1; o padrão é 1/3. */
  readonly armRatio?: number | undefined;
}

export interface ChevronInput extends BoxInput {
  readonly type: 'chevron';
  /** O padrão é `right`. */
  readonly direction?: ChevronDirection | undefined;
  /** De 0 a 0,5; o padrão é 0,25. */
  readonly notchDepth?: number | undefined;
}

export interface BraceInput extends ShapeInputBase, BoxGeometry {
  readonly type: 'brace';
  /** O padrão é `left`. */
  readonly orientation?: BraceOrientation | undefined;
  /** De 0 a 1; o padrão é 0,5. */
  readonly tipPosition?: number | undefined;
  /** De 0 a 1; o padrão é 0,5. */
  readonly curvature?: number | undefined;
  /** Só os campos dados substituem o estilo padrão. A chave não tem `fill`. */
  readonly style?: Optional<StrokeStyle> | undefined;
}

export interface LineInput extends ShapeInputBase {
  readonly type: 'line';
  readonly start: Point;
  readonly end: Point;
  /** Só os campos dados substituem o estilo padrão. */
  readonly style?: Optional<StrokeStyle> | undefined;
}

/**
 * Curva nova. Sem controles, sai o arco padrão (US-06.1). Simétrica (o padrão) e com um
 * controle só, o outro é o espelho dele; com os dois, eles precisam ser espelhos.
 */
export interface BezierInput extends ShapeInputBase {
  readonly type: 'bezier';
  readonly start: Point;
  readonly end: Point;
  readonly control1?: Point | undefined;
  readonly control2?: Point | undefined;
  readonly symmetric?: boolean | undefined;
  /** Só os campos dados substituem o estilo padrão. */
  readonly style?: Optional<StrokeStyle> | undefined;
}

export interface TextInput extends ShapeInputBase {
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** Altura opcional na criação: se omitida, calculada automaticamente via layoutText. */
  readonly height?: number | undefined;
  readonly rotation?: number | undefined;
  readonly text: string;
  readonly fontSize?: number | undefined;
  /** O padrão é `auto`. */
  readonly fontSizeMode?: FontSizeMode | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontWeight?: FontWeight | undefined;
  readonly textAlign?: TextAlign | undefined;
  readonly lineHeight?: number | undefined;
  readonly style?: Optional<FillStrokeStyle> | undefined;
}

export interface StickyInput extends ShapeInputBase {
  readonly type: 'sticky';
  readonly x: number;
  readonly y: number;
  /** O padrão é 200. */
  readonly width?: number | undefined;
  /** O padrão é 200. */
  readonly height?: number | undefined;
  readonly rotation?: number | undefined;
  /** O padrão é vazio. */
  readonly text?: string | undefined;
  /** No modo `auto`, o core o recalcula. */
  readonly fontSize?: number | undefined;
  /** O padrão é `auto`. */
  readonly fontSizeMode?: FontSizeMode | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontWeight?: FontWeight | undefined;
  readonly textAlign?: TextAlign | undefined;
  readonly lineHeight?: number | undefined;
  /** Só os campos dados substituem o padrão: amarelo, sem contorno. `fill` nunca é nulo. */
  readonly style?: Optional<FillStrokeStyle> | undefined;
}

/**
 * Elemento de traços novo. Sem caixa, os pontos são de mundo e o core calcula a caixa (a
 * envolvente mais meia espessura) e normaliza. Com `x`, `y`, `width` e `height`, os pontos já são
 * locais, de 0 a 1; `rotation` só vale nesse caso.
 */
export interface InkInput extends ShapeInputBase {
  readonly type: 'ink';
  readonly strokes: readonly InkStrokeInput[];
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly rotation?: number | undefined;
  /** Só os campos dados substituem o padrão, opacidade 1. */
  readonly style?: Optional<InkStyle> | undefined;
}

export interface ArrowInput extends ShapeInputBase {
  readonly type: 'arrow';
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly startMarker?: ArrowMarkerType | undefined;
  readonly endMarker?: ArrowMarkerType | undefined;
  readonly style?: Optional<StrokeStyle> | undefined;
}

/** O board a criar: o comando cria o board vazio, e a pertença muda por `board.attach`. */
export interface BoardInput extends ShapeInputBase {
  readonly type: 'board';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Uma linha, de 1 a 200 caracteres, sem tags HTML. O padrão é o nome do tipo, com inicial maiúscula. */
  readonly title?: string | undefined;
  /** Só os campos dados substituem o estilo padrão. */
  readonly style?: Optional<BoardStyle> | undefined;
}

/** Shape a criar: a geometria é obrigatória; ID, visibilidade, bloqueio e estilo têm padrão. */
export type ShapeInput =
  | RectangleInput
  | SquareInput
  | EllipseInput
  | CircleInput
  | DiamondInput
  | TriangleInput
  | PolygonInput
  | CrossInput
  | ChevronInput
  | BraceInput
  | StickyInput
  | InkInput
  | LineInput
  | BezierInput
  | TextInput
  | ArrowInput
  | BoardInput;

/**
 * Alteração parcial de um shape: só os campos dados mudam. `x`, `y`, `width`, `height` e
 * `rotation` valem para retângulos, quadrados, elipses, círculos, losangos, triângulos, polígonos e texto; `type` permite conversão bidirecional
 * entre `rectangle` e `square` ou entre `ellipse` e `circle`; `variant` e `apex`, para triângulos; `sides`, para polígonos; `armRatio`, para cruzes; `direction` e `notchDepth`, para chevrons; `orientation`, `tipPosition` e `curvature`, para chaves; `start` e `end`, para linhas, setas e curvas; `control1`, `control2` e `symmetric`, para curvas Bézier
 * (simétrica, o controle que não vier é refeito como espelho do outro); `startMarker` e `endMarker`, para setas.
 * Campo que não pertence ao tipo do shape é recusado. O ID de um shape não muda.
 */
export interface ShapePatch {
  readonly type?: 'rectangle' | 'square' | 'ellipse' | 'circle' | undefined;
  readonly variant?: TriangleVariant | undefined;
  readonly apex?: number | undefined;
  readonly sides?: number | undefined;
  readonly armRatio?: number | undefined;
  readonly direction?: ChevronDirection | undefined;
  readonly notchDepth?: number | undefined;
  readonly orientation?: BraceOrientation | undefined;
  readonly tipPosition?: number | undefined;
  readonly curvature?: number | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly rotation?: number | undefined;
  readonly start?: Point | ArrowEndpoint | undefined;
  readonly end?: Point | ArrowEndpoint | undefined;
  readonly control1?: Point | undefined;
  readonly control2?: Point | undefined;
  readonly symmetric?: boolean | undefined;
  readonly startMarker?: ArrowMarkerType | undefined;
  readonly endMarker?: ArrowMarkerType | undefined;
  readonly text?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontSizeMode?: FontSizeMode | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontWeight?: FontWeight | undefined;
  readonly textAlign?: TextAlign | undefined;
  readonly lineHeight?: number | undefined;
  /** Só no `ink`: a lista inteira de traços, com pontos locais. Substitui a atual. */
  readonly strokes?: readonly InkStroke[] | undefined;
  /** Só no `board`: o título, de 1 a 200 caracteres, sem quebra de linha nem tags HTML. */
  readonly title?: string | undefined;
  /**
   * Só os campos dados substituem os do estilo atual. Linha e seta não têm `fill`. No `board`,
   * valem só `fill`, `fillOpacity` e `stroke`.
   */
  readonly style?: Optional<FillStrokeStyle> | Optional<BoardStyle> | undefined;
  readonly visible?: boolean | undefined;
  readonly locked?: boolean | undefined;
  /** Substitui o metadata inteiro; `null` o remove. */
  readonly metadata?: JsonObject | null | undefined;
  /**
   * Só nas nove formas fechadas: os campos dados são mesclados sobre o `label` atual (ou sobre
   * os padrões, na primeira vez), e `null` remove o texto.
   */
  readonly label?: Optional<ShapeLabel> | null | undefined;
}

/** Monta o nó quando o ID é conhecido. O ID só é gerado depois que a entrada inteira passou. */
export type ShapeFactory = (id: string) => ShapeNode;

const DEFAULT_STROKE_STYLE: StrokeStyle = { stroke: '#000000', strokeWidth: 1, opacity: 1 };
const DEFAULT_FILL_STROKE_STYLE: FillStrokeStyle = { fill: '#ffffff', ...DEFAULT_STROKE_STYLE };
const DEFAULT_TEXT_STYLE: FillStrokeStyle = {
  fill: '#000000',
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
};

const DEFAULT_INK_STYLE: InkStyle = { opacity: 1 };

const DEFAULT_STICKY_STYLE: FillStrokeStyle = {
  fill: STICKY_COLORS.yellow,
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
};

/**
 * A cor da nota é `style.fill` e não pode faltar. Uma cor inválida já foi recusada pela leitura
 * do estilo (`issuesBefore` é o tamanho da lista antes dela): não se acrescenta um segundo problema.
 */
function requireStickyFill(
  style: FillStrokeStyle,
  stylePath: Path,
  issues: ValidationIssue[],
  issuesBefore: number,
): void {
  if (style.fill === null && issues.length === issuesBefore) {
    report(issues, at(stylePath, 'fill'), 'type', 'must be a color');
  }
}

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'sans-serif';
const DEFAULT_FONT_WEIGHT: FontWeight = 'normal';
const DEFAULT_TEXT_ALIGN: TextAlign = 'left';
const DEFAULT_LINE_HEIGHT = 1.25;

const TAU = 2 * Math.PI;

/** Leva um ângulo em radianos para `[-π, π)`. */
export function normalizeRotation(rotation: number): number {
  if (rotation >= -Math.PI && rotation < Math.PI) return rotation;
  // Só soma, produto e arredondamento: o resultado é o mesmo em qualquer motor JavaScript.
  const angle = rotation - Math.floor((rotation + Math.PI) / TAU) * TAU;
  // O arredondamento pode deixar o resultado um passo fora da faixa, sempre junto de ±π.
  return angle >= -Math.PI && angle < Math.PI ? angle : -Math.PI;
}

const rotation: Check<number> = (value, path, issues) =>
  normalizeRotation(finite(value, path, issues));

const point: Check<Point> = (value, path, issues) => {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be a point with x and y');
    return { x: 0, y: 0 };
  }
  rejectUnknownKeys(value, ['x', 'y'], path, issues);
  return readAll(value, { x: finite, y: finite }, path, issues);
};

const textCheck: Check<string> = (value, path, issues) => {
  if (typeof value !== 'string') {
    report(issues, path, 'type', 'must be a string');
    return '';
  }
  if (containsHtmlTags(value)) {
    report(issues, path, 'format', 'must not contain HTML tags');
  }
  return value;
};

const fontSizeModeCheck: Check<FontSizeMode> = (value, path, issues) => {
  if (value === 'auto' || value === 'fixed') return value;
  report(issues, path, 'format', 'must be "auto" or "fixed"');
  return 'auto';
};

const fontWeightCheck: Check<FontWeight> = (value, path, issues) => {
  if (value === 'normal' || value === 'bold') {
    return value;
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 900 &&
    value % 100 === 0
  ) {
    return value as FontWeight;
  }
  report(
    issues,
    path,
    'range',
    'must be "normal", "bold" or an integer from 100 to 900 in multiples of 100',
  );
  return 'normal';
};

const textAlignCheck: Check<TextAlign> = (value, path, issues) => {
  if (value === 'left' || value === 'center' || value === 'right') {
    return value;
  }
  report(issues, path, 'format', 'must be "left", "center" or "right"');
  return 'left';
};

const BOX_GEOMETRY = { x: finite, y: finite, width: positive, height: positive, rotation };
const LINE_GEOMETRY = { start: point, end: point };
const BEZIER_CONTROLS = { control1: point, control2: point };
const BEZIER_GEOMETRY = { ...LINE_GEOMETRY, ...BEZIER_CONTROLS };
const STROKE_STYLE = { stroke: colorOrNull, strokeWidth: nonNegative, opacity: unitInterval };
const FILL_STROKE_STYLE = { fill: colorOrNull, ...STROKE_STYLE };
export const FLAGS = { visible: boolean, locked: boolean };

const COMMON_PATCH_KEYS = ['style', 'visible', 'locked', 'metadata'];
const BOX_PATCH_KEYS = [...COMMON_PATCH_KEYS, ...Object.keys(BOX_GEOMETRY)];
// As formas com `label` têm as chaves das caixas mais `label`; as demais caixas (chave, tinta,
// nota) seguem com `BOX_PATCH_KEYS` e recusam a chave.
const LABELABLE_BOX_PATCH_KEYS = [...BOX_PATCH_KEYS, 'label'];
const LABELABLE_BOX_INPUT_KEYS = ['type', 'id', ...LABELABLE_BOX_PATCH_KEYS];
const LABELABLE_BOX_TYPE_CONVERTIBLE_KEYS = [...LABELABLE_BOX_PATCH_KEYS, 'type'];
const TRIANGLE_PATCH_KEYS = [...BOX_PATCH_KEYS, 'variant', 'apex', 'label'];
const POLYGON_PATCH_KEYS = [...BOX_PATCH_KEYS, 'sides', 'label'];
const CROSS_PATCH_KEYS = [...BOX_PATCH_KEYS, 'armRatio', 'label'];
const CHEVRON_PATCH_KEYS = [...BOX_PATCH_KEYS, 'direction', 'notchDepth', 'label'];
const BRACE_PATCH_KEYS = [...BOX_PATCH_KEYS, 'orientation', 'tipPosition', 'curvature'];
const LINE_PATCH_KEYS = [...COMMON_PATCH_KEYS, ...Object.keys(LINE_GEOMETRY)];
const BEZIER_PATCH_KEYS = [...COMMON_PATCH_KEYS, ...Object.keys(BEZIER_GEOMETRY), 'symmetric'];
const TEXT_PATCH_KEYS = [
  ...COMMON_PATCH_KEYS,
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'text',
  'fontSize',
  'fontSizeMode',
  'fontFamily',
  'fontWeight',
  'textAlign',
  'lineHeight',
];
const INK_STYLE = { opacity: unitInterval };
const INK_PATCH_KEYS = [...BOX_PATCH_KEYS, 'strokes'];
const STICKY_PATCH_KEYS = [
  ...BOX_PATCH_KEYS,
  'text',
  'fontSize',
  'fontSizeMode',
  'fontFamily',
  'fontWeight',
  'textAlign',
  'lineHeight',
];
const ARROW_PATCH_KEYS = [...COMMON_PATCH_KEYS, 'start', 'end', 'startMarker', 'endMarker'];
const TRIANGLE_INPUT_KEYS = ['type', 'id', ...TRIANGLE_PATCH_KEYS];
const POLYGON_INPUT_KEYS = ['type', 'id', ...POLYGON_PATCH_KEYS];
const CROSS_INPUT_KEYS = ['type', 'id', ...CROSS_PATCH_KEYS];
const CHEVRON_INPUT_KEYS = ['type', 'id', ...CHEVRON_PATCH_KEYS];
const BRACE_INPUT_KEYS = ['type', 'id', ...BRACE_PATCH_KEYS];
const LINE_INPUT_KEYS = ['type', 'id', ...LINE_PATCH_KEYS];
const BEZIER_INPUT_KEYS = ['type', 'id', ...BEZIER_PATCH_KEYS];
const TEXT_INPUT_KEYS = ['type', 'id', ...TEXT_PATCH_KEYS];
const ARROW_INPUT_KEYS = ['type', 'id', ...ARROW_PATCH_KEYS];
const STICKY_INPUT_KEYS = ['type', 'id', ...STICKY_PATCH_KEYS];
const INK_INPUT_KEYS = ['type', 'id', ...INK_PATCH_KEYS];

const EQUILATERAL_HEIGHT_RATIO = Math.sqrt(3) / 2;
const EQUILATERAL_ASPECT_RATIO = 2 / Math.sqrt(3);

const triangleVariantCheck: Check<TriangleVariant> = (value, path, issues) => {
  if (
    value === 'equilateral' ||
    value === 'isosceles' ||
    value === 'right' ||
    value === 'scalene'
  ) {
    return value;
  }
  report(issues, path, 'format', 'must be "equilateral", "isosceles", "right" or "scalene"');
  return 'isosceles';
};

const triangleApexCheck: Check<number> = (value, path, issues) => {
  const before = issues.length;
  const num = finite(value, path, issues);
  if (issues.length === before && (num < 0 || num > 1)) {
    report(issues, path, 'invalid-geometry', 'triangle apex must be between 0 and 1');
  }
  return num;
};

const MIN_POLYGON_SIDES = 3;
const MAX_POLYGON_SIDES = 12;
const DEFAULT_POLYGON_SIDES = 5;

const polygonSidesCheck: Check<number> = (value, path, issues) => {
  const before = issues.length;
  const sides = finite(value, path, issues);
  if (
    issues.length === before &&
    !(Number.isInteger(sides) && sides >= MIN_POLYGON_SIDES && sides <= MAX_POLYGON_SIDES)
  ) {
    report(
      issues,
      path,
      'range',
      `must be an integer from ${MIN_POLYGON_SIDES} to ${MAX_POLYGON_SIDES}`,
    );
  }
  return sides;
};

const MIN_CROSS_ARM_RATIO = 0.05;
const MAX_CROSS_ARM_RATIO = 1;
const DEFAULT_CROSS_ARM_RATIO = 1 / 3;

const crossArmRatioCheck: Check<number> = (value, path, issues) => {
  const before = issues.length;
  const ratio = finite(value, path, issues);
  if (issues.length === before && (ratio < MIN_CROSS_ARM_RATIO || ratio > MAX_CROSS_ARM_RATIO)) {
    report(issues, path, 'range', `must be from ${MIN_CROSS_ARM_RATIO} to ${MAX_CROSS_ARM_RATIO}`);
  }
  return ratio;
};

const MAX_CHEVRON_NOTCH_DEPTH = 0.5;
const DEFAULT_CHEVRON_NOTCH_DEPTH = 0.25;

const chevronDirectionCheck: Check<ChevronDirection> = (value, path, issues) => {
  if (value === 'right' || value === 'left' || value === 'up' || value === 'down') return value;
  report(issues, path, 'format', 'must be "right", "left", "up" or "down"');
  return 'right';
};

const chevronNotchDepthCheck: Check<number> = (value, path, issues) => {
  const before = issues.length;
  const depth = finite(value, path, issues);
  if (issues.length === before && (depth < 0 || depth > MAX_CHEVRON_NOTCH_DEPTH)) {
    report(issues, path, 'range', `must be from 0 to ${MAX_CHEVRON_NOTCH_DEPTH}`);
  }
  return depth;
};

const DEFAULT_BRACE_TIP_POSITION = 0.5;
const DEFAULT_BRACE_CURVATURE = 0.5;

const braceOrientationCheck: Check<BraceOrientation> = (value, path, issues) => {
  if (value === 'left' || value === 'right' || value === 'up' || value === 'down') return value;
  report(issues, path, 'format', 'must be "left", "right", "up" or "down"');
  return 'left';
};

function checkSquareBox(
  type: 'square' | 'circle' | 'polygon',
  box: { readonly width: number; readonly height: number },
  path: Path,
  issues: ValidationIssue[],
): void {
  if (Math.abs(box.width - box.height) >= 1e-6) {
    report(issues, path, 'invalid-geometry', `${type} width and height must be equal`);
  }
}

function defaultTriangleApex(variant: TriangleVariant): number {
  if (variant === 'right') return 0;
  if (variant === 'scalene') return 0.3;
  return 0.5;
}

function validateTriangleInvariants(
  variant: TriangleVariant,
  apex: number,
  width: number,
  height: number,
  path: Path,
  issues: ValidationIssue[],
): void {
  if ((variant === 'isosceles' || variant === 'equilateral') && Math.abs(apex - 0.5) >= 1e-6) {
    report(issues, path, 'invalid-geometry', `${variant} triangle apex must be 0.5`);
  }
  if (variant === 'right' && Math.abs(apex) >= 1e-6) {
    report(issues, path, 'invalid-geometry', 'right triangle apex must be 0');
  }
  if (
    variant === 'equilateral' &&
    Math.abs(height - width * EQUILATERAL_HEIGHT_RATIO) >= 1e-6 * Math.max(1, width)
  ) {
    report(
      issues,
      path,
      'invalid-geometry',
      'equilateral triangle height must equal width * sqrt(3) / 2',
    );
  }
}

const arrowMarkerCheck: Check<ArrowMarkerType> = (value, path, issues) => {
  if (value === 'none' || value === 'arrow' || value === 'dot') {
    return value;
  }
  report(issues, path, 'format', 'must be "none", "arrow" or "dot"');
  return 'none';
};

const endpointCheck: Check<ArrowEndpoint> = (value, path, issues) => {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an endpoint object');
    return { x: 0, y: 0 };
  }
  if ('targetId' in value) {
    rejectUnknownKeys(value, ['targetId', 'anchor'], path, issues);
    const targetId = nonEmptyString(value['targetId'], at(path, 'targetId'), issues);
    const anchor = point(value['anchor'], at(path, 'anchor'), issues);
    return { targetId, anchor };
  }
  rejectUnknownKeys(value, ['x', 'y'], path, issues);
  return readAll(value, { x: finite, y: finite }, path, issues);
};

const LABEL_KEYS = [
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'color',
  'textAlign',
  'verticalAlign',
];

/**
 * Lê o `label` de uma entrada: os campos que faltam vêm de `DEFAULT_SHAPE_LABEL`, e uma chave
 * desconhecida ou um valor inválido vai para `issues`. Sem `label`, devolve `undefined`.
 */
function readLabelInput(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): ShapeLabel | undefined {
  const value = input['label'];
  if (value === undefined) return undefined;
  const labelPath = at(path, 'label');
  if (!isRecord(value)) {
    report(issues, labelPath, 'type', 'must be an object');
    return undefined;
  }
  rejectUnknownKeys(value, LABEL_KEYS, labelPath, issues);
  const pick = <T>(key: string, check: Check<T>, fallback: T): T =>
    value[key] === undefined ? fallback : check(value[key], at(labelPath, key), issues);
  const defaults = DEFAULT_SHAPE_LABEL;
  return {
    text: pick('text', textCheck, defaults.text),
    fontSize: pick('fontSize', positive, defaults.fontSize),
    fontFamily: pick('fontFamily', nonEmptyString, defaults.fontFamily),
    fontWeight: pick('fontWeight', fontWeightCheck, defaults.fontWeight),
    color: pick('color', colorOrNull, defaults.color),
    textAlign: pick('textAlign', textAlignCheck, defaults.textAlign),
    verticalAlign: pick('verticalAlign', verticalAlignCheck, defaults.verticalAlign),
  };
}

/** O fragmento que põe `label` no nó só quando ele existe (sem a chave com `undefined`). */
function withLabel(label: ShapeLabel | undefined): { readonly label?: ShapeLabel } {
  return label === undefined ? {} : { label };
}

/**
 * Confere o `label` de um documento carregado: os sete campos são obrigatórios, e chave
 * desconhecida é recusada. Sem `label`, devolve `undefined`.
 */
function readStoredLabel(
  value: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): ShapeLabel | undefined {
  const label = value['label'];
  if (label === undefined) return undefined;
  const labelPath = at(path, 'label');
  if (!isRecord(label)) {
    report(issues, labelPath, 'type', 'must be an object');
    return undefined;
  }
  rejectUnknownKeys(label, LABEL_KEYS, labelPath, issues);
  return {
    text: textCheck(label['text'], at(labelPath, 'text'), issues),
    fontSize: positive(label['fontSize'], at(labelPath, 'fontSize'), issues),
    fontFamily: nonEmptyString(label['fontFamily'], at(labelPath, 'fontFamily'), issues),
    fontWeight: fontWeightCheck(label['fontWeight'], at(labelPath, 'fontWeight'), issues),
    color: colorOrNull(label['color'], at(labelPath, 'color'), issues),
    textAlign: textAlignCheck(label['textAlign'], at(labelPath, 'textAlign'), issues),
    verticalAlign: verticalAlignCheck(
      label['verticalAlign'],
      at(labelPath, 'verticalAlign'),
      issues,
    ),
  };
}

export function readStyle<S extends Readonly<Record<string, Check<unknown>>>>(
  value: unknown,
  spec: S,
  path: Path,
  issues: ValidationIssue[],
): Partial<{ -readonly [Key in keyof S]: ReturnType<S[Key]> }> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object');
    return {};
  }
  rejectUnknownKeys(value, Object.keys(spec), path, issues);
  return readSome(value, spec, path, issues);
}

export function readMetadata(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): { metadata?: JsonObject } {
  const value = input['metadata'];
  return value === undefined ? {} : { metadata: jsonObject(value, at(path, 'metadata'), issues) };
}

function sameSpot(start: Point, end: Point): boolean {
  return start.x === end.x && start.y === end.y;
}

/**
 * Pontas distintas e, na curva simétrica, `control2` espelho de `control1` com folga
 * `1e-6·max(1, corda)`.
 */
function checkBezier(curve: BezierGeometry, path: Path, issues: ValidationIssue[]): void {
  if (sameSpot(curve.start, curve.end)) {
    report(issues, path, 'zero-length', 'start and end must differ');
    return;
  }
  if (!curve.symmetric) return;
  const mirrored = mirrorControl(curve.start, curve.end, curve.control1);
  const chord = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y);
  if (
    Math.hypot(mirrored.x - curve.control2.x, mirrored.y - curve.control2.y) >=
    1e-6 * Math.max(1, chord)
  ) {
    report(
      issues,
      path,
      'invalid-geometry',
      'symmetric bezier control2 must mirror control1 across the perpendicular bisector of the chord',
    );
  }
}

type BezierGeometry = Pick<BezierNode, 'start' | 'control1' | 'control2' | 'end' | 'symmetric'>;

/**
 * Confere a entrada de um shape novo e materializa os padrões. Devolve a fábrica do nó, ou
 * `undefined` quando o tipo é desconhecido. Os problemas vão para `issues`.
 */
export function readShapeInput(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): ShapeFactory | undefined {
  const type = input['type'];
  const stylePath = at(path, 'style');
  const flags = { visible: true, locked: false, ...readSome(input, FLAGS, path, issues) };
  const metadata = readMetadata(input, path, issues);

  if (type === 'rectangle' || type === 'ellipse' || type === 'diamond') {
    rejectUnknownKeys(input, LABELABLE_BOX_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({ id, type, ...geometry, ...flags, style, ...label, ...metadata });
  }

  if (type === 'square' || type === 'circle') {
    rejectUnknownKeys(input, LABELABLE_BOX_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    checkSquareBox(type, geometry, path, issues);
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({ id, type, ...geometry, ...flags, style, ...label, ...metadata });
  }

  if (type === 'triangle') {
    rejectUnknownKeys(input, TRIANGLE_INPUT_KEYS, path, issues);
    const before = issues.length;
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    const variant: TriangleVariant =
      input['variant'] === undefined
        ? 'isosceles'
        : triangleVariantCheck(input['variant'], at(path, 'variant'), issues);
    const apex: number =
      input['apex'] === undefined
        ? defaultTriangleApex(variant)
        : triangleApexCheck(input['apex'], at(path, 'apex'), issues);
    if (issues.length === before) {
      validateTriangleInvariants(variant, apex, geometry.width, geometry.height, path, issues);
    }
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({
      id,
      type,
      variant,
      apex,
      ...geometry,
      ...flags,
      style,
      ...label,
      ...metadata,
    });
  }

  if (type === 'polygon') {
    rejectUnknownKeys(input, POLYGON_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    checkSquareBox(type, geometry, path, issues);
    const sides =
      input['sides'] === undefined
        ? DEFAULT_POLYGON_SIDES
        : polygonSidesCheck(input['sides'], at(path, 'sides'), issues);
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({ id, type, sides, ...geometry, ...flags, style, ...label, ...metadata });
  }

  if (type === 'cross') {
    rejectUnknownKeys(input, CROSS_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    const armRatio =
      input['armRatio'] === undefined
        ? DEFAULT_CROSS_ARM_RATIO
        : crossArmRatioCheck(input['armRatio'], at(path, 'armRatio'), issues);
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({ id, type, armRatio, ...geometry, ...flags, style, ...label, ...metadata });
  }

  if (type === 'chevron') {
    rejectUnknownKeys(input, CHEVRON_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    const direction =
      input['direction'] === undefined
        ? 'right'
        : chevronDirectionCheck(input['direction'], at(path, 'direction'), issues);
    const notchDepth =
      input['notchDepth'] === undefined
        ? DEFAULT_CHEVRON_NOTCH_DEPTH
        : chevronNotchDepthCheck(input['notchDepth'], at(path, 'notchDepth'), issues);
    const style = {
      ...DEFAULT_FILL_STROKE_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const label = withLabel(readLabelInput(input, path, issues));
    return (id) => ({
      id,
      type,
      direction,
      notchDepth,
      ...geometry,
      ...flags,
      style,
      ...label,
      ...metadata,
    });
  }

  if (type === 'brace') {
    rejectUnknownKeys(input, BRACE_INPUT_KEYS, path, issues);
    const geometry = readAll(input, BOX_GEOMETRY, path, issues);
    const orientation =
      input['orientation'] === undefined
        ? 'left'
        : braceOrientationCheck(input['orientation'], at(path, 'orientation'), issues);
    const tipPosition =
      input['tipPosition'] === undefined
        ? DEFAULT_BRACE_TIP_POSITION
        : unitInterval(input['tipPosition'], at(path, 'tipPosition'), issues);
    const curvature =
      input['curvature'] === undefined
        ? DEFAULT_BRACE_CURVATURE
        : unitInterval(input['curvature'], at(path, 'curvature'), issues);
    const style = {
      ...DEFAULT_STROKE_STYLE,
      ...readStyle(input['style'], STROKE_STYLE, stylePath, issues),
    };
    return (id) => ({
      id,
      type,
      orientation,
      tipPosition,
      curvature,
      ...geometry,
      ...flags,
      style,
      ...metadata,
    });
  }

  if (type === 'line') {
    rejectUnknownKeys(input, LINE_INPUT_KEYS, path, issues);
    const before = issues.length;
    const geometry = readAll(input, LINE_GEOMETRY, path, issues);
    if (issues.length === before && sameSpot(geometry.start, geometry.end)) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }
    const style = {
      ...DEFAULT_STROKE_STYLE,
      ...readStyle(input['style'], STROKE_STYLE, stylePath, issues),
    };
    return (id) => ({ id, type, ...geometry, ...flags, style, ...metadata });
  }

  if (type === 'bezier') {
    rejectUnknownKeys(input, BEZIER_INPUT_KEYS, path, issues);
    const before = issues.length;
    const { start, end } = readAll(input, LINE_GEOMETRY, path, issues);
    const given = readSome(input, BEZIER_CONTROLS, path, issues);
    const symmetric =
      input['symmetric'] === undefined
        ? true
        : boolean(input['symmetric'], at(path, 'symmetric'), issues);
    let { control1, control2 } = given;
    if (symmetric && control1 !== undefined && control2 === undefined) {
      control2 = mirrorControl(start, end, control1);
    } else if (symmetric && control1 === undefined && control2 !== undefined) {
      control1 = mirrorControl(start, end, control2);
    }
    const fallback = defaultBezierControls(start, end);
    const curve: BezierGeometry = {
      start,
      control1: control1 ?? fallback.control1,
      control2: control2 ?? fallback.control2,
      end,
      symmetric,
    };
    if (issues.length === before) checkBezier(curve, path, issues);
    const style = {
      ...DEFAULT_STROKE_STYLE,
      ...readStyle(input['style'], STROKE_STYLE, stylePath, issues),
    };
    return (id) => ({ id, type, ...curve, ...flags, style, ...metadata });
  }

  if (type === 'text') {
    rejectUnknownKeys(input, TEXT_INPUT_KEYS, path, issues);
    const x = finite(input['x'], at(path, 'x'), issues);
    const y = finite(input['y'], at(path, 'y'), issues);
    const width = positive(input['width'], at(path, 'width'), issues);
    const rotationVal =
      input['rotation'] === undefined
        ? 0
        : rotation(input['rotation'], at(path, 'rotation'), issues);
    const text = textCheck(input['text'], at(path, 'text'), issues);
    const fontSize =
      input['fontSize'] === undefined
        ? DEFAULT_FONT_SIZE
        : positive(input['fontSize'], at(path, 'fontSize'), issues);
    const fontSizeMode =
      input['fontSizeMode'] === undefined
        ? 'auto'
        : fontSizeModeCheck(input['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const fontFamily =
      input['fontFamily'] === undefined
        ? DEFAULT_FONT_FAMILY
        : nonEmptyString(input['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight =
      input['fontWeight'] === undefined
        ? DEFAULT_FONT_WEIGHT
        : fontWeightCheck(input['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign =
      input['textAlign'] === undefined
        ? DEFAULT_TEXT_ALIGN
        : textAlignCheck(input['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight =
      input['lineHeight'] === undefined
        ? DEFAULT_LINE_HEIGHT
        : positive(input['lineHeight'], at(path, 'lineHeight'), issues);

    let height: number;
    if (input['height'] !== undefined) {
      height = positive(input['height'], at(path, 'height'), issues);
    } else {
      height = layoutText(text, {
        fontSize,
        fontFamily,
        fontWeight,
        lineHeight,
        maxWidth: width > 0 ? width : undefined,
      }).height;
    }

    const style = {
      ...DEFAULT_TEXT_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    return (id) => ({
      id,
      type,
      x,
      y,
      width,
      height,
      rotation: rotationVal,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
      ...metadata,
    });
  }

  if (type === 'sticky') {
    rejectUnknownKeys(input, STICKY_INPUT_KEYS, path, issues);
    const x = finite(input['x'], at(path, 'x'), issues);
    const y = finite(input['y'], at(path, 'y'), issues);
    const width =
      input['width'] === undefined
        ? DEFAULT_STICKY_SIZE
        : positive(input['width'], at(path, 'width'), issues);
    const height =
      input['height'] === undefined
        ? DEFAULT_STICKY_SIZE
        : positive(input['height'], at(path, 'height'), issues);
    const rotationVal =
      input['rotation'] === undefined
        ? 0
        : rotation(input['rotation'], at(path, 'rotation'), issues);
    const text =
      input['text'] === undefined ? '' : textCheck(input['text'], at(path, 'text'), issues);
    const fontSizeMode =
      input['fontSizeMode'] === undefined
        ? 'auto'
        : fontSizeModeCheck(input['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const givenFontSize =
      input['fontSize'] === undefined
        ? DEFAULT_FONT_SIZE
        : positive(input['fontSize'], at(path, 'fontSize'), issues);
    const fontFamily =
      input['fontFamily'] === undefined
        ? DEFAULT_FONT_FAMILY
        : nonEmptyString(input['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight =
      input['fontWeight'] === undefined
        ? DEFAULT_FONT_WEIGHT
        : fontWeightCheck(input['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign =
      input['textAlign'] === undefined
        ? DEFAULT_TEXT_ALIGN
        : textAlignCheck(input['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight =
      input['lineHeight'] === undefined
        ? DEFAULT_LINE_HEIGHT
        : positive(input['lineHeight'], at(path, 'lineHeight'), issues);
    const issuesBeforeStyle = issues.length;
    const style = {
      ...DEFAULT_STICKY_STYLE,
      ...readStyle(input['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    requireStickyFill(style, stylePath, issues, issuesBeforeStyle);
    // No modo automático o tamanho vem do ajuste, não da entrada.
    const fontSize =
      fontSizeMode === 'auto'
        ? fitStickyFontSize({ text, width, height, fontFamily, fontWeight, lineHeight })
        : givenFontSize;
    return (id) => ({
      id,
      type,
      x,
      y,
      width,
      height,
      rotation: rotationVal,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
      ...metadata,
    });
  }

  if (type === 'ink') {
    rejectUnknownKeys(input, INK_INPUT_KEYS, path, issues);
    const strokesPath = at(path, 'strokes');
    const style = {
      ...DEFAULT_INK_STYLE,
      ...readStyle(input['style'], INK_STYLE, stylePath, issues),
    };
    const boxKeys = ['x', 'y', 'width', 'height'] as const;
    if (boxKeys.some((key) => input[key] !== undefined)) {
      // Caixa explícita: os pontos já são locais.
      const geometry = {
        x: finite(input['x'], at(path, 'x'), issues),
        y: finite(input['y'], at(path, 'y'), issues),
        width: positive(input['width'], at(path, 'width'), issues),
        height: positive(input['height'], at(path, 'height'), issues),
        rotation:
          input['rotation'] === undefined
            ? 0
            : rotation(input['rotation'], at(path, 'rotation'), issues),
      };
      const strokes = readInkStrokes(input['strokes'], strokesPath, issues, 'local-input');
      return (id) => ({ id, type, ...geometry, strokes, ...flags, style, ...metadata });
    }
    if (input['rotation'] !== undefined) {
      report(
        issues,
        at(path, 'rotation'),
        'invalid-geometry',
        'rotation needs an explicit box (x, y, width and height)',
      );
    }
    const before = issues.length;
    const world = readInkStrokes(input['strokes'], strokesPath, issues, 'world');
    const { box, strokes } = normalizeInkStrokes(world);
    if (issues.length === before && !Object.values(box).every(Number.isFinite)) {
      report(issues, strokesPath, 'range', 'points are too far apart to fit one box');
    }
    return (id) => ({ id, type, ...box, strokes, ...flags, style, ...metadata });
  }

  if (type === 'arrow') {
    rejectUnknownKeys(input, ARROW_INPUT_KEYS, path, issues);
    const start = endpointCheck(input['start'], at(path, 'start'), issues);
    const end = endpointCheck(input['end'], at(path, 'end'), issues);
    const startMarker =
      input['startMarker'] === undefined
        ? 'none'
        : arrowMarkerCheck(input['startMarker'], at(path, 'startMarker'), issues);
    const endMarker =
      input['endMarker'] === undefined
        ? 'arrow'
        : arrowMarkerCheck(input['endMarker'], at(path, 'endMarker'), issues);

    if (isZeroLengthArrow({ start, end })) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }

    const style = {
      ...DEFAULT_STROKE_STYLE,
      ...readStyle(input['style'], STROKE_STYLE, stylePath, issues),
    };
    return (id) => ({
      id,
      type,
      start,
      end,
      startMarker,
      endMarker,
      ...flags,
      style,
      ...metadata,
    });
  }

  report(
    issues,
    at(path, 'type'),
    'unknown-type',
    'must be rectangle, square, ellipse, circle, diamond, triangle, polygon, cross, chevron, brace, sticky, ink, line, bezier, text or arrow',
  );
  return undefined;
}

export function readStoredStyle<S extends Readonly<Record<string, Check<unknown>>>>(
  value: unknown,
  spec: S,
  path: Path,
  issues: ValidationIssue[],
): { -readonly [Key in keyof S]: ReturnType<S[Key]> } {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object');
    // Marcador: com o problema registrado, o nó é descartado por quem chamou.
    return readAll({}, spec, path, []);
  }
  rejectUnknownKeys(value, Object.keys(spec), path, issues);
  return readAll(value, spec, path, issues);
}

/**
 * Confere um shape já materializado, como o de um documento carregado: todo campo é
 * obrigatório, menos `metadata`. Devolve uma cópia normalizada, ou `undefined` quando o tipo é
 * desconhecido. Os problemas vão para `issues`.
 */
export function readStoredShape(
  value: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): CanvasNode | undefined {
  const type = value['type'];
  const stylePath = at(path, 'style');
  const id = nonEmptyString(value['id'], at(path, 'id'), issues);
  const flags = readAll(value, FLAGS, path, issues);
  const metadata = readMetadata(value, path, issues);

  if (type === 'rectangle' || type === 'ellipse' || type === 'diamond') {
    rejectUnknownKeys(value, LABELABLE_BOX_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return { id, type, ...geometry, ...flags, style, ...label, ...metadata };
  }

  if (type === 'square' || type === 'circle') {
    rejectUnknownKeys(value, LABELABLE_BOX_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    checkSquareBox(type, geometry, path, issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return { id, type, ...geometry, ...flags, style, ...label, ...metadata };
  }

  if (type === 'triangle') {
    rejectUnknownKeys(value, TRIANGLE_INPUT_KEYS, path, issues);
    const before = issues.length;
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const variant = triangleVariantCheck(value['variant'], at(path, 'variant'), issues);
    const apex = triangleApexCheck(value['apex'], at(path, 'apex'), issues);
    if (issues.length === before) {
      validateTriangleInvariants(variant, apex, geometry.width, geometry.height, path, issues);
    }
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return {
      id,
      type,
      variant,
      apex,
      ...geometry,
      ...flags,
      style,
      ...label,
      ...metadata,
    };
  }

  if (type === 'polygon') {
    rejectUnknownKeys(value, POLYGON_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    checkSquareBox(type, geometry, path, issues);
    const sides = polygonSidesCheck(value['sides'], at(path, 'sides'), issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return { id, type, sides, ...geometry, ...flags, style, ...label, ...metadata };
  }

  if (type === 'cross') {
    rejectUnknownKeys(value, CROSS_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const armRatio = crossArmRatioCheck(value['armRatio'], at(path, 'armRatio'), issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return { id, type, armRatio, ...geometry, ...flags, style, ...label, ...metadata };
  }

  if (type === 'chevron') {
    rejectUnknownKeys(value, CHEVRON_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const direction = chevronDirectionCheck(value['direction'], at(path, 'direction'), issues);
    const notchDepth = chevronNotchDepthCheck(value['notchDepth'], at(path, 'notchDepth'), issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    const label = withLabel(readStoredLabel(value, path, issues));
    return { id, type, direction, notchDepth, ...geometry, ...flags, style, ...label, ...metadata };
  }

  if (type === 'brace') {
    rejectUnknownKeys(value, BRACE_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const orientation = braceOrientationCheck(
      value['orientation'],
      at(path, 'orientation'),
      issues,
    );
    const tipPosition = unitInterval(value['tipPosition'], at(path, 'tipPosition'), issues);
    const curvature = unitInterval(value['curvature'], at(path, 'curvature'), issues);
    const style = readStoredStyle(value['style'], STROKE_STYLE, stylePath, issues);
    return {
      id,
      type,
      orientation,
      tipPosition,
      curvature,
      ...geometry,
      ...flags,
      style,
      ...metadata,
    };
  }

  if (type === 'line') {
    rejectUnknownKeys(value, LINE_INPUT_KEYS, path, issues);
    const before = issues.length;
    const geometry = readAll(value, LINE_GEOMETRY, path, issues);
    if (issues.length === before && sameSpot(geometry.start, geometry.end)) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }
    const style = readStoredStyle(value['style'], STROKE_STYLE, stylePath, issues);
    return { id, type, ...geometry, ...flags, style, ...metadata };
  }

  if (type === 'bezier') {
    rejectUnknownKeys(value, BEZIER_INPUT_KEYS, path, issues);
    const before = issues.length;
    const geometry = readAll(value, BEZIER_GEOMETRY, path, issues);
    const symmetric = boolean(value['symmetric'], at(path, 'symmetric'), issues);
    const curve: BezierGeometry = { ...geometry, symmetric };
    if (issues.length === before) checkBezier(curve, path, issues);
    const style = readStoredStyle(value['style'], STROKE_STYLE, stylePath, issues);
    return { id, type, ...curve, ...flags, style, ...metadata };
  }

  if (type === 'text') {
    rejectUnknownKeys(value, TEXT_INPUT_KEYS, path, issues);
    const x = finite(value['x'], at(path, 'x'), issues);
    const y = finite(value['y'], at(path, 'y'), issues);
    const width = positive(value['width'], at(path, 'width'), issues);
    const height = positive(value['height'], at(path, 'height'), issues);
    const rotationVal = rotation(value['rotation'], at(path, 'rotation'), issues);
    const text = textCheck(value['text'], at(path, 'text'), issues);
    const fontSize = positive(value['fontSize'], at(path, 'fontSize'), issues);
    // Documentos gravados antes do campo existir carregam em modo automático, o comportamento deles.
    const fontSizeMode =
      value['fontSizeMode'] === undefined
        ? 'auto'
        : fontSizeModeCheck(value['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const fontFamily = nonEmptyString(value['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight = fontWeightCheck(value['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign = textAlignCheck(value['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight = positive(value['lineHeight'], at(path, 'lineHeight'), issues);
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    return {
      id,
      type,
      x,
      y,
      width,
      height,
      rotation: rotationVal,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
      ...metadata,
    };
  }

  if (type === 'sticky') {
    rejectUnknownKeys(value, STICKY_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const text = textCheck(value['text'], at(path, 'text'), issues);
    const storedFontSize = positive(value['fontSize'], at(path, 'fontSize'), issues);
    const fontSizeMode =
      value['fontSizeMode'] === undefined
        ? 'auto'
        : fontSizeModeCheck(value['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const fontFamily = nonEmptyString(value['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight = fontWeightCheck(value['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign = textAlignCheck(value['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight = positive(value['lineHeight'], at(path, 'lineHeight'), issues);
    const issuesBeforeStyle = issues.length;
    const style = readStoredStyle(value['style'], FILL_STROKE_STYLE, stylePath, issues);
    requireStickyFill(style, stylePath, issues, issuesBeforeStyle);
    // Em modo automático o tamanho é derivado: a carga o refaz, qualquer que seja o gravado.
    const fontSize =
      fontSizeMode === 'auto'
        ? fitStickyFontSize({ text, ...geometry, fontFamily, fontWeight, lineHeight })
        : storedFontSize;
    return {
      id,
      type,
      ...geometry,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
      ...metadata,
    };
  }

  if (type === 'ink') {
    rejectUnknownKeys(value, INK_INPUT_KEYS, path, issues);
    const geometry = readAll(value, BOX_GEOMETRY, path, issues);
    const strokes = readInkStrokes(value['strokes'], at(path, 'strokes'), issues, 'local');
    const style = readStoredStyle(value['style'], INK_STYLE, stylePath, issues);
    return { id, type, ...geometry, strokes, ...flags, style, ...metadata };
  }

  if (type === 'arrow') {
    rejectUnknownKeys(value, ARROW_INPUT_KEYS, path, issues);
    const start = endpointCheck(value['start'], at(path, 'start'), issues);
    const end = endpointCheck(value['end'], at(path, 'end'), issues);
    const startMarker = arrowMarkerCheck(value['startMarker'], at(path, 'startMarker'), issues);
    const endMarker = arrowMarkerCheck(value['endMarker'], at(path, 'endMarker'), issues);

    if (isZeroLengthArrow({ start, end })) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }

    const style = readStoredStyle(value['style'], STROKE_STYLE, stylePath, issues);
    return {
      id,
      type,
      start,
      end,
      startMarker,
      endMarker,
      ...flags,
      style,
      ...metadata,
    };
  }

  if (type === 'group') {
    rejectUnknownKeys(
      value,
      ['id', 'type', 'visible', 'locked', 'childIds', 'metadata'],
      path,
      issues,
    );
    const rawChildren = value['childIds'];
    const childrenPath = at(path, 'childIds');
    const childIds: string[] = [];
    if (!Array.isArray(rawChildren)) {
      report(issues, childrenPath, 'type', 'must be an array of node IDs');
    } else if (rawChildren.length < 2) {
      report(issues, childrenPath, 'range', 'must contain at least two node IDs');
    } else {
      for (let i = 0; i < rawChildren.length; i++) {
        const child = rawChildren[i];
        const itemPath = at(childrenPath, i);
        if (typeof child !== 'string' || child.trim() === '') {
          report(issues, itemPath, 'type', 'must be a non-empty string');
        } else {
          childIds.push(child);
        }
      }
    }
    return {
      id,
      type: 'group',
      ...flags,
      childIds,
      ...metadata,
    };
  }

  report(
    issues,
    at(path, 'type'),
    'unknown-type',
    'must be rectangle, square, ellipse, circle, diamond, triangle, polygon, cross, chevron, brace, sticky, ink, line, bezier, text, arrow or group',
  );
  return undefined;
}

/**
 * Aplica uma alteração parcial a um shape e devolve o nó resultante, com o resultado inteiro
 * conferido. Os problemas vão para `issues`; quando há algum, o nó devolvido não deve ser usado.
 */
export function patchShape(
  node: ShapeNode,
  patch: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): ShapeNode {
  const stylePath = at(path, 'style');
  const flags = readSome(patch, FLAGS, path, issues);

  if (node.type === 'line') {
    rejectUnknownKeys(patch, LINE_PATCH_KEYS, path, issues);
    const before = issues.length;
    const geometry = readSome(patch, LINE_GEOMETRY, path, issues);
    const style = { ...node.style, ...readStyle(patch['style'], STROKE_STYLE, stylePath, issues) };
    const next: LineNode = { ...node, ...geometry, ...flags, style };
    if (issues.length === before && sameSpot(next.start, next.end)) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'bezier') {
    rejectUnknownKeys(patch, BEZIER_PATCH_KEYS, path, issues);
    const before = issues.length;
    const geometry = readSome(patch, BEZIER_GEOMETRY, path, issues);
    const symmetric =
      patch['symmetric'] === undefined
        ? node.symmetric
        : boolean(patch['symmetric'], at(path, 'symmetric'), issues);
    const style = { ...node.style, ...readStyle(patch['style'], STROKE_STYLE, stylePath, issues) };
    let next: BezierNode = { ...node, ...geometry, symmetric, ...flags, style };
    // Só refaz o espelho quando a geometria muda ou a simetria liga: um patch de estilo não
    // pode reescrever os controles com o erro de arredondamento da reflexão.
    const reshaped = Object.keys(geometry).length > 0 || (symmetric && !node.symmetric);
    if (issues.length === before && symmetric && reshaped && !sameSpot(next.start, next.end)) {
      const onlySecond = geometry.control2 !== undefined && geometry.control1 === undefined;
      const bothGiven = geometry.control1 !== undefined && geometry.control2 !== undefined;
      if (onlySecond) {
        next = { ...next, control1: mirrorControl(next.start, next.end, next.control2) };
      } else if (!bothGiven) {
        next = { ...next, control2: mirrorControl(next.start, next.end, next.control1) };
      }
    }
    if (issues.length === before) checkBezier(next, path, issues);
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'text') {
    rejectUnknownKeys(patch, TEXT_PATCH_KEYS, path, issues);
    const x = patch['x'] === undefined ? node.x : finite(patch['x'], at(path, 'x'), issues);
    const y = patch['y'] === undefined ? node.y : finite(patch['y'], at(path, 'y'), issues);
    const width =
      patch['width'] === undefined
        ? node.width
        : positive(patch['width'], at(path, 'width'), issues);
    const rotationVal =
      patch['rotation'] === undefined
        ? node.rotation
        : rotation(patch['rotation'], at(path, 'rotation'), issues);
    const text =
      patch['text'] === undefined ? node.text : textCheck(patch['text'], at(path, 'text'), issues);
    const fontSize =
      patch['fontSize'] === undefined
        ? node.fontSize
        : positive(patch['fontSize'], at(path, 'fontSize'), issues);
    const fontSizeMode =
      patch['fontSizeMode'] === undefined
        ? node.fontSizeMode
        : fontSizeModeCheck(patch['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const fontFamily =
      patch['fontFamily'] === undefined
        ? node.fontFamily
        : nonEmptyString(patch['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight =
      patch['fontWeight'] === undefined
        ? node.fontWeight
        : fontWeightCheck(patch['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign =
      patch['textAlign'] === undefined
        ? node.textAlign
        : textAlignCheck(patch['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight =
      patch['lineHeight'] === undefined
        ? node.lineHeight
        : positive(patch['lineHeight'], at(path, 'lineHeight'), issues);

    let height: number;
    if (patch['height'] !== undefined) {
      height = positive(patch['height'], at(path, 'height'), issues);
    } else if (
      patch['text'] !== undefined ||
      patch['width'] !== undefined ||
      patch['fontSize'] !== undefined ||
      patch['lineHeight'] !== undefined ||
      patch['fontFamily'] !== undefined ||
      patch['fontWeight'] !== undefined
    ) {
      height = layoutText(text, {
        fontSize,
        fontFamily,
        fontWeight,
        lineHeight,
        maxWidth: width > 0 ? width : undefined,
      }).height;
    } else {
      height = node.height;
    }

    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };

    const next: TextNode = {
      ...node,
      x,
      y,
      width,
      height,
      rotation: rotationVal,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
    };
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'sticky') {
    rejectUnknownKeys(patch, STICKY_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const text =
      patch['text'] === undefined ? node.text : textCheck(patch['text'], at(path, 'text'), issues);
    const fontSizeMode =
      patch['fontSizeMode'] === undefined
        ? node.fontSizeMode
        : fontSizeModeCheck(patch['fontSizeMode'], at(path, 'fontSizeMode'), issues);
    const givenFontSize =
      patch['fontSize'] === undefined
        ? node.fontSize
        : positive(patch['fontSize'], at(path, 'fontSize'), issues);
    const fontFamily =
      patch['fontFamily'] === undefined
        ? node.fontFamily
        : nonEmptyString(patch['fontFamily'], at(path, 'fontFamily'), issues);
    const fontWeight =
      patch['fontWeight'] === undefined
        ? node.fontWeight
        : fontWeightCheck(patch['fontWeight'], at(path, 'fontWeight'), issues);
    const textAlign =
      patch['textAlign'] === undefined
        ? node.textAlign
        : textAlignCheck(patch['textAlign'], at(path, 'textAlign'), issues);
    const lineHeight =
      patch['lineHeight'] === undefined
        ? node.lineHeight
        : positive(patch['lineHeight'], at(path, 'lineHeight'), issues);
    const issuesBeforeStyle = issues.length;
    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    requireStickyFill(style, stylePath, issues, issuesBeforeStyle);

    const box = { ...node, ...geometry };
    // No modo automático, tudo que muda o espaço ou a forma do texto refaz o tamanho.
    const refits =
      fontSizeMode === 'auto' &&
      (patch['text'] !== undefined ||
        patch['width'] !== undefined ||
        patch['height'] !== undefined ||
        patch['fontSizeMode'] !== undefined ||
        patch['fontFamily'] !== undefined ||
        patch['fontWeight'] !== undefined ||
        patch['lineHeight'] !== undefined);
    const fontSize = refits
      ? fitStickyFontSize({
          text,
          width: box.width,
          height: box.height,
          fontFamily,
          fontWeight,
          lineHeight,
        })
      : givenFontSize;

    const next: StickyNode = {
      ...node,
      ...geometry,
      text,
      fontSize,
      fontSizeMode,
      fontFamily,
      fontWeight,
      textAlign,
      lineHeight,
      ...flags,
      style,
    };
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'arrow') {
    rejectUnknownKeys(patch, ARROW_PATCH_KEYS, path, issues);
    const start =
      patch['start'] === undefined
        ? node.start
        : endpointCheck(patch['start'], at(path, 'start'), issues);
    const end =
      patch['end'] === undefined ? node.end : endpointCheck(patch['end'], at(path, 'end'), issues);
    const startMarker =
      patch['startMarker'] === undefined
        ? node.startMarker
        : arrowMarkerCheck(patch['startMarker'], at(path, 'startMarker'), issues);
    const endMarker =
      patch['endMarker'] === undefined
        ? node.endMarker
        : arrowMarkerCheck(patch['endMarker'], at(path, 'endMarker'), issues);
    const style = { ...node.style, ...readStyle(patch['style'], STROKE_STYLE, stylePath, issues) };

    const next: ArrowNode = {
      ...node,
      start,
      end,
      startMarker,
      endMarker,
      ...flags,
      style,
    };

    if (isZeroLengthArrow({ start, end })) {
      report(issues, path, 'zero-length', 'start and end must differ');
    }
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'ink') {
    rejectUnknownKeys(patch, INK_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const strokes =
      patch['strokes'] === undefined
        ? node.strokes
        : readInkStrokes(patch['strokes'], at(path, 'strokes'), issues, 'local');
    const style = { ...node.style, ...readStyle(patch['style'], INK_STYLE, stylePath, issues) };
    const next: InkNode = { ...node, ...geometry, strokes, ...flags, style };
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'diamond') {
    rejectUnknownKeys(patch, LABELABLE_BOX_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const next: DiamondNode = {
      ...node,
      ...geometry,
      ...flags,
      style,
    };
    return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
  }

  if (node.type === 'polygon') {
    rejectUnknownKeys(patch, POLYGON_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const sides =
      patch['sides'] === undefined
        ? node.sides
        : polygonSidesCheck(patch['sides'], at(path, 'sides'), issues);
    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const next: PolygonNode = { ...node, sides, ...geometry, ...flags, style };
    checkSquareBox('polygon', next, path, issues);
    return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
  }

  if (node.type === 'cross') {
    rejectUnknownKeys(patch, CROSS_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const armRatio =
      patch['armRatio'] === undefined
        ? node.armRatio
        : crossArmRatioCheck(patch['armRatio'], at(path, 'armRatio'), issues);
    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const next: CrossNode = { ...node, armRatio, ...geometry, ...flags, style };
    return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
  }

  if (node.type === 'chevron') {
    rejectUnknownKeys(patch, CHEVRON_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const direction =
      patch['direction'] === undefined
        ? node.direction
        : chevronDirectionCheck(patch['direction'], at(path, 'direction'), issues);
    const notchDepth =
      patch['notchDepth'] === undefined
        ? node.notchDepth
        : chevronNotchDepthCheck(patch['notchDepth'], at(path, 'notchDepth'), issues);
    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const next: ChevronNode = { ...node, direction, notchDepth, ...geometry, ...flags, style };
    return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
  }

  if (node.type === 'brace') {
    rejectUnknownKeys(patch, BRACE_PATCH_KEYS, path, issues);
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const orientation =
      patch['orientation'] === undefined
        ? node.orientation
        : braceOrientationCheck(patch['orientation'], at(path, 'orientation'), issues);
    const tipPosition =
      patch['tipPosition'] === undefined
        ? node.tipPosition
        : unitInterval(patch['tipPosition'], at(path, 'tipPosition'), issues);
    const curvature =
      patch['curvature'] === undefined
        ? node.curvature
        : unitInterval(patch['curvature'], at(path, 'curvature'), issues);
    const style = { ...node.style, ...readStyle(patch['style'], STROKE_STYLE, stylePath, issues) };
    const next: BraceNode = {
      ...node,
      orientation,
      tipPosition,
      curvature,
      ...geometry,
      ...flags,
      style,
    };
    return patchMetadata(next, patch, path, issues);
  }

  if (node.type === 'triangle') {
    rejectUnknownKeys(patch, TRIANGLE_PATCH_KEYS, path, issues);
    const before = issues.length;
    const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
    const hasVariantPatch = patch['variant'] !== undefined;
    const targetVariant: TriangleVariant = hasVariantPatch
      ? triangleVariantCheck(patch['variant'], at(path, 'variant'), issues)
      : node.variant;
    const hasApexPatch = patch['apex'] !== undefined;
    let apex: number;
    if (hasApexPatch) {
      apex = triangleApexCheck(patch['apex'], at(path, 'apex'), issues);
    } else if (hasVariantPatch && targetVariant !== node.variant) {
      if (targetVariant === 'isosceles' || targetVariant === 'equilateral') {
        apex = 0.5;
      } else if (targetVariant === 'right') {
        apex = 0;
      } else {
        // scalene: mantém apex atual salvo quando é 0, 0.5 ou 1
        const cur = node.apex;
        if (Math.abs(cur) < 1e-6 || Math.abs(cur - 0.5) < 1e-6 || Math.abs(cur - 1) < 1e-6) {
          apex = 0.3;
        } else {
          apex = cur;
        }
      }
    } else {
      apex = node.apex;
    }

    let box: BoxGeometry = {
      x: geometry.x ?? node.x,
      y: geometry.y ?? node.y,
      width: geometry.width ?? node.width,
      height: geometry.height ?? node.height,
      rotation: geometry.rotation ?? node.rotation,
    };

    if (
      hasVariantPatch &&
      targetVariant === 'equilateral' &&
      node.variant !== 'equilateral' &&
      patch['width'] === undefined &&
      patch['height'] === undefined
    ) {
      box = fitAspect(box, EQUILATERAL_ASPECT_RATIO);
    }

    if (issues.length === before) {
      validateTriangleInvariants(targetVariant, apex, box.width, box.height, path, issues);
    }

    const style = {
      ...node.style,
      ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
    };
    const next: TriangleNode = {
      ...node,
      variant: targetVariant,
      apex,
      ...box,
      ...flags,
      style,
    };
    return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
  }

  rejectUnknownKeys(patch, LABELABLE_BOX_TYPE_CONVERTIBLE_KEYS, path, issues);
  const isRectGroup = node.type === 'rectangle' || node.type === 'square';
  const freeType = isRectGroup ? 'rectangle' : 'ellipse';
  const lockedType = isRectGroup ? 'square' : 'circle';
  let targetType: 'rectangle' | 'square' | 'ellipse' | 'circle' = node.type;
  if (patch['type'] !== undefined) {
    if (patch['type'] === freeType || patch['type'] === lockedType) {
      targetType = patch['type'] as typeof targetType;
    } else {
      report(
        issues,
        at(path, 'type'),
        'unknown-field',
        `type conversion only supported between ${freeType} and ${lockedType}`,
      );
    }
  }
  const geometry = readSome(patch, BOX_GEOMETRY, path, issues);
  const style = {
    ...node.style,
    ...readStyle(patch['style'], FILL_STROKE_STYLE, stylePath, issues),
  };

  let box: BoxGeometry = {
    x: geometry.x ?? node.x,
    y: geometry.y ?? node.y,
    width: geometry.width ?? node.width,
    height: geometry.height ?? node.height,
    rotation: geometry.rotation ?? node.rotation,
  };

  if (node.type === freeType && targetType === lockedType) {
    box = fitAspect(box, 1);
  } else if (targetType === lockedType) {
    if (Math.abs(box.width - box.height) >= 1e-6) {
      report(issues, path, 'invalid-geometry', `${lockedType} width and height must be equal`);
    }
  }

  const next = {
    ...node,
    type: targetType,
    ...box,
    ...flags,
    style,
  };
  return patchMetadata(patchLabel(next, patch, path, issues), patch, path, issues);
}

/**
 * Aplica o `label` do patch às formas elegíveis: o objeto é mesclado sobre o `label` atual (ou
 * sobre `DEFAULT_SHAPE_LABEL`, na primeira vez), e `null` remove o texto. Sem `label` no patch, o
 * nó segue como está, e uma conversão de tipo preserva o `label` que ele já tinha.
 */
function patchLabel<Node extends LabelableNode>(
  node: Node,
  patch: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): Node {
  const value = patch['label'];
  if (value === undefined) return node;
  if (value === null) {
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'label')) as Node;
  }
  const labelPath = at(path, 'label');
  if (!isRecord(value)) {
    report(issues, labelPath, 'type', 'must be an object or null');
    return node;
  }
  rejectUnknownKeys(value, LABEL_KEYS, labelPath, issues);
  const current = node.label ?? DEFAULT_SHAPE_LABEL;
  const pick = <T>(key: string, check: Check<T>, fallback: T): T =>
    value[key] === undefined ? fallback : check(value[key], at(labelPath, key), issues);
  const label: ShapeLabel = {
    text: pick('text', textCheck, current.text),
    fontSize: pick('fontSize', positive, current.fontSize),
    fontFamily: pick('fontFamily', nonEmptyString, current.fontFamily),
    fontWeight: pick('fontWeight', fontWeightCheck, current.fontWeight),
    color: pick('color', colorOrNull, current.color),
    textAlign: pick('textAlign', textAlignCheck, current.textAlign),
    verticalAlign: pick('verticalAlign', verticalAlignCheck, current.verticalAlign),
  };
  return { ...node, label };
}

export function patchMetadata<Node extends ShapeNode | BoardNode>(
  node: Node,
  patch: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): Node {
  const value = patch['metadata'];
  if (value === undefined) return node;
  if (value === null) {
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'metadata')) as Node;
  }
  return { ...node, metadata: jsonObject(value, at(path, 'metadata'), issues) };
}
