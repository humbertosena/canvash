# Canvash

Biblioteca de canvas para desenho e quadros colaborativos na web. O motor não depende de DOM nem de framework; sobre ele há renderização em Canvas 2D, interações, persistência, exportação, colaboração CRDT (Yjs; nesta alpha o transporte dos exemplos é entre abas do mesmo navegador, sem servidor de rede) e adaptadores para React, Vue e Web Components.

> **Versão `0.1.0-alpha`.** Primeira liberação alpha: a API pode mudar entre versões alpha sem aviso de depreciação. Os pacotes ainda não estão no npmjs; veja [Instalação](#instalação).

## Pacotes

Todos os pacotes são publicados juntos, na mesma versão.

| Pacote | O que faz |
| --- | --- |
| [`@canvash/core`](./packages/core) | Motor headless: documento, formas, camadas, comandos, histórico, seleção, viewport e geometria |
| [`@canvash/renderer-canvas2d`](./packages/renderer-canvas2d) | Desenho da cena e do viewport em Canvas 2D nativo |
| [`@canvash/interaction`](./packages/interaction) | Ponteiro, teclado e gestos sobre a sessão |
| [`@canvash/persistence`](./packages/persistence) | Serialização canônica, migrações e autosave |
| [`@canvash/export`](./packages/export) | Exportação para SVG e PNG |
| [`@canvash/collaboration`](./packages/collaboration) | Contratos e abstrações de colaboração |
| [`@canvash/collaboration-yjs`](./packages/collaboration-yjs) | Provider CRDT em tempo real sobre Yjs |
| [`@canvash/web-components`](./packages/web-components) | Componentes Web (Lit) prontos para uso |
| [`@canvash/react`](./packages/react) | Componentes e hooks React |
| [`@canvash/vue`](./packages/vue) | Componentes e composables Vue 3 |

O estado vive numa `section`. Você lê por `getSnapshot()` e altera só por comandos (`dispatch`, `transact`), que devolvem um `Result` a conferir.

## Instalação

Os pacotes `@canvash/*` ainda não estão no npmjs. O fluxo atual publica num registro npm **local** (Verdaccio) e consome de lá. O passo a passo, do registro ao app novo, está em [`docs/publicacao-local.md`](./docs/publicacao-local.md).

No app que vai usar a biblioteca, aponte o escopo para o registro no `.npmrc`:

```
@canvash:registry=http://localhost:4873/
```

```bash
pnpm add @canvash/core @canvash/react
```

## Exemplo mínimo (React)

```tsx
import { useState } from 'react';
import { createCanvasSection } from '@canvash/core';
import { CanvasSection, CanvasSurface, CanvasToolbar, useCanvasSnapshot } from '@canvash/react';

export default function App() {
  const [section] = useState(() => createCanvasSection());
  const snapshot = useCanvasSnapshot(section);
  return (
    <CanvasSection section={section} style={{ display: 'block', width: '100%', height: '100%' }}>
      <CanvasSurface section={section} grid ariaLabel="Desenho" />
      <CanvasToolbar slot="toolbar" section={section} orientation="vertical" />
      <output slot="overlay">{Object.keys(snapshot?.document.nodes ?? {}).length} nós</output>
    </CanvasSection>
  );
}
```

O canvas ocupa `100%` da altura do pai: dê altura a `html`, `body` e ao elemento raiz, ou ele não aparece.

Para quem usa agentes de IA na criação de um projeto novo sobre a Canvash, o guia objetivo está em [`docs/guia-para-agentes.md`](./docs/guia-para-agentes.md).

## Exemplos

A pasta [`examples/`](./examples) tem quatro aplicações que usam os pacotes do próprio repositório:

```bash
pnpm dev:vanilla   # TypeScript puro (padrão de `pnpm dev`)
pnpm dev:react
pnpm dev:vue
pnpm dev:wc        # Web Components
```

O servidor sobe em `http://127.0.0.1:5173/`.

## Desenvolvimento

Requisitos: Node `^22.13`, `^24` ou `>=26` e pnpm `11.1.2` (campo `packageManager`).

```bash
pnpm install
pnpm build            # gera o dist de cada pacote
```

A qualidade é um contrato escrito em [`CONSTRAINTS.md`](./CONSTRAINTS.md): leia antes de escrever código. Não se enfraquece o contrato para uma mudança passar.

| Quando | Comando |
| --- | --- |
| Depois de cada edição | `pnpm check:fast` |
| Antes de devolver o trabalho | `pnpm check:task` |
| Antes de pedir revisão | `pnpm check:full` |

O `check:full` roda lint, formatação, tipos, arquitetura, testes unitários com cobertura, empacotamento, análise estática, auditoria de dependências e os testes e2e em três navegadores (cerca de 12 minutos).

## Publicação

Só a `main` publica, com a árvore limpa e a tag `v<versão>` no `HEAD`:

```bash
pnpm version:set <versão>   # grava os dez manifestos e as constantes de versão
pnpm publish:local          # confere as pré-condições e publica no Verdaccio local
```

## Licença

[MIT](./LICENSE)
