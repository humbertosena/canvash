# @canvash/collaboration-yjs

Provider de colaboração em tempo real do Canvash baseado em Yjs: sincronização CRDT determinística, resolução de conflitos por unidade (geometria, estilo, posicionamento, texto), histórico por origem com `Y.UndoManager`, presença por Awareness e confirmação durável de commits.

## Transportes

O provider fala com a sala por um transporte, e há três jeitos de ligá-lo:

- **Sem opções** (`new YjsCollaborationProvider()`): um servidor emulado em memória (`CollaborativeServerEmulator` e `DeterministicTransportHub`), para testes e demonstrações. Várias sessões no mesmo processo se enxergam; abas do navegador, não.
- **Em rede**, com `createWebSocketTransport`: o navegador (ou o Node 22+) fala por WebSocket com o `@canvash/collaboration-server` ou com qualquer servidor do protocolo Canvash. O transporte abre, faz o handshake, correlaciona pedidos e respostas, detecta a queda e reconecta com backoff; pendências e reenvio são da sessão, que não perde commit. Ver o exemplo abaixo e o guia [`docs/colaboracao-em-rede.md`](https://github.com/humbertosena/canvash/blob/main/docs/colaboracao-em-rede.md).
- **Transporte próprio** (SSE e POST, o WebSocket do seu framework...): implemente `CollaborationTransport` (de `@canvash/collaboration`) e passe a fábrica em `createTransport`. A entrada `@canvash/collaboration-yjs/testing` traz `transportContractCases`, a suíte de contrato que o seu transporte tem de passar; `encodeFrameAsText` e `decodeFrameFromText`, de `@canvash/collaboration`, codificam os quadros do protocolo em texto para meios que não carregam binário.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha.1 # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-collaboration-$V.tgz $B/canvash-collaboration-yjs-$V.tgz
```

Sem peer dependencies. `yjs` vem como dependência.

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import { YjsCollaborationProvider } from '@canvash/collaboration-yjs';

const section = createCanvasSection();
const provider = new YjsCollaborationProvider();

const connected = await provider.connect({
  documentId: 'sala-1',
  section,
  user: { id: 'ana', name: 'Ana', color: '#2563eb' },
});
if (!connected.ok) throw new Error(connected.error.message);

const session = connected.value;
session.onStatusChange((status) => console.log('status:', status));
session.onPresenceChange((presences) => console.log('participantes:', presences.length));

// ... edições na section são sincronizadas ...

await session.leave();
```

## Colaboração em rede

```ts
import { createCanvasSection } from '@canvash/core';
import { YjsCollaborationProvider, createWebSocketTransport } from '@canvash/collaboration-yjs';

const provider = new YjsCollaborationProvider({
  createTransport: createWebSocketTransport({
    url: 'wss://exemplo.com/collab', // ws:// só para localhost, 127.0.0.1 e ::1
    // Chamado a cada conexão, inclusive nas reconexões: bom para token que expira.
    getCredentials: async () => ({ token: await renovarToken() }),
  }),
});

const section = createCanvasSection();
const connected = await provider.connect({ documentId: 'desenho-42', section, seedEmptyRoom: false });
if (!connected.ok) throw new Error(connected.error.message); // código tipado: UNAUTHORIZED, NOT_FOUND...

const session = connected.value;
session.onStatusChange((status, error) => {
  // 'reconnecting' vem da rede e volta sozinho; 'error' (expulsão, acesso revogado, versão
  // incompatível) não tenta de novo: o código do erro diz o que aconteceu.
  console.log(status, error?.code);
});
session.onCommitReceipt((receipt) => console.log('gravado no servidor:', receipt.commitId));
```

As credenciais vão só no `hello` do protocolo, nunca na URL. Erros que não adianta repetir (`UNAUTHORIZED`, `NOT_FOUND`, epoch ou versão incompatíveis, sessão substituída por outra aba) encerram as tentativas e chegam à sessão com o código; falha de rede, timeout e sala cheia reconectam com backoff exponencial e jitter. Opções: `openTimeoutMs` (10 s), `requestTimeoutMs` (30 s), `backoff` (500 ms a 30 s, fator 2), `maxFrameBytes` e `presenceBackpressureBytes`.

## Depende de

- `@canvash/core`
- `@canvash/collaboration`

## Licença

MIT.
