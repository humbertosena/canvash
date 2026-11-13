# @canvash/export

Exportação visual de documentos do Canvash em SVG e PNG.

## Recursos

- `exportSvg(source, options)`: SVG autônomo, com escape de strings e sem conteúdo executável.
- `exportPng(source, options)`: PNG determinístico em Canvas 2D, com verificação de limite de pixels antes de alocar.
- Escopo configurável (documento inteiro, seleção, retângulo explícito ou um board) e espaçamento.

SVG e PNG são exportações visuais. Para um formato editável, use `@canvash/persistence`.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/export
```

Sem peer dependencies. `exportPng` precisa de ambiente com Canvas 2D (navegador).

## Exemplo

```ts
import { createCanvasSection } from '@canvash/core';
import { exportSvg } from '@canvash/export';

const section = createCanvasSection();
section.dispatch({
  type: 'shape.create',
  shape: { type: 'rectangle', x: 20, y: 20, width: 160, height: 90, rotation: 0 },
});

const svg = await exportSvg(section);
if (!svg.ok) throw new Error(svg.error.message);
console.log(svg.value.startsWith('<svg')); // true
```

`source` aceita uma `section` ou um documento.

## Depende de

- `@canvash/core`
- `@canvash/renderer-canvas2d`

## Licença

MIT.
