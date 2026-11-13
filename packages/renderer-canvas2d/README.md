# @canvash/renderer-canvas2d

Desenha uma `section` do `@canvash/core` num `<canvas>` 2D nativo: formas, texto, grade, seleção e participantes remotos. Repinta só quando algo muda e acompanha o tamanho do elemento hospedeiro.

Use direto só se for montar a pilha à mão. Os web components, o React e o Vue já o usam.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-renderer-canvas2d-$V.tgz
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
