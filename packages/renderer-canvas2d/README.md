# @canvash/renderer-canvas2d

Desenha uma `section` do `@canvash/core` num `<canvas>` 2D nativo: formas, texto, grade, seleção e participantes remotos. Repinta só quando algo muda e acompanha o tamanho do elemento hospedeiro.

Use direto só se for montar a pilha à mão. Os web components, o React e o Vue já o usam.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/renderer-canvas2d
```

Sem peer dependencies. Roda no navegador (precisa de `HTMLElement` e de contexto 2D).

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import { mount } from '@canvash/renderer-canvas2d';

const section = createCanvasSection();
const container = document.querySelector<HTMLElement>('#canvas-host');
if (container === null) throw new Error('#canvas-host não existe');

const mounted = mount({ section, container });
if (!mounted.ok) throw new Error(`renderer: ${mounted.error.code}`);

section.dispatch({
  type: 'shape.create',
  shape: { type: 'circle', x: 100, y: 100, width: 120, height: 120, rotation: 0 },
});

mounted.value.destroy();
```

O elemento hospedeiro precisa ter altura.

## Depende de

- `@canvash/core`

## Licença

MIT.
