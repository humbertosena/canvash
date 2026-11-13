import { MAX_ISSUES, type ValidationIssue, type ValidationRule } from './result.js';

// Conferência de entrada não confiável: comandos montados em JavaScript sem os tipos, comandos
// desserializados e documentos carregados. Cada `Check` recebe o valor como `unknown`, registra
// o que recusou e devolve a forma normalizada. Quando registra um problema, o valor devolvido
// é só um marcador: quem chama descarta o resultado se `issues` cresceu.

/**
 * Posição de um valor dentro da entrada conferida, como lista ligada da folha até a raiz.
 * `undefined` é a própria entrada. Só vira array quando um problema é registrado, para a
 * conferência de um documento grande não montar um array por campo.
 */
export type Path = { readonly parent: Path; readonly key: string | number } | undefined;

/** Confere um valor e devolve a forma normalizada dele. */
export type Check<T> = (value: unknown, path: Path, issues: ValidationIssue[]) => T;

type Spec = Readonly<Record<string, Check<unknown>>>;
type Values<S extends Spec> = { -readonly [Key in keyof S]: ReturnType<S[Key]> };

/** Valor JSON. É o que o documento aceita em `metadata`. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Objeto JSON. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Diz se um valor JSON é um array. Use no lugar de `Array.isArray`, que não estreita um array
 * somente leitura e deixa os itens como `any`.
 */
export function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Diz se um valor JSON é um objeto: nem array, nem `null`. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Aninhamento máximo de um valor JSON aceito. Limita a recursão sobre entrada externa.
const MAX_JSON_DEPTH = 32;
// Máximo de valores de um objeto JSON aceito, contando objetos, listas e folhas: o mesmo número
// do máximo de nós de um documento. Sem ele, um objeto que cita o mesmo filho duas vezes em cada
// nível custaria uma cópia por caminho, 2 elevado à profundidade.
const MAX_JSON_VALUES = 100_000;

const COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Chave que, atribuída a um objeto comum, troca o protótipo em vez de criar a propriedade. */
export const RESERVED_KEY = '__proto__';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Os itens de um array recebido de fora, um por vez, com a posição de cada um. Nenhum método
 * do array recebido é chamado, porque ele pode ter sido trocado, e posição vazia vem como
 * `undefined` em vez de ser pulada.
 *
 * Cada item só é lido quando o laço chega nele. Um array esparso pode ter `length` de bilhões
 * e caber em poucos bytes: quem para no primeiro erro, ou no teto de problemas, não paga pelo
 * comprimento.
 */
export function* items(value: readonly unknown[]): Generator<[index: number, item: unknown]> {
  for (let index = 0; index < value.length; index += 1) yield [index, value[index]];
}

/** Diz se a lista de problemas chegou ao teto: quem percorre a entrada para de procurar. */
export function isFull(issues: readonly ValidationIssue[]): boolean {
  return issues.length >= MAX_ISSUES;
}

/** O caminho de `key` dentro do valor que está em `path`. */
export function at(path: Path, key: string | number): Path {
  return { parent: path, key };
}

/** Registra um problema no valor que está em `path`. */
export function report(
  issues: ValidationIssue[],
  path: Path,
  rule: ValidationRule,
  message: string,
): void {
  const segments: (string | number)[] = [];
  for (let node = path; node !== undefined; node = node.parent) segments.unshift(node.key);
  issues.push({ path: segments, rule, message });
}

export const finite: Check<number> = (value, path, issues) => {
  if (typeof value !== 'number') {
    report(issues, path, 'type', 'must be a number');
    return 0;
  }
  if (!Number.isFinite(value)) {
    report(issues, path, 'finite', 'must be a finite number');
    return 0;
  }
  // Somar zero troca -0 por 0: o documento não guarda zero negativo, que o JSON não preserva.
  return value + 0;
};

function numberWhere(accepts: (value: number) => boolean, message: string): Check<number> {
  return (value, path, issues) => {
    const before = issues.length;
    const number = finite(value, path, issues);
    if (issues.length === before && !accepts(number)) report(issues, path, 'range', message);
    return number;
  };
}

export const positive = numberWhere((value) => value > 0, 'must be greater than 0');
export const nonNegative = numberWhere((value) => value >= 0, 'must not be negative');
export const unitInterval = numberWhere(
  (value) => value >= 0 && value <= 1,
  'must be between 0 and 1',
);

export const boolean: Check<boolean> = (value, path, issues) => {
  if (typeof value !== 'boolean') {
    report(issues, path, 'type', 'must be a boolean');
    return false;
  }
  return value;
};

export const nonEmptyString: Check<string> = (value, path, issues) => {
  if (typeof value !== 'string' || value === '') {
    report(issues, path, 'type', 'must be a non-empty string');
    return '';
  }
  return value;
};

/** Cor sRGB em hexadecimal, `#rrggbb` ou `#rrggbbaa`, ou `null` para nenhuma. */
export const colorOrNull: Check<string | null> = (value, path, issues) => {
  if (value === null) return null;
  if (typeof value !== 'string') {
    report(issues, path, 'type', 'must be a color string or null');
    return null;
  }
  if (!COLOR.test(value)) {
    report(issues, path, 'format', 'must be a color like #rrggbb or #rrggbbaa');
    return null;
  }
  return value.toLowerCase();
};

/** `top`, `middle` ou `bottom`: onde o texto da forma fica na altura da área. */
export const verticalAlignCheck: Check<'top' | 'middle' | 'bottom'> = (value, path, issues) => {
  if (value === 'top' || value === 'middle' || value === 'bottom') return value;
  report(issues, path, 'format', 'must be "top", "middle" or "bottom"');
  return 'middle';
};

// Cópias válidas já feitas, por conferência (a lista de problemas é uma por chamada). O mesmo objeto
// citado por vários nós é copiado e contado uma vez, e os nós passam a compartilhar a cópia
// congelada. Sem isto, 100 nós citando um objeto de 49.000 valores custavam 0,9 s e 266 MB.
const validCopies = new WeakMap<ValidationIssue[], Map<object, JsonObject>>();

/**
 * Objeto que só contém valores JSON, com até 32 níveis e 100.000 valores. Devolve uma cópia: o
 * valor original não entra no documento. O mesmo objeto, citado de novo na mesma conferência,
 * devolve a mesma cópia.
 */
export const jsonObject: Check<JsonObject> = (value, path, issues) => {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object of JSON values');
    return {};
  }
  let copies = validCopies.get(issues);
  const known = copies?.get(value);
  if (known !== undefined) return known;
  const before = issues.length;
  const budget = { left: MAX_JSON_VALUES };
  const copy = copyJson(value, path, issues, [], budget) as JsonObject;
  if (budget.left < 0) {
    report(issues, path, 'range', `must not have more than ${MAX_JSON_VALUES} values`);
  }
  // Só a cópia sem problema é lembrada: a inválida é apontada em cada caminho que a cita.
  if (issues.length === before) {
    if (copies === undefined) {
      copies = new Map();
      validCopies.set(issues, copies);
    }
    copies.set(value, copy);
  }
  return copy;
};

/**
 * Diz se o objeto é um objeto literal. Só ele serve de objeto JSON ou de dicionário: um Date,
 * um Map ou uma instância de classe perderiam o conteúdo na cópia, em silêncio.
 *
 * O protótipo de um objeto literal é o `Object.prototype` do contexto em que ele nasceu (outra
 * janela, um iframe), reconhecido por não ter protótipo; o de uma instância de classe ou de um
 * Date tem.
 */
export function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype as object) === null;
}

function copyJson(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  ancestors: unknown[],
  budget: { left: number },
): JsonValue {
  // Cada valor visitado gasta um do orçamento; estourado, o resto da entrada não é lido.
  budget.left -= 1;
  if (budget.left < 0) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value, path, issues);
  if (typeof value !== 'object' || !(Array.isArray(value) || isPlainObject(value))) {
    report(issues, path, 'type', 'must be a JSON value');
    return null;
  }
  if (ancestors.includes(value)) {
    report(issues, path, 'type', 'must not contain itself');
    return null;
  }
  if (ancestors.length >= MAX_JSON_DEPTH) {
    report(issues, path, 'range', `must not nest deeper than ${MAX_JSON_DEPTH}`);
    return null;
  }
  ancestors.push(value);
  let copy: JsonValue;
  if (Array.isArray(value)) {
    const list: JsonValue[] = [];
    for (const [index, item] of items(value)) {
      if (budget.left < 0 || isFull(issues)) break;
      list.push(copyJson(item, at(path, index), issues, ancestors, budget));
    }
    copy = list;
  } else {
    const entries: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (budget.left < 0 || isFull(issues)) break;
      if (key === RESERVED_KEY) {
        report(issues, at(path, key), 'unknown-field', 'is not an accepted key');
      } else {
        entries[key] = copyJson(item, at(path, key), issues, ancestors, budget);
      }
    }
    copy = entries;
  }
  ancestors.pop();
  return copy;
}

/** Registra cada chave própria de `record` que não está em `allowed`. */
export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: Path,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (isFull(issues)) return;
    if (!allowed.includes(key))
      report(issues, at(path, key), 'unknown-field', 'is not a known field');
  }
}

/** Lê todos os campos de `spec`. Campo ausente é recusado pelo próprio `Check`. */
export function readAll<S extends Spec>(
  record: Record<string, unknown>,
  spec: S,
  path: Path,
  issues: ValidationIssue[],
): Values<S> {
  return read(record, spec, path, issues, true) as Values<S>;
}

/** Lê só os campos de `spec` presentes em `record`. `undefined` conta como ausente. */
export function readSome<S extends Spec>(
  record: Record<string, unknown>,
  spec: S,
  path: Path,
  issues: ValidationIssue[],
): Partial<Values<S>> {
  return read(record, spec, path, issues, false);
}

function read<S extends Spec>(
  record: Record<string, unknown>,
  spec: S,
  path: Path,
  issues: ValidationIssue[],
  required: boolean,
): Partial<Values<S>> {
  const values: Partial<Values<S>> = {};
  for (const [key, check] of Object.entries(spec) as [keyof S & string, S[keyof S]][]) {
    const value = record[key];
    if (required || value !== undefined) {
      values[key] = check(value, at(path, key), issues) as ReturnType<S[keyof S & string]>;
    }
  }
  return values;
}
