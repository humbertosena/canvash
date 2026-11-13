# @canvash/react

Componentes e hooks React para o Canvash: `CanvasSection`, `CanvasSurface`, `CanvasToolbar`, `CanvasLayers`, `CanvasProperties`, `CanvasSelectionMenu`, `CanvasControls` e `useCanvasSnapshot`. Embrulham os Web Components de `@canvash/web-components`.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. Aponte o escopo para o seu registro (por exemplo, um Verdaccio local) no `.npmrc` do projeto:

```
@canvash:registry=http://localhost:4873/
```

```
pnpm add @canvash/core @canvash/react react react-dom
```

Peer dependencies: `react` e `react-dom`, versão 18 ou 19.

## Exemplo

```tsx
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection } from '@canvash/core';
import { CanvasSection, CanvasSurface, CanvasToolbar, useCanvasSnapshot } from '@canvash/react';

function App() {
  const [section] = useState(() => createCanvasSection());
  const snapshot = useCanvasSnapshot(section);
  return (
    <CanvasSection section={section} style={{ display: 'block', width: '100%', height: '100%' }}>
      <CanvasSurface section={section} grid ariaLabel="Desenho" />
      <CanvasToolbar slot="toolbar" section={section} orientation="vertical" />
      <output slot="overlay">{Object.keys(snapshot?.document.nodes ?? {}).length}</output>
    </CanvasSection>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

- Crie a `section` uma vez (`useState(() => ...)`); criar no corpo do componente apaga o desenho a cada render.
- O contêiner precisa de altura (`height: 100vh` na raiz, por exemplo).
- Em SSR, importe de `@canvash/react/ssr`, que renderiza um placeholder sem tocar o DOM.

## Tamanho do bundle

Um app mínimo com este exemplo gera cerca de 681 kB minificado (185 kB com gzip), acima do aviso de 500 kB do Vite. Se isso importa, carregue o editor sob demanda com `import()` dinâmico, por rota ou por componente.

## Depende de

- `@canvash/core`
- `@canvash/web-components`

## Licença

MIT.
