# @canvash/collaboration

Contratos genéricos, tipos, limites e indexação fracionária para colaboração em tempo real no Canvash. É independente de qualquer biblioteca CRDT: a implementação com Yjs fica em `@canvash/collaboration-yjs`.

Entrega: a interface de `CollaborationProvider` e `CollaborationSession`, tipos de presença, `bindCanvasPresence` (liga uma sessão a uma `section`), `toShellParticipants` e `generateOrderKey`/`compareOrderKeys`.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/collaboration
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
