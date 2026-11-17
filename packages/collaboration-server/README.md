# @canvash/collaboration-server

Servidor Node de referência da colaboração do Canvash: salas por documento, handshake, confirmação durável de commits e armazenamento plugável, independente do meio de transporte. É um servidor de referência, não um produto: hospedagem, TLS, banco e política de acesso são do host.

## Estado desta versão

Pacote em construção: a primeira Release que o traz é a `0.2.0-alpha.1`. Nesta etapa ele só exporta a própria versão; o núcleo do servidor, o armazenamento e o adaptador `ws` entram nas próximas. Só roda em Node 22 ou mais novo: não importe este pacote no navegador.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha.1 # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-collaboration-$V.tgz \
  $B/canvash-collaboration-yjs-$V.tgz $B/canvash-collaboration-server-$V.tgz
```

Sem peer dependencies. `yjs` vem como dependência.

## Exemplo

```ts
import { COLLABORATION_SERVER_VERSION } from '@canvash/collaboration-server';

console.log(`servidor de colaboração Canvash ${COLLABORATION_SERVER_VERSION}`);
```

## Depende de

- `@canvash/core`
- `@canvash/collaboration`
- `@canvash/collaboration-yjs`

## Licença

MIT.
