# @canvash/interaction

Interações do Canvash sobre um elemento do DOM: ponteiro, toque, roda do mouse, teclado e gestos. Cuida de seleção, mover, redimensionar, desenhar formas, caneta, borracha, texto e pan/zoom, e executa tudo como comandos do `@canvash/core`.

Use direto só se for montar a pilha à mão. Com `@canvash/web-components`, `@canvash/react` ou `@canvash/vue`, ele já vem ligado.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-interaction-$V.tgz
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
