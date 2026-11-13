/**
 * Devolve o valor, que o chamador sabe que existe por uma invariante do documento.
 *
 * @throws {Error} Se o valor for `undefined`. Isso é um defeito do core, não um erro de uso, e
 * por isso não volta como `Result`.
 */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Canvash internal error: missing ${what}`);
  return value;
}
