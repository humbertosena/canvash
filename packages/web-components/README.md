# @canvash/web-components

O editor do Canvash como Web Components (Lit): `canvas-section`, `canvas-surface`, `canvas-toolbar`, `canvas-layers`, `canvas-properties`, `canvas-selection-menu` e `canvas-controls`. Funciona em qualquer framework ou em HTML puro. Para React e Vue, prefira `@canvash/react` e `@canvash/vue`.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-web-components-$V.tgz
```

`lit` vem como dependência. Sem peer dependencies.

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import { CanvasSurfaceElement, defineCanvasElements } from '@canvash/web-components';

defineCanvasElements();

const section = createCanvasSection();
const surface = document.createElement('canvas-surface') as CanvasSurfaceElement;
surface.section = section; // sempre como propriedade, nunca como atributo
surface.style.cssText = 'display:block;width:100%;height:100vh';
document.body.append(surface);
```

O elemento precisa de altura. A aparência se ajusta por variáveis CSS `--canvash-*` e por `::part()`; `CANVASH_CSS_TOKENS` e `CANVASH_PARTS` listam o que existe.

## Depende de

- `@canvash/core`
- `@canvash/interaction`
- `@canvash/renderer-canvas2d`

## Licença

MIT.
