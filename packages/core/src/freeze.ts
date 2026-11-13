/**
 * Congela um valor JSON e tudo o que ele contém, e o devolve.
 *
 * O snapshot público é o próprio estado do canvas. Congelado, um consumidor sem os tipos não
 * consegue alterá-lo por fora dos comandos.
 *
 * Um objeto que já chega congelado é tido como congelado por inteiro, para um commit não
 * percorrer de novo o que não mudou. Por isso só entram aqui valores criados pelo core: dado
 * vindo de fora é copiado antes.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
