/**
 * Compara dois valores JSON em profundidade. Serve para reconhecer a alteração sem efeito:
 * um item reescrito com os mesmos valores não conta como mudança.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
