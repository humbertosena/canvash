/**
 * Campos que o servidor aceita registrar: identificadores, códigos, tamanhos e tempos. Nunca
 * credencial, cabeçalho, bytes de update nem conteúdo de presença (R9, R19).
 */
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface CollaborationServerLogger {
  /** Detalhe de operação, como uma conexão recusada. O padrão não o escreve. */
  info?(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

// Formato constante: a mensagem entra como argumento, e um `%` nela não vira especificador.
const FORMAT = '[canvash-collab] %s';

/** Padrão: só `warn` e `error`, no console. */
export const consoleLogger: CollaborationServerLogger = {
  warn(message, fields) {
    if (fields === undefined) console.warn(FORMAT, message);
    else console.warn(FORMAT, message, fields);
  },
  error(message, fields) {
    if (fields === undefined) console.error(FORMAT, message);
    else console.error(FORMAT, message, fields);
  },
};
