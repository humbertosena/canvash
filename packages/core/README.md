# @canvash/core

Motor do Canvash, sem DOM e sem framework: documento, formas, camadas, comandos, transações, histórico (undo/redo), seleção, viewport e geometria. Todo o resto da biblioteca é construído sobre ele.

O estado vive em uma `section`. Você lê por `getSnapshot()` e altera só por comandos (`dispatch`, `transact`); cada chamada devolve um `Result` que você precisa conferir.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz
```

Sem peer dependencies e sem dependências de runtime.

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';

const section = createCanvasSection();

const created = section.dispatch({
  type: 'shape.create',
  shape: { type: 'rectangle', x: 60, y: 60, width: 150, height: 100, rotation: 0 },
});
if (!created.ok) throw new Error(created.error.message);

console.log(Object.keys(section.getSnapshot().document.nodes).length); // 1

section.undo();
console.log(Object.keys(section.getSnapshot().document.nodes).length); // 0
```

## Depende de

Nenhum outro `@canvash/*`.

## Licença

MIT.
