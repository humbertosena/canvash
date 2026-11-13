# @canvash/vue

Componentes e composables Vue 3 para o Canvash: `CanvasSection`, `CanvasSurface`, `CanvasToolbar`, `CanvasLayers`, `CanvasProperties`, `CanvasSelectionMenu`, `CanvasControls` e `useCanvasSnapshot`. Embrulham os Web Components de `@canvash/web-components`.

## Instalação

Os pacotes `@canvash/*` não estão no npm: cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote, e o app aponta o `pnpm add` para a URL deles. Antes de instalar, libere `blockExoticSubdeps: false` no `pnpm-workspace.yaml` do app; o motivo e o passo a passo estão na seção [Instalação do README do repositório](https://github.com/humbertosena/canvash#instalação).

```bash
V=0.1.0-alpha # a versão da Release
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-vue-$V.tgz vue
```

Peer dependency: `vue`, versão 3.4 ou 3.5.

## Exemplo

```ts
import { createApp, defineComponent, h } from 'vue';
import { createCanvasSection } from '@canvash/core';
import { CanvasSection, CanvasSurface, CanvasToolbar } from '@canvash/vue';

const App = defineComponent({
  setup() {
    const section = createCanvasSection();
    return () =>
      h(
        CanvasSection,
        { section, style: 'display:block;width:100%;height:100vh' },
        () => [
          h(CanvasSurface, { section, grid: true, ariaLabel: 'Desenho' }),
          h(CanvasToolbar, { slot: 'toolbar', section, orientation: 'vertical' }),
        ],
      );
  },
});

createApp(App).mount('#app');
```

O contêiner precisa de altura. Em SSR, importe de `@canvash/vue/ssr`.

## Depende de

- `@canvash/core`
- `@canvash/web-components`

## Licença

MIT.
