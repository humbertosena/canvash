export interface CliOptions {
  readonly help: boolean;
  readonly port: number;
  readonly host: string;
  readonly data: string;
  /** `undefined`: qualquer origem. */
  readonly origins: readonly string[] | undefined;
}

export type CliParse =
  | { readonly ok: true; readonly value: CliOptions }
  | { readonly ok: false; readonly error: string };

export const HELP_TEXT = `Uso: canvash-collab-server [opções]

Servidor de colaboração do Canvash para DESENVOLVIMENTO: guarda as salas em arquivos, não
autentica ninguém (todo cliente escreve) e não usa TLS. Não o exponha à internet.

Opções:
  --port <n>       Porta. Padrão 4321; 0 escolhe uma livre.
  --host <h>       Endereço. Padrão 127.0.0.1 (só a máquina local).
  --data <pasta>   Pasta das salas. Padrão ./canvash-rooms.
  --origin <url>   Origem aceita, em comparação exata; repita ou separe por vírgula.
                   Sem ela, qualquer origem é aceita.
  --help           Mostra esta ajuda.

O caminho do WebSocket é /collab. SIGINT e SIGTERM encerram o servidor sem perder commit.
`;

const DEFAULTS: CliOptions = {
  help: false,
  port: 4321,
  host: '127.0.0.1',
  data: './canvash-rooms',
  origins: undefined,
};

const VALUE_FLAGS = new Set(['--port', '--host', '--data', '--origin']);

/** Lê os argumentos da linha de comando. Nunca lança: o erro volta explicado. */
export function parseCliArgs(args: readonly string[]): CliParse {
  if (args.includes('--help')) return { ok: true, value: { ...DEFAULTS, help: true } };
  let port = DEFAULTS.port;
  let host = DEFAULTS.host;
  let data = DEFAULTS.data;
  const origins: string[] = [];
  let originGiven = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    const equals = argument.indexOf('=');
    const flag = argument.startsWith('--') && equals > 0 ? argument.slice(0, equals) : argument;
    if (!VALUE_FLAGS.has(flag)) {
      return {
        ok: false,
        error: argument.startsWith('--')
          ? `Opção desconhecida: ${argument}.`
          : `Argumento inesperado: ${argument}.`,
      };
    }
    let value: string | undefined;
    if (argument.startsWith('--') && equals > 0) value = argument.slice(equals + 1);
    else {
      index += 1;
      value = args[index];
    }
    if (value === undefined) return { ok: false, error: `${flag} pede um valor.` };

    if (flag === '--port') {
      const parsed = Number(value);
      if (!/^\d+$/.test(value) || parsed > 65_535) {
        return { ok: false, error: `--port pede um número de 0 a 65535, e veio "${value}".` };
      }
      port = parsed;
    } else if (flag === '--host') {
      if (value === '') return { ok: false, error: '--host não pode ser vazio.' };
      host = value;
    } else if (flag === '--data') {
      if (value === '') return { ok: false, error: '--data não pode ser vazio.' };
      data = value;
    } else {
      originGiven = true;
      for (const origin of value.split(',')) {
        const trimmed = origin.trim();
        if (trimmed !== '') origins.push(trimmed);
      }
    }
  }
  if (originGiven && origins.length === 0) {
    return { ok: false, error: '--origin pede ao menos uma origem.' };
  }
  return {
    ok: true,
    value: { help: false, port, host, data, origins: originGiven ? origins : undefined },
  };
}
