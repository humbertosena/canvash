# Canvash: guia para agentes de IA

Use este arquivo ao criar um projeto novo que tenha a biblioteca Canvash como base de desenho. Copie-o para o `CLAUDE.md` ou `AGENTS.md` do projeto novo, ou peça ao agente que o leia.

## O que é

Canvash é um canvas de desenho vetorial (formas, texto, tinta, camadas, histórico) separado em pacotes `@canvash/*`.

- O estado do desenho vive em uma `section` (`@canvash/core`), sem DOM.
- A tela é um web component (Lit). `@canvash/react` embrulha esses componentes.
- Você muda o desenho **só** por comandos (`section.dispatch`). Nunca mexa no DOM do canvas nem no documento diretamente.

## Pacotes

| Pacote | Quando usar |
|---|---|
| `@canvash/core` | Sempre. `createCanvasSection`, comandos, tipos, geometria. |
| `@canvash/react` | App React. Componentes e `useCanvasSnapshot`. |
| `@canvash/web-components` | Sem React (Vue, HTML puro). Também é dependência do `react`. |
| `@canvash/renderer-canvas2d`, `@canvash/interaction` | Dependências internas. Só os importe se montar a pilha à mão. |
| `@canvash/collaboration`, `@canvash/collaboration-yjs` | Só se o projeto pedir edição colaborativa. |

Em app React, instale `@canvash/core` e `@canvash/react`. O restante vem como dependência. Não instale pacote que o projeto não usa.

## Instalação

A biblioteca não está no npm. Os pacotes saem como arquivos `.tgz` anexados às Releases do GitHub `humbertosena/canvash`, e o app aponta o `pnpm add` para a URL deles. Não use `pnpm add github:humbertosena/canvash`: o pacote chega sem `dist` e quebra.

1. Descubra a versão da Release mais recente: `gh release list --repo humbertosena/canvash --limit 1` (ou a página de Releases). Se não houver Release, pare e avise o usuário.
2. No `pnpm-workspace.yaml` do projeto novo (pnpm 11), libere dependência por URL dentro de outra dependência. Sem isso a instalação falha com `ERR_PNPM_EXOTIC_SUBDEP`:
   ```yaml
   blockExoticSubdeps: false
   ```
3. Instale, trocando `V` pela versão da Release. Todo pacote `@canvash/*` que o seu código importa entra como dependência direta, e `@canvash/core` sempre:
   ```bash
   V=0.1.0-alpha
   B=https://github.com/humbertosena/canvash/releases/download/v$V
   pnpm add $B/canvash-core-$V.tgz $B/canvash-react-$V.tgz react react-dom
   ```
   O arquivo de cada pacote é `canvash-<nome>-<versão>.tgz`, por exemplo `canvash-web-components-$V.tgz`.

Se a instalação falhar por 404, a Release ou o arquivo não existe: confira a versão e o nome. Não troque por `file:` nem `link:` ao próprio repositório do Canvash sem pedir.

## Projeto base recomendado

React 19 + Vite + TypeScript, `"type": "module"`. Vite 8 funciona. `vite dev` e `vite build` funcionam.

## Exemplo mínimo (React)

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
      <CanvasSurface section={section} grid ariaLabel="Área de desenho" />
      <CanvasToolbar slot="toolbar" section={section} orientation="vertical" />
      <output slot="overlay">{Object.keys(snapshot?.document.nodes ?? {}).length} nós</output>
    </CanvasSection>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

Regras desse exemplo:

- **A section é criada uma vez** (`useState(() => ...)`). Nunca chame `createCanvasSection()` no corpo do componente: cada render criaria um desenho novo e perderia o anterior.
- **O contêiner precisa de altura.** O canvas ocupa 100% do pai. Pai sem altura = canvas invisível. Dê `height: 100vh` (ou equivalente) à raiz.
- **`section` vai em todos os componentes** (`CanvasSection`, `CanvasSurface`, `CanvasToolbar`, `CanvasLayers`, `CanvasProperties`, `CanvasSelectionMenu`) para que compartilhem o mesmo estado.
- **Slots**: `toolbar`, `overlay`, `left`, `properties` (dentro da toolbar), `end` (dentro da toolbar). Use o atributo `slot` no filho de `CanvasSection`.

## Componentes React

Todos de `@canvash/react`.

- `CanvasSection`: casca do editor (título, menu, exportar, compartilhar, avatar). Agrupa os demais por slots.
- `CanvasSurface`: a tela. Props: `section`, `readOnly`, `grid`, `gridSize`, `gridStyle`, `gridHighlight`, `ariaLabel`, `onCanvasReady`, `onDocumentChange`, `onSelectionChange`, `onViewportChange`, `onToolChange`. Aceita `ref` (`CanvasSurfaceHandle`, com `.element`).
- `CanvasToolbar`: ferramentas de desenho. `orientation`, `hideHistory`, `hideZoom`.
- `CanvasLayers`: painel de camadas.
- `CanvasProperties`: propriedades da seleção.
- `CanvasSelectionMenu`: mini-menu sobre a seleção (precisa de `canvas={elemento}`).
- `CanvasControls`: zoom e histórico (precisa de `canvas`).
- `useCanvasSnapshot(section)`: devolve o snapshot atual e re-renderiza a cada mudança.

`CanvasSurface` aceita `initialDocument` no modo interno (sem `section`). Não combine com `section`: lança erro.

## Ler e alterar o desenho

Leitura:

```ts
const snap = section.getSnapshot();
snap.document.nodes;        // nós por id
snap.session.selection;     // ids selecionados
snap.history;               // o que undo/redo podem fazer
```

Escrita, só por comandos. Toda chamada devolve `Result` (`{ ok: true, value } | { ok: false, error }`). **Cheque `ok`**: um comando recusado não muda nada e não lança.

```ts
const r = section.dispatch({
  type: 'shape.create',
  shape: { type: 'rectangle', x: 60, y: 60, width: 150, height: 100, rotation: 0 },
});
if (!r.ok) console.error(r.error);
```

Comandos: `shape.create`, `shape.update`, `shape.remove`, `group.create`, `group.ungroup`. Tipos de forma usados: `rectangle`, `square`, `circle`, `diamond`, `triangle` (com `variant`), `polygon` (com `sides`), `bezier` (com `start` e `end`).

Outras operações da `section`:

- `transact([cmd, ...])`: vários comandos como uma única alteração (um undo desfaz tudo; se um falhar, nenhum vale).
- `undo()`, `redo()`.
- `setSelection(ids)`, `setViewport(v)`, `setTool(tool)`, `setReadOnly(bool)`.
- `replaceDocument(json)`: carrega um documento salvo. Valida a entrada.
- `subscribe(listener)`: devolve a função que cancela. Dentro do listener só se **lê**; `dispatch` ali devolve `REENTRANT_DISPATCH`.
- `destroy()`: chame ao descartar a section.

Consulte os tipos exatos em `node_modules/@canvash/core/dist/index.d.mts` antes de montar um comando. Não invente campos: o core rejeita chaves desconhecidas.

## Salvar e carregar

O documento é JSON puro (`snap.document`). Para persistir:

```ts
localStorage.setItem('desenho', JSON.stringify(section.getSnapshot().document));
// ...
const saved = localStorage.getItem('desenho');
if (saved) {
  const r = section.replaceDocument(JSON.parse(saved));
  if (!r.ok) console.error(r.error); // documento inválido ou de outra versão
}
```

Para salvar a cada alteração, use `onDocumentChange` da `CanvasSurface` ou `section.subscribe`, com debounce.

## Eventos da tela

`CanvasSurface` expõe `onCanvasReady`, `onDocumentChange`, `onSelectionChange`, `onViewportChange`, `onToolChange`. Use `onCanvasReady` para saber que o canvas montou. Não presuma que o elemento existe no primeiro render: leia `ref.current?.element` depois da montagem.

## Sem React (web components)

```ts
import { createCanvasSection } from '@canvash/core';
import { defineCanvasElements } from '@canvash/web-components';

defineCanvasElements();
const section = createCanvasSection();
const surface = document.createElement('canvas-surface');
surface.section = section;
document.body.append(surface);
```

Elementos: `canvas-section`, `canvas-surface`, `canvas-toolbar`, `canvas-layers`, `canvas-properties`, `canvas-selection-menu`, `canvas-controls`. Atribua `section` como **propriedade**, nunca como atributo.

## SSR (Next, Remix)

O `@canvash/react` toca `window` e `customElements`. No servidor, importe de `@canvash/react/ssr`, que renderiza um placeholder sem tocar o DOM. No cliente, use o import normal. Em Next, carregue o componente com `dynamic(..., { ssr: false })` ou num Client Component.

## Tema

Estilize por variáveis CSS `--canvash-*` (por exemplo `--canvash-bg`) e por `::part()`. Não tente estilizar o interior com seletor comum: o Shadow DOM bloqueia. Veja `CANVASH_CSS_TOKENS` e `CANVASH_PARTS` exportados por `@canvash/web-components` para a lista completa.

## Idioma

Os textos vêm em pt-BR e en-US (`defaultI18nPtBR`, `defaultI18nEnUS`). Troque com `setGlobalI18n` / `mergeI18n` de `@canvash/web-components`.

## Armadilhas

1. **Canvas invisível**: pai sem altura. Corrija o CSS antes de qualquer outra coisa.
2. **Desenho some a cada render**: `createCanvasSection()` fora de `useState`/`useMemo`/`useRef`.
3. **Comando "não faz nada"**: você ignorou o `Result`. Leia `error`.
4. **Mutar o snapshot**: ele é imutável. Altere por comando.
5. **`dispatch` dentro de `subscribe`**: recusado. Agende fora do listener (`queueMicrotask`).
6. **Dois `react` no bundle**: erros de hooks. Garanta uma única cópia (`resolve.dedupe: ['react', 'react-dom']` no Vite).
7. **Dois `lit` no bundle**: elementos que não atualizam. Deixe o gerenciador de pacotes deduplicar `lit`.
8. **Registro errado**: sem o `.npmrc` do escopo, o `@canvash/*` não é achado.
9. **Mudar o `dist` do Canvash**: nunca. Se encontrar defeito na biblioteca, descreva-o ao usuário em vez de contornar com patch no `node_modules`.

## Verificação

Antes de dizer que terminou:

1. `pnpm build` (ou o build do projeto) passa sem erro de tipo.
2. `pnpm dev`, abra a página e confirme: o canvas aparece, a toolbar aparece, desenhar um retângulo aumenta a contagem de nós, e o console não tem erro.
3. Se o projeto tem testes, cubra a lógica de comandos com uma `section` real (`createCanvasSection()` roda em Node, sem navegador).

Relate o que verificou de fato. Se não abriu o navegador, diga isso.
