# @canvash/interaction

Interações do Canvash sobre um elemento do DOM: ponteiro, toque, roda do mouse, teclado e gestos. Cuida de seleção, mover, redimensionar, desenhar formas, caneta, borracha, texto e pan/zoom, e executa tudo como comandos do `@canvash/core`.

Use direto só se for montar a pilha à mão. Com `@canvash/web-components`, `@canvash/react` ou `@canvash/vue`, ele já vem ligado.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/interaction
```

Sem peer dependencies. Roda no navegador (precisa de `HTMLElement`).

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import { attachInteractions } from '@canvash/interaction';

const section = createCanvasSection();
const element = document.querySelector<HTMLElement>('#canvas-host');
if (element === null) throw new Error('#canvas-host não existe');

const interactions = attachInteractions({ section, element });

section.setTool('rectangle');
// ... o usuário desenha no elemento ...

interactions.destroy(); // remove todos os listeners
```

## Depende de

- `@canvash/core`

## Licença

MIT.
