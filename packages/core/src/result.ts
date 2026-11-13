/**
 * Resultado de uma operação. Erros operacionais não lançam exceção: voltam em `error`, com um
 * `code` que o consumidor pode testar. O tipo do erro é o do canvas, salvo indicação em contrário.
 */
export type Result<T, E = CanvasError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Regra violada por um valor recusado na validação.
 *
 * Esta união pode ganhar membros em versões futuras: ao tratá-la caso a caso, deixe um ramo
 * para o que não conhecer.
 */
export type ValidationRule =
  /** Valor ausente ou de tipo errado. */
  | 'type'
  /** Campo que o comando, o shape ou o documento não conhece. */
  | 'unknown-field'
  /** Discriminante desconhecido: tipo de comando ou de shape. */
  | 'unknown-type'
  /** Número que não é finito. */
  | 'finite'
  /** Número fora da faixa aceita, como dimensão não positiva ou opacidade acima de 1. */
  | 'range'
  /** Linha cujos dois extremos coincidem. */
  | 'zero-length'
  /** Texto fora do formato esperado, como uma cor que não é `#rrggbb`. */
  | 'format'
  /** ID já usado por outro item do documento. */
  | 'duplicate-id'
  /** ID que o documento não aceita. */
  | 'reserved-id'
  /** Nó que precisava estar visível, ele e a camada dele. */
  | 'not-visible'
  /** Nó guardado sob uma chave diferente do próprio ID. */
  | 'id-mismatch'
  /** Camada que cita um nó que o documento não tem. */
  | 'broken-reference'
  /** Nó citado mais de uma vez: em duas camadas, ou duas vezes na mesma. */
  | 'multiple-parents'
  /** Nó que nenhuma camada contém. */
  | 'missing-parent'
  /** Grupo que tenta conter outro grupo (restrição estrita de 1 nível). */
  | 'nested-group'
  /** Um board que tenta ficar dentro de outro board. */
  | 'nested-board'
  /** Um board que tenta ficar dentro de um grupo. */
  | 'board-in-group'
  /** Geometria inválida para as restrições intrínsecas da forma (ex.: quadrado com largura diferente de altura). */
  | 'invalid-geometry';

/** Um valor recusado: onde está, qual regra violou e uma frase para quem depura. */
export interface ValidationIssue {
  /**
   * Caminho do valor a partir da entrada validada, um segmento por nível: nome de campo, chave
   * ou índice de array. Para `shape.style.opacity` é `['shape', 'style', 'opacity']`; vazio
   * quando o problema é a própria entrada.
   */
  readonly path: readonly (string | number)[];
  readonly rule: ValidationRule;
  /** Texto para leitura humana. Pode mudar entre versões: teste `rule` e `path`. */
  readonly message: string;
}

// Os tipos auxiliares abaixo são aliases de tipos de objeto, e não interfaces, de propósito:
// eles não são exportados, e um consumidor que emite declarações precisa que o TypeScript
// consiga escrever por extenso o tipo de um erro estreitado. Interface não exportada ele não
// consegue citar.
type ErrorOf<Code extends string, Details> = {
  readonly code: Code;
  /** Texto para leitura humana. Pode mudar entre versões: teste `code` e `details`. */
  readonly message: string;
  readonly details: Details;
};

type ValidationDetails = {
  /**
   * Posição do comando recusado dentro da transação; em `dispatch` é sempre 0. Ausente quando
   * o erro não veio de um comando.
   */
  readonly commandIndex?: number | undefined;
  /** Os problemas encontrados na entrada: no máximo cem, em qualquer operação. */
  readonly issues: readonly ValidationIssue[];
};

type NotFoundDetails = {
  /** Posição do comando recusado dentro da transação, quando o erro veio de um comando. */
  readonly commandIndex?: number | undefined;
  readonly kind: 'node' | 'layer';
  readonly id: string;
};

type LockedDetails = {
  /** Posição do comando recusado dentro da transação. */
  readonly commandIndex?: number | undefined;
  /** O item que o comando tentou alterar. */
  readonly id: string;
  /** Quem está bloqueado: o próprio item ou a camada dele. */
  readonly lockedBy: string;
};

type LimitDetails = {
  /** Posição do comando recusado dentro da transação, quando o erro veio de um comando. */
  readonly commandIndex?: number | undefined;
  /** Esta união pode ganhar membros em versões futuras. */
  readonly limit: 'nodes' | 'coordinate' | 'text';
  readonly max: number;
  /** O valor que passaria do limite. */
  readonly actual: number;
};

type VersionDetails = {
  readonly found: number;
  readonly supported: number;
};

type NoDetails = Readonly<Record<string, never>>;

/**
 * Erro operacional do canvas, discriminado por `code`.
 *
 * Esta união pode ganhar membros em versões futuras: ao tratar os códigos, deixe um ramo para
 * o caso desconhecido.
 */
export type CanvasError =
  /** A entrada foi recusada; `details.issues` diz onde e por quê. */
  | ErrorOf<'VALIDATION_ERROR', ValidationDetails>
  /** O ID não é de um nó, ou de uma camada, do documento. */
  | ErrorOf<'NOT_FOUND', NotFoundDetails>
  /** `id` não pode ser alterado porque `lockedBy` (ele mesmo ou a camada dele) está bloqueado. */
  | ErrorOf<'LOCKED', LockedDetails>
  /** O documento ficaria maior do que os limites do canvas permitem. */
  | ErrorOf<'LIMIT_EXCEEDED', LimitDetails>
  /** O documento é de uma versão de schema mais nova do que esta versão do core entende. */
  | ErrorOf<'UNSUPPORTED_VERSION', VersionDetails>
  /** O canvas está em modo somente leitura: comandos, undo e redo são recusados. */
  | ErrorOf<'READ_ONLY', NoDetails>
  /** Método que altera o canvas chamado de dentro de um listener, durante a notificação. */
  | ErrorOf<'REENTRANT_DISPATCH', NoDetails>
  /** O canvas foi destruído: só as leituras continuam respondendo. */
  | ErrorOf<'DISPOSED', NoDetails>
  /**
   * Reservado para a colaboração: `replaceDocument` enquanto o canvas está vinculado a uma
   * sessão colaborativa. Nenhuma operação desta versão o devolve.
   */
  | ErrorOf<'COLLABORATION_ACTIVE', NoDetails>;

export type CanvasErrorCode = CanvasError['code'];

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(error: CanvasError): Result<never> {
  return { ok: false, error };
}

/**
 * Máximo de problemas que um erro de validação traz. Quem confere uma entrada para de juntar
 * problemas ao chegar aqui: uma entrada inteira inválida não precisa de cem mil mensagens.
 */
export const MAX_ISSUES = 100;

// Quantos problemas a mensagem cita; os demais ficam em `details.issues`.
const ISSUES_IN_MESSAGE = 3;

export function validationError(found: readonly ValidationIssue[]): CanvasError {
  // A conferência de um item pode passar do teto antes de o laço dela parar.
  const issues = found.length > MAX_ISSUES ? found.slice(0, MAX_ISSUES) : found;
  const shown = issues
    .slice(0, ISSUES_IN_MESSAGE)
    .map((issue) => `${formatPath(issue.path)} ${issue.message}`.trim())
    .join('; ');
  const hidden = issues.length - ISSUES_IN_MESSAGE;
  return {
    code: 'VALIDATION_ERROR',
    message: `Invalid input: ${shown}${hidden > 0 ? ` (and ${hidden} more)` : ''}`,
    details: { issues },
  };
}

// Só para a mensagem: `shape.metadata.list[1]`.
function formatPath(path: readonly (string | number)[]): string {
  return path
    .map((segment, index) =>
      typeof segment === 'number' ? `[${segment}]` : `${index > 0 ? '.' : ''}${segment}`,
    )
    .join('');
}

export function notFoundError(kind: 'node' | 'layer', id: string): CanvasError {
  return {
    code: 'NOT_FOUND',
    message: `No ${kind} with ID ${JSON.stringify(id)}`,
    details: { kind, id },
  };
}

/** Marca o erro com a posição do comando que o causou dentro da transação. */
export function atCommand(error: CanvasError, commandIndex: number): CanvasError {
  return { ...error, details: { ...error.details, commandIndex } } as CanvasError;
}

export function reentrantError(): CanvasError {
  return {
    code: 'REENTRANT_DISPATCH',
    message: 'The canvas section cannot be changed while it is notifying listeners',
    details: {},
  };
}

export function lockedError(id: string, lockedBy: string): CanvasError {
  return {
    code: 'LOCKED',
    message: `${JSON.stringify(id)} cannot be changed: ${JSON.stringify(lockedBy)} is locked`,
    details: { id, lockedBy },
  };
}

export function readOnlyError(): CanvasError {
  return { code: 'READ_ONLY', message: 'The canvas section is read-only', details: {} };
}

export function limitError(
  limit: 'nodes' | 'coordinate' | 'text',
  max: number,
  actual: number,
): CanvasError {
  return {
    code: 'LIMIT_EXCEEDED',
    message: `The document would exceed the ${limit} limit: ${actual} is over ${max}`,
    details: { limit, max, actual },
  };
}

export function unsupportedVersionError(found: number, supported: number): CanvasError {
  return {
    code: 'UNSUPPORTED_VERSION',
    message: `Schema version ${found} is newer than the supported version ${supported}`,
    details: { found, supported },
  };
}

export function disposedError(): CanvasError {
  return { code: 'DISPOSED', message: 'The canvas section has been destroyed', details: {} };
}
