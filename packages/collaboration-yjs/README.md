# @canvash/collaboration-yjs

Provider de colaboração em tempo real do Canvash baseado em Yjs: sincronização CRDT determinística, resolução de conflitos por unidade (geometria, estilo, posicionamento, texto), histórico por origem com `Y.UndoManager`, presença por Awareness e confirmação durável de commits.

## Estado desta versão

O provider desta versão conversa com um servidor **emulado em memória** (`CollaborativeServerEmulator` e `DeterministicTransportHub`), pensado para testes e demonstrações: várias sessões no mesmo processo, ligadas ao mesmo `YjsCollaborationProvider`. Cada provider tem o próprio servidor emulado, então abas do navegador não se enxergam sem uma ponte que você escreva (os exemplos do repositório fazem isso com `BroadcastChannel`). **Ainda não há transporte de rede**: duas máquinas não colaboram só com este pacote.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
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

## Depende de

- `@canvash/core`
- `@canvash/collaboration`

## Licença

MIT.
