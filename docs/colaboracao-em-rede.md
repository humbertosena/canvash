# Colaboração em rede

Duas pessoas, ou dois processos, editando o mesmo desenho por uma rede: o `@canvash/collaboration-yjs` abre o enlace e o `@canvash/collaboration-server` guarda a sala. Este guia mostra o caminho mais curto, como a rede se comporta quando cai e o que o host (o seu backend) escreve no lugar de cada peça.

Conferido em 2026-11-17, com Node 26.0.0 e pnpm 11.1.2, instalando só os tarballs dos pacotes (gerados por `pnpm pack`) num app vazio: a CLI, o `colaborar.mjs` e o `SIGTERM` foram executados como estão, e o contrato de empacotamento repete o mesmo roteiro a cada rodada. As URLs da Release só existem depois da publicação da `0.2.0-alpha.1`.

## As peças

| Peça | O que faz |
| --- | --- |
| `@canvash/collaboration` | O protocolo (`hello`, `commit`, `presence`...), o codec binário e em texto, a interface `CollaborationTransport` e a suíte de tipos da sessão |
| `@canvash/collaboration-yjs` | O provider Yjs; `createWebSocketTransport` (o cliente de rede); a suíte de contrato do transporte (`/testing`) |
| `@canvash/collaboration-server` | O núcleo do servidor sobre uma conexão genérica; o armazenamento (memória e arquivo); o adaptador `ws`; a CLI de desenvolvimento |

O servidor confirma um commit só **depois de gravá-lo** (o `ack` carrega um recibo durável), valida cada commit contra as regras do documento e carimba a identidade de quem publica presença.

## Começando

Instale os quatro pacotes numa pasta de app (ver a [instalação no README](../README.md#instalação) para a URL da Release e o `blockExoticSubdeps`):

```bash
V=0.2.0-alpha.1 # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-collaboration-$V.tgz \
  $B/canvash-collaboration-yjs-$V.tgz $B/canvash-collaboration-server-$V.tgz
```

Suba o servidor de desenvolvimento (a CLI vem no pacote) e deixe-o num terminal:

```bash
pnpm exec canvash-collab-server --port 4321 --data ./rooms
# canvash-collab-server escutando em ws://127.0.0.1:4321/collab (salas em …/rooms)
# canvash-collab-server: servidor de DESENVOLVIMENTO. Não autentica ninguém (todo cliente escreve)…
```

Em outro arquivo, `colaborar.mjs`, dois providers falam com ele (Node 22 ou mais novo tem `WebSocket` global; no navegador é o mesmo código):

```js
import { createCanvasSection } from '@canvash/core';
import { YjsCollaborationProvider, createWebSocketTransport } from '@canvash/collaboration-yjs';

const url = 'ws://127.0.0.1:4321/collab';
const open = async (user) => {
  const provider = new YjsCollaborationProvider({
    createTransport: createWebSocketTransport({ url }),
  });
  const section = createCanvasSection();
  const connected = await provider.connect({
    documentId: 'desenho-42',
    section,
    user,
    seedEmptyRoom: false, // o servidor é quem guarda a sala
  });
  if (!connected.ok) throw new Error(connected.error.message);
  return { section, session: connected.value };
};

const ana = await open({ id: 'ana', name: 'Ana' });
const caio = await open({ id: 'caio', name: 'Caio' });

ana.section.dispatch({
  type: 'shape.create',
  shape: { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 80, height: 40, rotation: 0 },
});
await new Promise((resolve) => setTimeout(resolve, 600));
console.log('Caio vê:', Object.keys(caio.section.getSnapshot().document.nodes)); // [ 'r1' ]
console.log('pendências da Ana:', ana.session.getPending()); // { count: 0, bytes: 0 }: tudo gravado
ana.session.destroy();
caio.session.destroy();
```

```bash
node colaborar.mjs
# Caio vê: [ 'r1' ]
# pendências da Ana: { count: 0, bytes: 0 }
ls rooms/desenho-42
# log.0.bin  receipts.0.bin  room.json  snapshot.0.bin
```

`Ctrl+C` (ou `SIGTERM`) no servidor espera os commits em voo e sai. Reiniciar a CLI na mesma pasta devolve a sala e os mesmos recibos.

## Quando a rede cai

O transporte reconecta sozinho, com backoff exponencial e jitter (500 ms a 30 s), e a sessão cuida do resto:

- Os commits locais ficam **pendentes** (`session.getPending()`) com o mesmo `commitId` e são reenviados na volta; o servidor devolve o mesmo recibo se já os tinha gravado, então nada se duplica.
- Na volta, o `hello` leva o vetor de estado atual da sessão, e o servidor responde só com o que falta. A sessão reanuncia a presença logo em seguida, sem esperar o heartbeat.
- O status da sessão vai a `reconnecting` e volta a `connected`. Erros que não adianta repetir (`UNAUTHORIZED`, `NOT_FOUND`, epoch ou versão incompatíveis, sessão substituída por outra aba, origem recusada) levam a `error` com o código e **não** tentam de novo. É assim que o seu backend expulsa alguém (ver abaixo).
- A rede que cai sem aviso é detectada por `requestTimeoutMs` (padrão 30 s) e pelo heartbeat do servidor; uma reconexão da mesma sessão antes de o servidor notar substitui a conexão antiga (fechamento 4001).

## Integrando ao seu backend

### Quem pode entrar

`authorize` é o ponto de decisão. Ele recebe o documento, a sessão, as credenciais do `hello`, a origem e os **cabeçalhos do upgrade** (cookie, `Authorization`), e devolve o acesso (`read` ou `write`) e a identidade, ou a recusa:

```ts
authorize: async ({ documentId, credentials, headers }) => {
  const user = await verifySession(headers.get('cookie'), credentials?.token);
  if (user === undefined) return { allow: false }; // UNAUTHORIZED, fatal
  if (!(await canRead(user, documentId))) return { allow: false, code: 'NOT_FOUND' }; // esconde que existe
  return { allow: true, access: (await canWrite(user, documentId)) ? 'write' : 'read', user: { id: user.id, name: user.name } };
},
```

A identidade que o `authorize` devolve vai no `welcome` e é **imposta** na presença dos outros (um cliente não se faz passar por outro). `allowedOrigins` fecha a conexão de uma origem fora da lista antes de qualquer mensagem (HTTP 403 no upgrade do adaptador `ws`); um cliente Node não manda `Origin`, então não passa de um servidor com a lista. As credenciais vão só no `hello`, nunca na URL.

### Onde a sala mora

Escreva um `RoomStorage` sobre o seu banco (cinco métodos) e confira com `roomStorageContractCases`, de `@canvash/collaboration-server/testing`. A regra que mais importa é a do **`load` estável**: o que `load` devolve tem de estar gravado, de modo que duas cargas, mesmo com um reinício no meio, devolvam o mesmo `snapshot` e a mesma `roomEpoch`. Para abrir uma sala a partir do JSON que você já guarda, gere o estado uma única vez com `encodeCanvasDocumentAsYjsState`, grave e devolva-o. O README de `@canvash/collaboration-server` detalha o lote do `append` e os recibos opcionais.

### Expulsar, compactar, trocar a epoch

```ts
await server.disconnect('desenho-42', { userId: 'ana' }, { code: 'NOT_FOUND', message: 'Desenho excluído.' });
await server.compact('desenho-42'); // snapshot novo, log vazio, recibos preservados
await server.rotateEpoch('desenho-42', { snapshot }); // sala nova; quem estava conectado é derrubado
```

A sessão expulsa vai a `error` com o código dado e não reconecta. `compact` não derruba ninguém.

### Outro meio de transporte

O núcleo só conhece uma `ServerConnection` (`send`, `close`, `onFrame`, `onClose`), e o cliente só conhece a interface `CollaborationTransport`. Para SSE com POST, ou o WebSocket do seu framework: no servidor, monte a `ServerConnection` sobre o seu meio e chame `server.handleConnection(connection, { headers })` (exemplo no README do servidor); no cliente, implemente `CollaborationTransport` e confira-o com `transportContractCases`. `encodeFrameAsText` e `decodeFrameFromText` (de `@canvash/collaboration`) levam o quadro binário como base64, para meios sem binário.

## Limites e medidas

- Padrões do servidor: 50 clientes por sala, 1000 salas carregadas, sala ociosa descarregada em 60 s, quadro de até 32 MiB, presença de até 16 KiB e 20 por segundo por sessão. Tudo configurável.
- Medido (Apple M4 Pro, Node 26.0.0, 2026-11-17): numa sala de 10.000 nós o ACK tem p50 de 33 ms e p95 de 43 ms com armazenamento em arquivo, o `welcome` pesa 3,6 MiB, e a reprojeção no cliente leva p95 de 60 ms. Cada sala carregada guarda duas cópias do documento na memória.
- Sem TLS, autenticação ou limite de taxa de conexões no servidor de referência: isso é do host (proxy reverso com `wss://`, o seu `authorize`).
- Ainda não há persistência offline, hook React nem demo de colaboração em rede: são os módulos seguintes do mapa.
