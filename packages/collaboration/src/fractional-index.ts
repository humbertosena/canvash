/**
 * Alfabeto ordenado para indexação fracionária lexicográfica estável (ASCII puro).
 */
const BASE_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const SMALLEST_CHAR = '0';
const MID_CHAR = 'm';

const ZERO_CODE = SMALLEST_CHAR.charCodeAt(0);

/**
 * Dígito do alfabeto estritamente entre os code units `lo` e `hi` (-1 e `Infinity` são os
 * extremos abertos), ou `null` se não houver. Nunca devolve o menor dígito: chave terminada em
 * '0' não tem espaço logo abaixo dentro do alfabeto ('a' < x < 'a0' não existe).
 */
function digitBetween(lo: number, hi: number): string | null {
  let lower = 0;
  let upper = BASE_DIGITS.length;
  for (let i = 0; i < BASE_DIGITS.length; i++) {
    const code = BASE_DIGITS.charCodeAt(i);
    if (code <= lo) lower = i;
    if (code >= hi && upper === BASE_DIGITS.length) upper = i;
  }
  return upper - lower > 1 ? BASE_DIGITS.charAt(Math.floor((lower + upper) / 2)) : null;
}

function hasCodeAbove(text: string, code: number): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > code) return true;
  }
  return false;
}

/** Chave não vazia estritamente menor que `next` (não vazia). */
function keyBelow(next: string): string {
  const head = next.charAt(0);
  const hi = next.charCodeAt(0);
  const digit = digitBetween(-1, hi);
  if (digit !== null) return digit;
  if (hi > ZERO_CODE) return `${SMALLEST_CHAR}${MID_CHAR}`;
  const rest = next.slice(1);
  // Só o '0' ou caracteres abaixo dele aqui: mantém o prefixo se mais adiante houver espaço no alfabeto.
  if (hasCodeAbove(rest, ZERO_CODE)) return `${head}${keyBelow(rest)}`;
  if (hi > 0) return `${String.fromCharCode(hi - 1)}${MID_CHAR}`;
  if (rest === '') {
    throw new RangeError('generateOrderKey: não existe chave entre prevKey e prevKey + U+0000');
  }
  return hasCodeAbove(rest, 0) ? `${head}${keyBelow(rest)}` : head;
}

/** Chave estritamente entre `prev` ('' = sem limite inferior) e `next` (`null` = sem limite superior). */
function keyBetween(prev: string, next: string | null): string {
  if (next !== null) {
    let shared = 0;
    while (shared < prev.length && prev[shared] === next[shared]) shared++;
    if (shared > 0)
      return `${next.slice(0, shared)}${keyBetween(prev.slice(shared), next.slice(shared))}`;
  }
  if (prev === '') return next === null ? MID_CHAR : keyBelow(next);
  const digit = digitBetween(prev.charCodeAt(0), next === null ? Infinity : next.charCodeAt(0));
  if (digit !== null) return digit;
  // Sem dígito livre nesta posição: fica com o caractere de prev e cresce acima do resto dele.
  return `${prev.charAt(0)}${keyBetween(prev.slice(1), null)}`;
}

/**
 * Gera uma chave de ordem estritamente entre `prevKey` e `nextKey` (ou no início/fim).
 * Se `prevKey` e `nextKey` forem iguais (empate concorrente), desempata usando `tieBreakerId`.
 *
 * Garante que:
 * 1. Se prevKey < nextKey (ou um deles é ausente), prevKey < generateOrderKey(...) < nextKey,
 *    na ordem binária das strings (code units UTF-16)
 * 2. Suporta empates concorrentes determinísticos sem lançar erro nem colidir
 * 3. Permite inserções infinitas subsequentes entre elementos empatados (COLLAB-09)
 * 4. Fora do desempate de empates, não termina a chave no menor dígito ('0'), que não teria
 *    espaço logo abaixo dentro do alfabeto
 *
 * Lança `RangeError` se prevKey > nextKey ou se não existe chave entre os dois
 * (nextKey é prevKey seguido de U+0000).
 */
export function generateOrderKey(
  prevKey: string | null | undefined,
  nextKey: string | null | undefined,
  tieBreakerId = '',
): string {
  const prev = prevKey ?? '';
  const next = nextKey ? nextKey : null;

  // Tratamento de empates concorrentes
  if (prev && next !== null && prev === next) {
    const safeId = tieBreakerId ? tieBreakerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : '0';
    return `${prev}_${safeId || '0'}`;
  }

  if (next !== null && prev > next) {
    throw new RangeError('generateOrderKey: prevKey deve ser menor que nextKey');
  }

  return keyBetween(prev, next);
}

/**
 * Compara dois nós colaborativos por `orderKey` e desempata deterministicamente por `id`, na
 * ordem binária das strings (code units UTF-16), independente de locale.
 */
export function compareOrderKeys(
  a: { orderKey: string; id: string },
  b: { orderKey: string; id: string },
): number {
  if (a.orderKey < b.orderKey) return -1;
  if (a.orderKey > b.orderKey) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
