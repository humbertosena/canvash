import { resolve } from 'node:path';
import { type CollaborationError, type Result, err, ok } from '@canvash/collaboration';
import type { CliOptions } from './cli-args.js';
import { createCollaborationServer } from './server.js';
import { createFileRoomStorage } from './storage-file.js';
import { listenWebSocket } from './ws/index.js';

export interface CliOutput {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliRun {
  readonly url: string;
  /** A pasta das salas, já absoluta. */
  readonly directory: string;
  /** Primeiro o núcleo (commit em voo termina com recibo), depois a porta. Idempotente. */
  stop(): Promise<void>;
}

/** Sobe o servidor da CLI: núcleo com armazenamento em arquivo e o adaptador `ws`. */
export async function startCli(
  options: CliOptions,
  output: CliOutput,
): Promise<Result<CliRun, CollaborationError>> {
  const directory = resolve(options.data);
  const server = createCollaborationServer({
    storage: createFileRoomStorage({ directory }),
    ...(options.origins === undefined ? {} : { allowedOrigins: options.origins }),
  });
  const listening = await listenWebSocket(server, { port: options.port, host: options.host });
  if (!listening.ok) {
    await server.close();
    return err(listening.error);
  }
  output.err(
    'canvash-collab-server: servidor de DESENVOLVIMENTO. Não autentica ninguém (todo cliente escreve) e não usa TLS; não o exponha à internet.',
  );
  output.out(`canvash-collab-server escutando em ${listening.value.url} (salas em ${directory})`);

  let stopping: Promise<void> | undefined;
  return ok({
    url: listening.value.url,
    directory,
    stop(): Promise<void> {
      stopping ??= (async () => {
        await server.close();
        await listening.value.close();
      })();
      return stopping;
    },
  });
}
