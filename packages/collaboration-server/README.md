# @canvash/collaboration-server

Servidor Node de referência da colaboração do Canvash: salas por documento, handshake, confirmação durável de commits e armazenamento plugável, independente do meio de transporte. É um servidor de referência, não um produto: hospedagem, TLS, banco e política de acesso são do host.

## O que traz

- **Núcleo, independente do meio** (`createCollaborationServer`): recebe uma `ServerConnection` (quadros binários de entrada e de saída, fechamento) e cuida do handshake, das salas, da validação e da gravação dos commits, da presença e do encerramento. Não importa `ws`; serve a qualquer meio que entregue quadros, como o WebSocket do seu framework ou SSE com POST.
- **Adaptador `ws`** (`@canvash/collaboration-server/ws`): `listenWebSocket` sobe o servidor HTTP e o WebSocket em `127.0.0.1`, e `attachWebSocketServer` liga o núcleo a um `WebSocketServer` que você já tem. Faz o heartbeat e recusa com HTTP 403, já no upgrade, a origem fora de `allowedOrigins`.
- **Armazenamento** (`RoomStorage`): `createMemoryRoomStorage` e `createFileRoomStorage` (um diretório por sala, com `fsync`, geração atômica na compactação e recuperação do fim truncado do log). O host escreve o próprio, por exemplo sobre o banco dele, e confere com `roomStorageContractCases`, de `@canvash/collaboration-server/testing`.
- **CLI de desenvolvimento** (`canvash-collab-server`): núcleo, armazenamento em arquivo e `ws`, sem autenticação.

É um servidor de referência, não um produto: autenticação, TLS, hospedagem e política de acesso são do host. Só roda em Node 22 ou mais novo: não importe este pacote no navegador.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.2.0-alpha.1 # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-collaboration-$V.tgz \
  $B/canvash-collaboration-yjs-$V.tgz $B/canvash-collaboration-server-$V.tgz
```

Sem peer dependencies. `yjs` e `ws` vêm como dependências.

## Exemplo

### Pela CLI, para desenvolver

```bash
# o pacote traz o executável `canvash-collab-server`
pnpm exec canvash-collab-server --port 4321 --data ./rooms --origin http://localhost:5173
# canvash-collab-server escutando em ws://127.0.0.1:4321/collab (salas em /…/rooms)
```

`--port 0` escolhe uma porta livre; `--host`, `--data` e `--origin` (repetível) completam as opções, e `--help` lista tudo. A CLI avisa que é de desenvolvimento: todo cliente escreve, sem TLS. `SIGINT` e `SIGTERM` esperam os commits em voo e saem com 0. O cliente é o `createWebSocketTransport` de `@canvash/collaboration-yjs` (ver o [guia](https://github.com/humbertosena/canvash/blob/main/docs/colaboracao-em-rede.md)).

### Como biblioteca, com WebSocket

```ts
import { createCollaborationServer, createFileRoomStorage } from '@canvash/collaboration-server';
import { listenWebSocket } from '@canvash/collaboration-server/ws';

const server = createCollaborationServer({
  storage: createFileRoomStorage({ directory: './rooms' }),
  allowedOrigins: ['https://app.exemplo.com'],
  authorize: async ({ documentId, sessionId, credentials, headers, context }) => {
    const user = await verifySession(headers.get('cookie'), credentials?.token);
    if (user === undefined) return { allow: false }; // UNAUTHORIZED
    if (!(await canRead(user, documentId))) return { allow: false, code: 'NOT_FOUND' };
    return {
      allow: true,
      access: (await canWrite(user, documentId)) ? 'write' : 'read',
      user: { id: user.id, name: user.name }, // vai ao welcome e é imposto na presença
    };
  },
});

const listening = await listenWebSocket(server, { port: 4321 }); // 127.0.0.1, /collab
if (!listening.ok) throw new Error(listening.error.message);
console.log(listening.value.url);

// Ao encerrar: primeiro o núcleo (commit em voo termina com recibo), depois a porta.
await server.close();
await listening.value.close();
```

`authorize` recebe os cabeçalhos do upgrade (cookies, `Authorization`), o `Origin`, as credenciais que o cliente mandou no `hello` e o `context` que o seu meio entregou (no adaptador `ws`, a `IncomingMessage`). Exceção ou resposta fora do contrato contam como `UNAUTHORIZED`. Sem `authorize`, todo cliente escreve, e o servidor avisa no logger; o logger nunca recebe credencial, cabeçalho, bytes de update nem presença.

### Só o núcleo, por uma conexão qualquer

```ts
import { createCollaborationServer, createMemoryRoomStorage } from '@canvash/collaboration-server';
import type { ServerConnection } from '@canvash/collaboration-server';

const server = createCollaborationServer({ storage: createMemoryRoomStorage() });

// `MeuSocket` é o meio do host: entrega e recebe quadros binários e avisa o fechamento.
function onConnect(socket: MeuSocket, headers: Headers): void {
  const connection: ServerConnection = {
    send: (frame) => socket.send(frame),
    close: (code, reason) => socket.close(code, reason),
    onFrame: (listener) => socket.onMessage(listener), // devolve a função que tira o ouvinte
    onClose: (listener) => socket.onClose(listener),
  };
  server.handleConnection(connection, { headers });
}
```

Num meio sem conexão única, como SSE com POST, ligar cada POST à conexão certa (e à mesma identidade) é do host: o núcleo confia na `ServerConnection` que recebe.

## Armazenamento do host

`RoomStorage` tem cinco métodos (`load`, `create`, `append`, `compact` e `reset`) e um contrato de **estado, não de formato**: aplicar `snapshot` e depois `log` tem de reproduzir todos os lotes confirmados.

- **`load` estável.** Duas cargas seguidas, mesmo com um reinício no meio, devolvem o mesmo `snapshot` e a mesma `roomEpoch`. O host que semeia a sala a partir do JSON salvo gera o estado com `encodeCanvasDocumentAsYjsState` (de `@canvash/collaboration-yjs`) uma única vez, grava e só então o devolve.
- **`append` recebe um lote** (`AppendBatch`): os commits em ordem, o `document` projetado e validado depois do último (com o `id` original) e `encodeSnapshot()`, que só é calculado se for chamado e só vale durante o `append`. Um armazenamento de uma linha por sala grava o `document` ou o snapshot e devolve `log` vazio; um com log grava só os commits. Só resolve `ok` com o lote inteiro gravado de forma durável: o `ack` só sai depois.
- **Recibos são opcionais.** O servidor deduplica por `commitId` com os recibos que o armazenamento devolver; quem guarda menos, ou nenhum, recebe o commit reenviado de novo: o documento não muda (o Yjs é idempotente) e o recibo sai novo. `receiptRetentionMs` poda por idade na compactação.

## Operação

- `server.compact(documentId)`: grava o snapshot e esvazia o log; `server.rotateEpoch(documentId, { snapshot? })`: começa uma epoch nova e derruba os conectados com `ROOM_EPOCH_MISMATCH`.
- `server.disconnect(documentId, { userId?, sessionId? }, erro)`: expulsa, com o erro dado como fatal (`NOT_FOUND`, `UNAUTHORIZED`...); o cliente não reconecta. Filtro vazio derruba todos e descarrega a sala. O servidor nunca apaga dados do armazenamento.
- `server.getRoomStats(documentId)`: clientes, recibos e presenças descartadas.
- Limites configuráveis: `maxClientsPerRoom` (50), `maxRooms` (1000), `roomIdleMs` (60 s), `maxFrameBytes` (32 MiB), `maxPresenceBytes` (16 KiB), `presenceRateHz` (20), `maxBatchCommits` (64).
- Medido (Apple M4 Pro, Node 26): numa sala de 10.000 nós o ACK tem p95 de 43 ms com armazenamento em arquivo, e o `welcome` pesa 3,6 MiB.

## Depende de

- `@canvash/core`
- `@canvash/collaboration`
- `@canvash/collaboration-yjs`

## Licença

MIT.
