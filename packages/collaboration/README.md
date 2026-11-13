# @canvash/collaboration

Contratos genéricos, tipos, limites e indexação fracionária para colaboração em tempo real no Canvash. É independente de qualquer biblioteca CRDT: a implementação com Yjs fica em `@canvash/collaboration-yjs`.

Entrega: a interface de `CollaborationProvider` e `CollaborationSession`, tipos de presença, `bindCanvasPresence` (liga uma sessão a uma `section`), `toShellParticipants` e `generateOrderKey`/`compareOrderKeys`.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-collaboration-$V.tgz
```

Sem peer dependencies. Dependência de runtime: só `@canvash/core`.

## Exemplo

```ts
import { compareOrderKeys, generateOrderKey } from '@canvash/collaboration';

const first = generateOrderKey(null, null, 'a');
const second = generateOrderKey(first, null, 'b');

const items = [
  { id: 'b', orderKey: second },
  { id: 'a', orderKey: first },
];
items.sort(compareOrderKeys);
console.log(items.map((item) => item.id)); // ['a', 'b']
```

## Depende de

- `@canvash/core`

## Licença

MIT.
