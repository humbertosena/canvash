/** O formato do arquivo exportado, que dá a extensão do nome. */
export type ExportFileFormat = 'png' | 'svg';

export interface ExportFileNameOptions {
  /** Nome usado quando o título fica vazio (padrão: `'board'`). Passa pela mesma sanitização. */
  readonly fallback?: string;
}

/** O nome que sobra quando nem o título nem o `fallback` dão um nome. */
const DEFAULT_NAME = 'board';
/** Pontos de código do nome, sem a extensão e sem o `_` de nome reservado. */
const MAX_CODE_POINTS = 100;

const ZWJ = '\u200D';
/** Invisíveis e de direção: U+061C, U+200B, U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069 e U+FEFF. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x061c, 0x061c],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const FORBIDDEN_RUN = /\s*[<>:"/\\|?*]+\s*/g;
const EXTENSION = /\.(?:png|svg)$/i;
/** Nomes que o Windows reserva, com ou sem extensão. */
const RESERVED = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;

const isControl = (code: number): boolean => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const isInvisible = (code: number): boolean =>
  INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);

/** Controles viram espaço e os invisíveis e de direção saem; o ZWJ fica. */
function cleanCharacters(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (isControl(code)) result += ' ';
    else if (!isInvisible(code)) result += char;
  }
  return result;
}

/** Pontas aparadas: espaços, pontos, hífens e um ZWJ solto, que não liga mais nada. */
const isEdge = (char: string): boolean =>
  /\s/.test(char) || char === '.' || char === '-' || char === ZWJ;

function trimEnds(name: string): string {
  const chars = [...name];
  let start = 0;
  let end = chars.length;
  while (start < end && isEdge(chars[start]!)) start += 1;
  while (end > start && isEdge(chars[end - 1]!)) end -= 1;
  return chars.slice(start, end).join('');
}

/** Tira as pontas e uma extensão final, repetindo até nada mudar (`logo.png.png`, `logo.png.`). */
function trimEdges(name: string): string {
  let current = name;
  for (;;) {
    const next = trimEnds(current).replace(EXTENSION, '');
    if (next === current) return current;
    current = next;
  }
}

/** O maior prefixo de grafemas inteiros com até `limit` pontos de código. */
function cutGraphemes(text: string, limit: number): string {
  if ([...text].length <= limit) return text;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let result = '';
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = [...segment].length;
    if (count + size > limit) break;
    result += segment;
    count += size;
  }
  return result;
}

/** Os passos 1 a 7 do §4.5: do texto livre ao nome sem extensão, possivelmente vazio. */
function sanitize(text: string): string {
  const clean = cleanCharacters(text.normalize('NFC'))
    .replace(FORBIDDEN_RUN, '-')
    .replace(/\s+/g, ' ');
  return trimEdges(cutGraphemes(trimEdges(clean), MAX_CODE_POINTS));
}

/**
 * Nome de arquivo seguro derivado do título do board, já com a extensão. Pura e determinística:
 * normaliza em NFC, troca controles por espaço, remove invisíveis e marcas de direção (que
 * escondem a extensão real), troca `< > : " / \ | ? *` por `-`, apara pontas, tira uma extensão
 * repetida, corta em 100 pontos de código sem partir grafema, cai em `fallback` (e em `board`)
 * quando fica vazio, e acrescenta `_` ao radical reservado do Windows (`con` vira `con_`).
 *
 * @example
 * boardExportFileName('Relatório 2026/10/31', 'svg'); // 'Relatório 2026-10-31.svg'
 */
export function boardExportFileName(
  title: string,
  format: ExportFileFormat,
  options: ExportFileNameOptions = {},
): string {
  let name = sanitize(title);
  if (name === '') name = sanitize(options.fallback ?? DEFAULT_NAME);
  if (name === '') name = DEFAULT_NAME;

  const dot = name.indexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  if (RESERVED.test(stem)) name = `${stem}_${dot === -1 ? '' : name.slice(dot)}`;
  return `${name}.${format}`;
}
