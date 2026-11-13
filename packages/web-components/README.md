# @canvash/web-components

O editor do Canvash como Web Components (Lit): `canvas-section`, `canvas-surface`, `canvas-toolbar`, `canvas-layers`, `canvas-properties`, `canvas-selection-menu` e `canvas-controls`. Funciona em qualquer framework ou em HTML puro. Para React e Vue, prefira `@canvash/react` e `@canvash/vue`.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/web-components
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
