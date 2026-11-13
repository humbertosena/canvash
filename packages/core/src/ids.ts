import { RESERVED_KEY } from './checks.js';

/** Gera um ID novo a cada chamada. IDs são strings opacas e únicas por documento. */
export type IdGenerator = () => string;

/** Relógio em milissegundos, como `Date.now`. */
export type Clock = () => number;

// Dois sorteios de 8 dígitos em base 36: cerca de 82 bits por ID.
const RANDOM_DIGITS = 8;
const RANDOM_RANGE = 36 ** RANDOM_DIGITS;

/**
 * Cria o gerador de IDs padrão do canvas.
 *
 * Cada ID junta o instante da criação, um trecho aleatório e um contador próprio do gerador.
 * O contador garante que um mesmo gerador nunca se repete, qualquer que seja o relógio; o
 * instante e o trecho aleatório separam geradores que não se conhecem, como os de dois
 * clientes editando o mesmo documento.
 *
 * @param now Relógio lido a cada ID gerado.
 * @param random Fonte de números em `[0, 1)`, como `Math.random`.
 */
export function createIdGenerator(now: Clock, random: () => number): IdGenerator {
  let count = 0;
  const randomPart = (): string =>
    Math.floor(random() * RANDOM_RANGE)
      .toString(36)
      .padStart(RANDOM_DIGITS, '0');

  return () => {
    count += 1;
    const time = Math.floor(now()).toString(36);
    // O contador vem depois do último hífen e não contém hífen: dois IDs do mesmo gerador
    // diferem pelo menos nesse sufixo.
    return `${time}${randomPart()}${randomPart()}-${count.toString(36)}`;
  };
}

/**
 * Pede um ID ao gerador e confere o valor: o gerador pode vir do host.
 *
 * @throws {TypeError} Se o gerador devolver algo que não seja uma string não vazia, ou o ID
 * reservado `__proto__`.
 */
export function nextId(generateId: IdGenerator): string {
  const id: unknown = generateId();
  if (typeof id !== 'string' || id === '' || id === RESERVED_KEY) {
    throw new TypeError(`generateId must return a non-empty string other than "${RESERVED_KEY}"`);
  }
  return id;
}
