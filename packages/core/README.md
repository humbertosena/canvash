# @canvash/core

Motor do Canvash, sem DOM e sem framework: documento, formas, camadas, comandos, transações, histórico (undo/redo), seleção, viewport e geometria. Todo o resto da biblioteca é construído sobre ele.

O estado vive em uma `section`. Você lê por `getSnapshot()` e altera só por comandos (`dispatch`, `transact`); cada chamada devolve um `Result` que você precisa conferir.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core
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
