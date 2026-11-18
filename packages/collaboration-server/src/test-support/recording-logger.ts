import type { CollaborationServerLogger, LogFields } from '../logger.js';

export interface LoggedCall {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields | undefined;
}

export interface RecordingLogger extends CollaborationServerLogger {
  readonly calls: LoggedCall[];
  /** Tudo o que foi registrado, em texto, para procurar o que não podia aparecer. */
  dump(): string;
}

/** Logger que guarda as chamadas, em vez de escrever no console. */
export function createRecordingLogger(): RecordingLogger {
  const calls: LoggedCall[] = [];
  const record = (level: LoggedCall['level']) => (message: string, fields?: LogFields) => {
    calls.push({ level, message, fields });
  };
  return {
    calls,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    dump: () => JSON.stringify(calls),
  };
}
