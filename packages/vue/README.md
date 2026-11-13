# @canvash/vue

Componentes e composables Vue 3 para o Canvash: `CanvasSection`, `CanvasSurface`, `CanvasToolbar`, `CanvasLayers`, `CanvasProperties`, `CanvasSelectionMenu`, `CanvasControls` e `useCanvasSnapshot`. Embrulham os Web Components de `@canvash/web-components`.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/vue vue
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
