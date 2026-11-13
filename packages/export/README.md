# @canvash/export

Exportação visual de documentos do Canvash em SVG e PNG.

## Recursos

- `exportSvg(source, options)`: SVG autônomo, com escape de strings e sem conteúdo executável.
- `exportPng(source, options)`: PNG determinístico em Canvas 2D, com verificação de limite de pixels antes de alocar.
- Escopo configurável (documento inteiro, seleção, retângulo explícito ou um board) e espaçamento.

SVG e PNG são exportações visuais. Para um formato editável, use `@canvash/persistence`.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-export-$V.tgz
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
