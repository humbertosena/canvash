# Canvash Web Components (`@canvash/web-components`)

Pacote de Web Components baseados em [Lit](https://lit.dev/) para integração rica e declarativa do Canvash em qualquer aplicação web moderna, sem necessidade de frameworks como React ou Vue.

---

## 1. Visão Geral e Filosofia

- **Padrões da Web Nativos:** Desenvolvido com Custom Elements (v1), Shadow DOM (v1) e CSS Custom Properties.
- **Zero Framework:** Funciona em HTML/ESM puro no navegador ou empacotado via Vite, Webpack, Rollup, etc.
- **Encapsulamento Estrito:** Estilos internos são 100% isolados pelo Shadow DOM, garantindo que nenhum estilo global vaze para a aplicação hospedeira.
- **Reatividade e Integridade:** Comunicação unidirecional baseada no core do Canvash (`@canvash/core`), com suporte a cancelamento de gestos, ciclos de vida e eventos tipados.

---

## 2. Instalação

```bash
# Com pnpm
pnpm add @canvash/core @canvash/renderer-canvas2d @canvash/interaction @canvash/web-components

# Com npm
npm install @canvash/core @canvash/renderer-canvas2d @canvash/interaction @canvash/web-components
```

### Consumo Vanilla em Navegadores (ESM Nativo)

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Canvash Editor</title>
    <style>
      body {
        margin: 0;
        display: flex;
        height: 100vh;
      }
      canvas-surface {
        flex: 1;
        height: 100%;
      }
      canvas-layers,
      canvas-properties {
        width: 260px;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <!-- Painel de Camadas -->
    <canvas-layers id="layers"></canvas-layers>

    <div style="flex: 1; display: flex; flex-direction: column;">
      <!-- Barra de Ferramentas -->
      <canvas-toolbar id="toolbar"></canvas-toolbar>

      <!-- Superfície do Canvas -->
      <canvas-surface id="canvas" grid grid-size="20" grid-style="dots" grid-highlight="on"></canvas-surface>
    </div>

    <!-- Painel de Propriedades -->
    <canvas-properties id="properties"></canvas-properties>

    <script type="module">
      import {
        defineCanvasElements,
        createCanvasSection,
      } from './node_modules/@canvash/web-components/dist/index.mjs';

      // 1. Registra os custom elements no DOM
      defineCanvasElements();

      const canvas = document.getElementById('canvas');
      const toolbar = document.getElementById('toolbar');
      const layers = document.getElementById('layers');
      const properties = document.getElementById('properties');

      // 2. Aguarda o canvas inicializar ou injeta uma instância compartilhada
      canvas.addEventListener('canvas-ready', (e) => {
        const section = e.detail.section;
        toolbar.section = section;
        layers.section = section;
        properties.section = section;
      });
    </script>
  </body>
</html>
```

---

## 3. Registro de Elementos (`defineCanvasElements`)

O registro é explícito, seguro e idempotente:

```typescript
import { defineCanvasElements } from '@canvash/web-components';

// Registro padrão (<canvas-surface>, <canvas-toolbar>, etc.)
defineCanvasElements();

// Registro com prefixo customizado (<my-app-canvas>, <my-app-toolbar>, etc.)
defineCanvasElements({ prefix: 'my-app' });
```

---

## 4. Catálogo de Elementos e APIs

### `<canvas-surface>`
Superfície interativa principal do editor. Monta automaticamente o renderizador Canvas 2D e o gerenciador de interações (ponteiro, zoom, gestos, teclado).

#### Propriedades / Atributos
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância do canvas. Se omitido, uma interna é criada automaticamente. |
| `readOnly` | `readonly` | `boolean` | `false` | Se verdadeiro, desabilita ferramentas de criação, edição e movimentação. |
| `grid` | `grid` | `boolean` | `false` | Exibe ou oculta a grade milimétrica de fundo. |
| `gridSize` | `grid-size` | `number` | `20` | Tamanho do passo da grade em pixels lógicos. |
| `gridStyle` | `grid-style` | `'dots' \| 'lines'` | `'dots'` | Aparência da grade: pontos de 2 px nas interseções (padrão, cor `#c9cbd1`) ou linhas contínuas (`#e2e8f0`). O espaçamento escala com o zoom; o tamanho do ponto, não. |
| `gridHighlight` | `grid-highlight` | `'on' \| 'off'` | `'on'` | Realce da grade sob o mouse: com `'on'` (padrão) e pontos, os pontos num raio de 120 px em volta do cursor escurecem até `#8b8f99`, com queda suave até a cor base; só mouse e caneta acionam, e some ao sair do canvas. `'off'` desliga. Não pinta em repouso e não vale para `grid-style="lines"`. |
| `ariaLabel` | `aria-label` | `string` | `'Canvash Canvas'` | Rótulo acessível da região interativa do canvas. |
| `messages` | — | `Partial<CanvasI18nMessages>` | `defaultI18nPtBR.canvas` | Mensagens customizadas para o live announcer acessível. |
| `interactionState` | — | `InteractionStateName` (somente leitura) | `'idle'` | Estado do gesto em andamento (`idle`, `moving`, `resizing`, `rotating`, `marquee`, `panning`, `editing-text`...). É `'idle'` antes de montar. |

#### Métodos Públicos
- `focus(options?: FocusOptions): void`: Foca o container interativo interno para navegação por teclado imediata.
- `fitToContent(options?: { padding?: number }): void`: Enquadra a visão aos limites de todos os nós com margem de segurança.
- `fitToSelection(options?: { padding?: number }): void`: Enquadra a visão aos limites dos nós selecionados; sem seleção, não faz nada.
- `zoomBy(factor: number): void` e `zoomTo(zoom: number): void`: Multiplicam o zoom por `factor` ou o levam a `zoom` (dentro dos limites de 0,05 a 16), mantendo no lugar o ponto central do contêiner. São visualização: não alteram o documento nem o histórico.
- `announce(text: string): void`: Emite anúncio imediato no live announcer acessível (`aria-live="polite"`). Suprimido automaticamente durante previews.
- `setEraserSize(size): void` e `getEraserSize()`: Tamanho da borracha (`thin`, `medium` ou `thick`: raio de 4, 8 ou 16 CSS px). O canvas também acompanha o evento `eraser-size-change` da `<canvas-toolbar>` do mesmo canvas.
- `setPenSettings({ color, kind, width }): void` e `getPenSettings()`: Cor (`#rrggbb`), tipo (`pen`, `marker`, `highlighter`) e espessura (`thin`, `medium`, `thick`) dos próximos traços da caneta. O canvas também acompanha o evento `pen-settings-change` da `<canvas-toolbar>` do mesmo canvas.
- `setStickyColor(color: string): void` e `getStickyColor(): string | undefined`: Cor (`#rrggbb`) das próximas notas adesivas. O canvas também acompanha o evento `sticky-color-change` da `<canvas-toolbar>` do mesmo canvas.
- `dispose(): void`: Destrói de forma limpa e idempotente a instância interna criada pelo elemento (não afeta instâncias externas).

#### Eventos DOM Emitidos (Composed & Bubbles)
| Evento | Tipo do Detalhe (`event.detail`) | Descrição |
| --- | --- | --- |
| `canvas-ready` | `CanvasReadyEventDetail` | Disparado quando a instância do canvas está montada e pronta para consumo. |
| `document-change` | `DocumentChangeEventDetail` | Disparado após qualquer alteração permanente commitada no documento (suprimido em preview). |
| `selection-change` | `SelectionChangeEventDetail` | Disparado quando a seleção de nós é alterada. |
| `viewport-change` | `ViewportChangeEventDetail` | Disparado quando pan ou zoom são alterados. |
| `tool-change` | `ToolChangeEventDetail` | Disparado quando a ferramenta ativa é trocada. |
| `interaction-state-change` | `InteractionStateChangeEventDetail` (`{ state }`) | Disparado a cada mudança do estado da interação, só nas transições: os movimentos dentro de um mesmo gesto não disparam. |
| `canvas-error` | `CanvasErrorEventDetail` | Disparado quando ocorre um erro de execução no pipeline. |

#### Slots
- `<slot></slot>` (padrão): Conteúdo inserido diretamente sobre o container interativo do canvas.
- `<slot name="overlay"></slot>`: Área de sobreposição para elementos adicionais (ex: cursores de presença colaborativa, réguas ou badges flutuantes).

---

### `<canvas-toolbar>`
Ilha de ferramentas, horizontal ou vertical, em três áreas separadas por divisor: **controle** (Seleção e Mão), **formas** (Figuras, Texto, Nota e Desenho) e **propriedades** da seleção, seguidas de histórico (undo/redo), zoom e do slot `end`. Figuras, Nota e Desenho são botões de grupo que abrem ghost islands.

#### Propriedades
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância compartilhada do canvas. |
| `orientation` | `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Orientação do layout da toolbar. |
| `hideHistory` | `hide-history` | `boolean` | `false` | Esconde desfazer e refazer (por exemplo, quando `<canvas-controls>` já os mostra). |
| `hideZoom` | `hide-zoom` | `boolean` | `false` | Esconde os controles de zoom. |
| `compactReadonly` | `compact-readonly` | `boolean` | `false` | Em modo leitura, mostra só as ferramentas Seleção e Mão; fora dele, não muda nada. |
| `messages` | — | `Partial<ToolbarI18nMessages>` | `defaultI18nPtBR.toolbar` | Textos e rótulos das ferramentas e botões. |
| `stickyColor` | — | `string` | `'#fff59d'` | Cor das próximas notas adesivas, em `#rrggbb` (a amarela de `STICKY_COLORS`). Mudá-la dispara `sticky-color-change`. Valores fora de `#rrggbb` são ignorados. Não persiste; o host pode atribuí-la. |
| `eraserSize` | — | `'thin' \| 'medium' \| 'thick'` | `'medium'` | Tamanho da borracha. Valor inválido é ignorado; mudar dispara `eraser-size-change`. Não persiste; o host pode atribuí-la. |
| `penSettings` | — | `{ color, kind, width }` | `{ color: '#1f2937', kind: 'pen', width: 'medium' }` | Configurações dos próximos traços da caneta. Atribuir aceita campos parciais e ignora os inválidos; mudar dispara `pen-settings-change`. Não persiste; o host pode atribuí-la. |
| `lastShape` | — | `ShapeGroupTool` | `'rectangle'` | Figura ativada por um clique no botão Figuras e marcada na ilha. Acompanha a ferramenta ativa do canvas sempre que ela é uma das 14 figuras (`arrow` incluída). Não persiste; o host pode atribuí-la. |
| `lastDrawTool` | — | `DrawGroupTool` | `'bezier'` | Opção do botão Desenho ativada por um clique nele e marcada na ilha: `line`, `bezier`, `pen` ou `eraser`. Acompanha a ferramenta ativa do canvas. Não persiste; o host pode atribuí-la. |
| `propertiesOpen` | `properties-open` | `boolean` | `false` | Painel de propriedades da toolbar aberto. Fecha sozinho quando a seleção fica vazia ou o canvas entra em leitura; trocar a seleção o mantém. Emite `properties-panel-toggle` a cada mudança. |

#### Slots
- `<slot name="start"></slot>`: Ações inseridas no início da barra (antes das ferramentas de criação).
- `<slot></slot>` (padrão): Itens inseridos entre os botões de zoom e o final da barra.
- `<slot name="properties"></slot>`: Conteúdo do painel de propriedades, normalmente `<canvas-properties slot="properties">`. O painel só existe com `propertiesOpen`.
- `<slot name="end"></slot>`: Ações inseridas no final absoluto da barra, depois de um divisor (`part="end-separator"`, `role="separator"`, na orientação da barra). O divisor só existe quando o slot tem elementos: ele aparece e some com o `slotchange`, e sem conteúdo a barra é a de sempre. Com `compact-readonly` em modo leitura, o slot e o divisor continuam visíveis (ex.: o botão do playground).

#### Áreas
A toolbar é um `role="toolbar"` com `aria-label` vindo do i18n (`toolbarLabel`). Cada área é um `role="group"` nomeado (`islandAreas`: "Controle", "Formas", "Propriedades"), com `part="tools-group control-area"`, `part="tools-group shapes-area"` e `part="tools-group properties-area"`, e um divisor (`role="separator"`) entre elas. Em leitura com `compact-readonly` sobra a área de controle e o slot `end`. Os botões soltos são Seleção, Mão e Texto, com `data-tool` e `part="tool-button tool-<id>"`; atalhos: Seleção V, Mão segurando Espaço, Texto T. Cada botão desenha um ícone SVG decorativo (`aria-hidden`, `part="icon"`) com `currentColor`, e o nome acessível vem do `aria-label` localizado. O botão do meio do mouse e o Espaço continuam fazendo pan em qualquer ferramenta, e com a Mão o cursor volta a `grab` ao soltar. Depois do grupo Desenho, a área de formas tem o botão **Board** (`data-tool="board"`, `aria-pressed` pela ferramenta ativa, sem atalho): o arrasto no canvas cria um board no retângulo do gesto, o clique cria um de 640 × 400 com o canto no ponto, e os nós de nível superior da camada com o centro dentro dele entram como filhos, numa só entrada de histórico. O título nasce como "Board N", com N o menor número livre; o texto vem de `messages.boardDefaultTitle(n)` do `<canvas-surface>`, e o nome do botão, de `messages.board` da toolbar.

#### Ghost islands: Figuras, Nota e Desenho
Cada grupo é um botão com um pequeno triângulo no canto (indicador de grupo, sem ação própria) e uma ghost island ao lado. O comportamento é o mesmo nos três e vive no `ToolMenu`:

- **Hover** (mouse e caneta): `pointerenter` no botão ou na ilha abre depois de 80 ms; sair do botão e da ilha fecha depois de 250 ms, o que cobre o vão de 12 px. O hover não tira o foco de onde estava. O toque não depende dele.
- **Clique, Enter ou Espaço no botão**: ativa a última opção usada e **fixa** a ilha aberta; outro clique a fecha. A ilha fixada fecha também ao escolher uma opção, com Esc (o foco volta ao botão), com Tab, com clique fora e com o foco saindo do grupo.
- **Teclado**: seta para a esquerda (vertical) ou para baixo (horizontal) no botão abre a ilha com o foco na opção marcada; as setas andam pela grade, Home e End vão às pontas.
- **Uma ilha por vez**: abrir uma, por hover, clique ou teclado, fecha a outra, inclusive a de Propriedades.
- **Lembrança**: vale enquanto a página está aberta (`lastShape`, `lastDrawTool`, `stickyColor`); nada vai para o documento nem para `localStorage`. Ativar uma opção por outro caminho (`section.setTool(...)`) atualiza a lembrança.
- **Fundo**: a ilha aberta e o botão de origem (`aria-expanded="true"`) usam `--canvash-surface-float-hover`; o item sob o ponteiro, `--canvash-surface-float-item-hover`. O item ativo mantém o destaque escuro.
- **Posição**: abre ao lado da toolbar (à esquerda na vertical, que fica na borda direita da tela, e abaixo na horizontal) e inverte de lado, numa única medição, quando estouraria o viewport e o outro lado cabe. É desenhada no Shadow DOM, sem `position: fixed`.

| Grupo | Botão | Ilha | Opções |
| --- | --- | --- | --- |
| Figuras | `data-action="open-shapes"`, `data-tool="<lastShape>"`, `aria-label` "Figuras: <figura>" | `part="shapes-menu"`, grade de 4 colunas | as 14 figuras de `SHAPE_GROUP_TOOLS`, com a seta antes das chaves (`part="shapes-item shapes-item-<figura>"`) |
| Nota | `data-action="open-sticky-colors"`, `data-tool="sticky"` | `part="sticky-menu"`, 3 colunas | seis cores (`data-color`: `yellow`, `pink`, `green`, `blue`, `orange`, `purple`) e "Personalizada" (`data-action="custom-sticky-color"`, abre o seletor nativo) |
| Desenho | `data-action="open-draw"`, `data-tool="<lastDrawTool>"`, `aria-label` "Desenho: <opção>" | `part="draw-menu"`, 4 colunas | `line`, `bezier`, `pen` (rotulada "Tinta"; o nó é `ink`) e `eraser` (`part="draw-item draw-item-<opção>"`) |

Quadrado, círculo e polígono nascem com caixa 1:1; o triângulo nasce isósceles; a Bézier nasce como arco simétrico entre o início e o fim do arrasto; a seta escolhida em Figuras cria setas com âncoras, como sempre.

**Nota.** Escolher uma cor define `stickyColor`, ativa a ferramenta, fecha a ilha e dispara `sticky-color-change` (`detail: { color, section }`, `bubbles` e `composed`). O clique no canvas cria uma nota de 200 × 200 e abre a edição no lugar; um arrasto cria uma nota do tamanho do retângulo. Não há atalho de teclado. A cor vale só para as próximas notas.

**Desenho: configurações.** Abaixo de um divisor, a ilha mostra as configurações da opção **marcada**: para a Tinta, tipo, espessura e cores; para a borracha, os tamanhos; para linha e Bézier, nada. Tipo e espessura mudam `penSettings`, ativam a Tinta e deixam a ilha aberta; a cor e o tamanho da borracha fecham a ilha.

| Bloco | Itens | Seletor |
| --- | --- | --- |
| Tipo | caneta, marcador, marca-texto (`part="pen-item pen-kind pen-kind-<tipo>"`) | `[data-pen-kind]` |
| Espessura | fina, média, grossa (`part="pen-item pen-width pen-width-<tamanho>"`) | `[data-pen-width]` |
| Cor | as 8 cores de `PEN_PALETTE` (`part="pen-item pen-swatch"`) e "Personalizada" (`part="pen-item pen-custom"`, `data-action="custom-pen-color"`) | `[data-pen-color]` |
| Tamanho da borracha | fina, média, grossa (`part="eraser-item eraser-item-<tamanho>"`) | `[data-eraser-size]` |

As setas para cima e para baixo passam de um bloco ao vizinho, na mesma coluna ou na última dele. Cada mudança dispara `pen-settings-change` (`detail: { settings: { color, kind, width }, section }`) ou `eraser-size-change` (`detail: { size, section }`), ambos com `bubbles` e `composed`, que o `<canvas-surface>` do mesmo canvas aplica ao motor de interação. Os traços já desenhados mantêm as próprias configurações. Espessuras: caneta 2/4/8, marcador 4/8/16, marca-texto 6/12/24 unidades do documento; o marca-texto pinta com 0,4 de opacidade.

**Caneta e borracha.** Arrastar com a Tinta desenha um traço; um clique deixa um pingo. Traços seguidos formam um único elemento (`ink`, uma entrada de histórico por traço); trocar de ferramenta e voltar começa outro elemento. A borracha apaga só a parte do traço por onde o ponteiro passa; um elemento que fica sem traços é removido. Uma passada é uma entrada de histórico, e só traços visíveis e desbloqueados são afetados. Esc, `pointercancel`, perda de captura e perda de foco descartam a passada. Enquanto a borracha está ativa, o cursor do sistema fica oculto e um círculo no overlay acompanha o ponteiro, com o raio em CSS px (4, 8 ou 16) qualquer que seja o zoom; a cor vem de `--canvash-eraser-cursor` (padrão `#334155`) e o círculo nunca entra na exportação.

Com o canvas somente leitura as ilhas abrem, mas os itens ficam com `aria-disabled` e não ativam nada. Cada `<canvas-toolbar>` tem as próprias lembranças e ilhas. Tokens: `--canvash-menu-bg` (cai em `--canvash-surface-float-hover`), `--canvash-menu-border`, `--canvash-menu-shadow` e `--canvash-menu-item-active-bg`.

#### Propriedades
O botão da área Propriedades (`data-action="properties"`, `part="properties-button tool-button"`, ícone de controles deslizantes) tem `aria-haspopup="dialog"`, `aria-expanded` e `aria-controls`. Fica `disabled` sem seleção, sem `section` ou em modo leitura, com `title` "Selecione uma ou mais formas". O clique alterna uma ilha `role="dialog"` (`part="properties-panel"`) ao lado da toolbar, alinhada ao topo do botão, com no máximo 280 px, rolagem interna e posição limitada à tela (inverte de lado e sobe o quanto precisar). O conteúdo é o slot `properties`.

O painel fecha com o botão, com Esc (o foco volta ao botão), quando a seleção fica vazia e quando o canvas entra em leitura. **Clicar no canvas não o fecha**: trocar a seleção atualiza o painel, como num inspetor. Abrir Propriedades fecha a ilha de grupo aberta, e o contrário também vale. Cada mudança de `propertiesOpen` dispara `properties-panel-toggle` (`detail: { open }`, `bubbles` e `composed`), uma vez.

#### Eventos DOM
| Evento | Detalhe | Descrição |
| --- | --- | --- |
| `sticky-color-change` | `{ color, section }` | A cor das próximas notas mudou. |
| `pen-settings-change` | `{ settings, section }` | Tipo, espessura ou cor da Tinta mudaram. |
| `eraser-size-change` | `{ size, section }` | O tamanho da borracha mudou. |
| `properties-panel-toggle` | `{ open: boolean }` | O painel de propriedades abriu ou fechou. |

#### Partes (`::part()`)
`toolbar`, `tools-group`, `control-area`, `shapes-area`, `properties-area`, `history-group`, `zoom-controls`, `tool-button`, `action-button`, `zoom-indicator`, `shapes-group`, `shapes-button`, `shapes-menu`, `shapes-item`, `sticky-group`, `sticky-button`, `sticky-menu`, `sticky-swatch`, `sticky-custom`, `draw-group`, `draw-button`, `draw-menu`, `draw-item`, `pen-item`, `pen-kind`, `pen-width`, `pen-swatch`, `pen-custom`, `eraser-item`, `properties-button`, `properties-panel` e `end-separator`. Saíram `shapes-toggle`, `sticky-color`, `pen-group`, `pen-button`, `pen-color`, `pen-menu`, `eraser-group`, `eraser-button`, `eraser-size` e `eraser-menu`, com os botões e chips separados que elas nomeavam.

#### Mudanças que quebram a API (pacote em `0.0.0`, sem período de transição)
- Os botões soltos de Linha, Bézier, Seta, Caneta e Borracha viraram opções das ilhas Figuras e Desenho; os chips e os botões secundários (`open-pen-settings`, `open-eraser-size`) saíram, e `data-action="open-shapes"` e `open-sticky-colors` passaram para o botão do grupo.
- As chaves i18n `shapes`, `shapesOpen` e `shapesCurrent` viraram `figures` e `figuresCurrent`; entraram `draw`, `drawPen`, `drawCurrent`, `toolbarLabel`, `islandAreas`, `properties` e `propertiesUnavailable`.
- O painel de propriedades e o evento `properties-panel-toggle` saíram do `<canvas-selection-menu>` e vieram para a toolbar (ver abaixo).
- Na toolbar vertical, as ilhas de grupo e o painel de Propriedades abrem **à esquerda** por padrão (antes, à direita), e a seta que abre a ilha pelo teclado é a **esquerda**. A inversão para a direita só acontece quando falta espaço à esquerda.

---

### `<canvas-section>`
Layout de "canvas infinito + ilhas flutuantes": o canvas ocupa o shell inteiro e as ilhas (menu, título, ações, camadas, toolbar e controles) flutuam sobre ele, ancoradas nas bordas, sem nunca empurrar o conteúdo. É só layout: não cria nem distribui o `section`, que cada filho recebe do host. O shell preenche o elemento pai (`width` e `height` de 100%); dê a ele ou ao pai um tamanho, por exemplo `position: fixed; inset: 0`.

#### Propriedades / Atributos
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Opcional, só para saber do modo leitura: em leitura o título não se edita. |
| `projectTitle` | `project-title` | `string` | `''` | Título do projeto, ao lado do menu (mostra "Sem título" quando vazio). O shell só o exibe; quem aceita a mudança é o host, que então atribui a propriedade. |
| `menuOpen` | `menu-open` | `boolean` | `false` | Menu hambúrguer aberto. |
| `menuItems` | — | `readonly ShellMenuItem[]` | `[]` | Itens do menu hambúrguer, `{ id, label, icon?, disabled? }`. Só por propriedade. O rótulo é sempre texto; `icon` é a URL de uma imagem (pode ser `data:`), mostrada com 20 px. |
| `user` | — | `ShellUser \| undefined` | `undefined` | Pessoa logada, `{ name, avatarUrl? }`, mostrada como avatar depois da pill Exportar. Só por propriedade; sem ela, não há avatar. |
| `hideExport` | `hide-export` | `boolean` | `false` | Esconde a pill Exportar. |
| `hideShare` | `hide-share` | `boolean` | `false` | Esconde a pill Compartilhar. |
| `sharing` | `sharing` | `'off' \| 'connecting' \| 'on'` | `'off'` | Estado do compartilhamento ao vivo. Só o host muda: o shell mostra o ponto de status na pill e o nome acessível ("Compartilhar, conectando" / "Compartilhar, ativo"), mas nunca liga a colaboração sozinho. |
| `participants` | — | `readonly ShellParticipant[]` | `[]` | Participantes da sessão, a pessoa local (`self`) incluída. Só por propriedade. A pilha de avatares aparece com `sharing = 'on'` e pelo menos uma outra pessoa. |
| `hideParticipants` | `hide-participants` | `boolean` | `false` | Esconde a pilha de avatares mesmo com participantes. |
| `following` | — | `string \| null` | `null` | `id` da pessoa que a sessão local segue. Só o host muda. |
| `messages` | — | `Partial<ShellI18nMessages>` | `defaultI18nPtBR.shell` | Textos acessíveis (`menu`, `editTitle`, `untitled`, `titleInput`, `share`, `export`, `exportMenu`, `exportSvg`, `exportPng` e `account(name)`; na colaboração, `shareConnecting`, `shareActive`, `shareFailed`, `shareStop`, `shareStopPending`, `participants(others)`, `inSession(total)`, `you`, `follow`, `following`, `participantsDialog`, `followingBanner(name)`, `stopFollowing`, `followLeft(name)` e `followUnsupported`). |

#### Slots (regiões)
| Slot | Posição | Uso típico |
| --- | --- | --- |
| (padrão) | tela toda, por baixo de tudo | `<canvas-surface>` |
| `menu` | cartão do menu hambúrguer, topo à esquerda, depois dos `menuItems` | conteúdo livre do host |
| `actions` | topo à direita, antes de Compartilhar | botões do host |
| `left` | cartão flutuante à esquerda, abaixo do topo | `<canvas-layers>` |
| `toolbar` | direita, a 16 px da borda e centralizada na vertical | `<canvas-toolbar orientation="vertical" hide-history hide-zoom compact-readonly>` |
| `controls` | base à direita | `<canvas-controls>` |
| `overlay` | camada sobre o canvas, sem capturar o ponteiro | `<canvas-selection-menu>` |

As regiões deixam o ponteiro passar: só os elementos slotados o capturam, então pan, seleção e desenho funcionam entre as ilhas. As margens vêm de `--canvash-island-margin` (16 px) e a largura do cartão da esquerda, de `--canvash-shell-left-width` (260 px).

#### Menu, título e ilhas do topo
**Menu.** O botão hambúrguer (`aria-expanded`, `aria-controls="menu"`) abre um cartão não modal; Esc e clique fora fecham (Esc devolve o foco ao botão) e os dois ouvintes só existem com o menu aberto. Com `menuItems`, o cartão lista os itens na ordem dada (`part="menu-items"`, `part="menu-item"`) antes do conteúdo do slot `menu`. Clicar, Enter ou Espaço num item emite `menu-select` uma vez, fecha o menu e devolve o foco ao botão; um item `disabled` não emite nem fecha.

**Título.** Em repouso é texto solto em negrito (peso 700), sem fundo nem borda, nem com o ponteiro em cima; o anel de foco do teclado continua. Clique ou F2 abrem um campo de até 120 caracteres: Enter ou sair do campo confirmam, Esc cancela, e título vazio ou igual ao atual não é mudança. Em edição o campo é **só itálico** (sem negrito), com **fundo transparente** (token `--canvash-title-edit-bg`, padrão `transparent`), sem contorno de foco e com bordas de cima e dos lados transparentes de 1 px. A borda de baixo, de 2 px, é uma **linha em degradê da esquerda para a direita**: começa no tom de seleção dos itens das ilhas temporárias (`--canvash-surface-float-item-hover`) e termina na cor do canvas (`--canvash-canvas-bg`); o token `--canvash-title-edit-line` troca a linha. O campo tem a mesma altura de antes, 27 px.

**Ilhas do topo, à direita.** Na ordem `actions`, Compartilhar, Exportar e Avatar, com 8 px de intervalo, a 16 px da borda e com 32 px de altura. O shell só desenha e avisa; exportar, copiar o link e abrir a conta são do host, e `@canvash/web-components` não depende de `@canvash/export`.

- **Compartilhar** (`part="share-button"`): cada clique emite `share-request` com o `sharing` do momento, e o host decide o que fazer (ligar a colaboração, copiar o link de novo). Com `sharing` diferente de `off`, o ponto de status (`part="share-status"`) aparece ao lado do rótulo. `hide-share` a remove.
- **Exportar** (`part="export-button"`, `aria-haspopup="menu"`): abre uma ilha temporária (`part="export-menu"`, `role="menu"`) 8 px abaixo da pill, alinhada à direita, com "Exportar SVG" e "Exportar PNG" (`part="export-item"`, `role="menuitem"`). Abre por clique, Enter, Espaço ou seta para baixo, com o foco no primeiro item; as setas, Home e End navegam; Esc devolve o foco à pill; Tab e clique fora fecham. Escolher um item emite `export-request` uma vez e fecha. Abrir esta ilha fecha o menu hambúrguer, e vice-versa. `hide-export` a remove.
- **Avatar** (`part="avatar"`): botão circular de 32 px, sem borda nem sombra, com nome acessível "Conta: {name}". Com `user.avatarUrl` mostra a foto (`part="avatar-image"`); sem ela, ou se a imagem falhar, mostra até duas iniciais (`part="avatar-initials"`) em branco sobre `#1f1f1f`. O clique emite `avatar-click`.

**Compartilhamento ao vivo, participantes e seguir.** O shell só desenha e avisa; ligar a colaboração, montar a lista de participantes e mover o viewport são do host (no pacote `@canvash/collaboration`, `bindCanvasPresence` e `toShellParticipants` fazem isso).

- **Status.** O ponto (8 px) usa `--canvash-share-active-color` (padrão `#15803d`, contraste de 3:1 contra a pill); em `connecting` ele pulsa, e com `prefers-reduced-motion` fica parado e semitransparente. O estado é só do host: depois de um `share-request`, ele muda a propriedade quando a conexão fecha ou falha. Com a colaboração ativa, cada clique em Compartilhar volta a emitir `share-request` (o host copia o link outra vez, sem abrir outra sessão).
- **Pilha de avatares** (`part="participants"`, `aria-haspopup="dialog"`). Aparece ao lado da pill com `sharing="on"` e ao menos uma outra pessoa, sem a pessoa local. Mostra até 3 avatares (`--canvash-avatar-stack-size`, padrão `24px`), sobrepostos, cada um com anel na cor da pessoa (`--canvash-avatar-ring-width`, padrão `2px`; `part="participant-avatar"`; foto em `part="participant-image"`, ou até duas iniciais quando não há foto ou ela falha), e o excedente como "+N" (`part="participants-more"`). A pessoa seguida vai para o primeiro lugar. O nome acessível diz quantas outras pessoas há (`messages.participants`).
- **Ilha de participantes** (`part="participants-island"`, `role="dialog"`). Abre 80 ms depois de o ponteiro entrar na pilha e fecha 250 ms depois de sair; clique, Enter ou Espaço a fixam aberta, e Esc ou clique fora a fecham (Esc devolve o foco à pilha). Lista as pessoas da sessão (`part="participants-list"`, `part="participant-row"`, `part="participant-name"`), a local primeiro e marcada com "(você)", e é uma lista viva: quem entra ou sai aparece sem fechar a ilha. Cada outra pessoa tem um botão Seguir (`part="follow-button"`). Para quem está sendo seguido ele vira Seguindo (`aria-pressed="true"`), e para quem não publica a vista (`canFollow: false`) fica desabilitado, com o título de `messages.followUnsupported`. Com a colaboração ativa, o último item é "Parar de compartilhar" (`part="share-stop-item"`).
- **Seguir.** O botão emite `follow-change` com `{ sessionId }` (ou `null` para parar), e o host chama `binding.follow(sessionId)`. Com `following` preenchido e a pessoa na lista, o shell mostra a moldura na cor dela (`part="follow-frame"`, largura em `--canvash-follow-frame-width`, padrão `2px`) e a faixa "Seguindo {nome}" (`part="following-banner"`, com `role="status"`) com o botão Parar (`part="following-stop"`). O host é quem encerra o seguir quando a pessoa navega por conta própria, o seguido sai ou o compartilhamento termina; ele então volta `following` a `null` e pode avisar (`messages.followLeft`).

```js
import { bindCanvasPresence, toShellParticipants } from '@canvash/collaboration';

const shell = document.querySelector('canvas-section');
const binding = bindCanvasPresence({ session, section, pointerTarget: canvasElement });

shell.sharing = 'on';
const refresh = () => {
  shell.participants = toShellParticipants(section.getPeers(), { name: 'Ana', color: '#2563eb' });
};
section.subscribe((change) => change.areas.includes('peers') && refresh());

shell.addEventListener('follow-change', (event) => {
  const result = binding.follow(event.detail.sessionId); // NOT_FOUND ou UNSUPPORTED se não der
  if (result.ok) shell.following = event.detail.sessionId;
});
binding.onFollowChange((sessionId) => { shell.following = sessionId; }); // gesto, saída ou fim
shell.addEventListener('share-stop', () => stopSharing());
```

`ShellParticipant` é `{ id, name, color, avatarUrl?, self?, canFollow? }`. O nome e a foto vêm de outra pessoa: o nome é sempre texto, nunca HTML, e a foto só entra como `src` de imagem. O texto das iniciais escolhe entre branco, `#1f1f1f` e `#000000` pelo melhor contraste sobre a cor do anel.

Em modo leitura, o menu, Compartilhar, Exportar e o avatar continuam ativos: não editam o documento. Abaixo de 600 px de largura as duas pills mostram só o ícone, e o rótulo vira o nome acessível.

**Hover e ilhas temporárias.** Com o ponteiro em cima, o botão hambúrguer e as pills Compartilhar e Exportar trocam o fundo de repouso (`--canvash-surface-float`) por um mais forte e **opaco**, o do token `--canvash-surface-float-hover` (padrão `#d9dbe0`). As ilhas temporárias que elas abrem, o cartão do menu e a ilha de exportação, têm esse mesmo fundo, e o botão que as abriu o mantém enquanto elas estão abertas (`aria-expanded="true"`), mesmo sem o ponteiro; ao fechar, volta ao de repouso. Os itens de dentro delas (`menu-item`, `export-item`) ficam com o tom de seleção `--canvash-surface-float-item-hover` (padrão `#ccced3`) sob o ponteiro, o mesmo cinza que abre a linha do título em edição.

**Ícones.** Exportar usa um SVG de 20 px (`viewBox="0 0 18 18"`) e Compartilhar um de 16 px (`viewBox="0 0 256 256"`), os dois com `fill="currentColor"`: seguem a cor do texto, então o token `--canvash-text-float` também os recolore.

#### Eventos DOM
| Evento | Detalhe | Descrição |
| --- | --- | --- |
| `menu-toggle` | `{ open: boolean }` | O menu abriu ou fechou. |
| `menu-select` | `{ id: string }` | Foi escolhido um item de `menuItems`. |
| `title-change` | `{ title: string }` | O usuário confirmou outro título (aparado). |
| `export-request` | `{ format: 'svg' \| 'png' }` | Foi escolhido um formato na ilha de exportação. |
| `share-request` | `{ sharing: 'off' \| 'connecting' \| 'on' }` | A pill Compartilhar foi clicada, com o estado do momento. |
| `share-stop` | `{}` | Foi escolhido "Parar de compartilhar" na ilha de participantes. |
| `follow-change` | `{ sessionId: string \| null }` | A pessoa pediu para seguir `sessionId`, ou para parar (`null`). O host decide. |
| `avatar-click` | `{}` | O avatar foi clicado. |

Todos têm `bubbles` e `composed`.

#### Partes (`::part()`)
`shell`, `canvas-layer`, `top`, `top-start`, `menu-button`, `menu`, `menu-items`, `menu-item`, `title`, `title-input`, `top-end`, `share-button`, `share-status`, `participants`, `participants-more`, `participant-avatar`, `participant-image`, `participants-island`, `participants-title`, `participants-list`, `participant-row`, `participant-name`, `follow-button`, `share-stop-item`, `follow-frame`, `following-banner`, `following-stop`, `export`, `export-button`, `export-menu`, `export-item`, `avatar`, `avatar-image`, `avatar-initials`, `left`, `right`, `toolbar`, `bottom-end` e `overlay`. A região da toolbar tem `part="right toolbar"`: `right` é o nome de sempre, e `toolbar` é o nome novo, equivalente.

**Toolbar à direita.** O shell mede a região da toolbar com um `ResizeObserver` e publica a largura em `--canvash-shell-toolbar-inline-size` (no próprio shell). O mini-menu da seleção reserva a mesma faixa, à direita, e não se posiciona sob a toolbar. As ghost islands e o painel de Propriedades abrem à esquerda dela, e o cartão do playground do host também (ver os exemplos). O cartão do slot `left` segue na margem esquerda.

```html
<main style="position: fixed; inset: 0">
  <canvas-section id="shell" project-title="Meu projeto">
    <canvas-surface id="canvas"></canvas-surface>
    <canvas-layers slot="left"></canvas-layers>
    <canvas-toolbar slot="toolbar" orientation="vertical" hide-history hide-zoom compact-readonly>
      <!-- Depois do divisor da toolbar: o botão que abre o cartão do playground do host. -->
      <button slot="end" aria-label="Playground" popovertarget="playground">⚙</button>
      <div slot="end" id="playground" popover>…controles do playground…</div>
    </canvas-toolbar>
    <canvas-controls slot="controls"></canvas-controls>
  </canvas-section>
</main>
<script type="module">
  const shell = document.getElementById('shell');
  shell.menuItems = [
    { id: 'new', label: 'Novo projeto' },
    { id: 'open', label: 'Abrir projeto…' },
  ];
  shell.user = { name: 'Ana Silva', avatarUrl: '/ana.png' };
  shell.addEventListener('menu-select', (event) => console.log('item', event.detail.id));
  shell.addEventListener('export-request', (event) => console.log('exportar', event.detail.format));
  shell.addEventListener('share-request', () => navigator.clipboard.writeText(location.href));
  shell.addEventListener('avatar-click', () => console.log('conta'));
</script>
```

---

### `<canvas-controls>`
Controles da base do canvas: desfazer e refazer, o botão de zoom (mostra o percentual e abre um menu) e o botão "?" com o diálogo de atalhos.

#### Propriedades
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância compartilhada do canvas. |
| `canvas` | — | `ZoomTarget \| undefined` | `undefined` | O `<canvas-surface>` do mesmo canvas. Ancora o zoom no centro dele e habilita "Ajustar ao conteúdo" e "Ajustar à seleção". Sem `canvas`, o zoom ancora na origem da tela e os dois ajustes ficam desabilitados. |
| `messages` | — | `Partial<CanvasControlsI18nMessages>` | `defaultI18nPtBR.controls` | Textos e rótulos acessíveis. |

#### Menu de zoom
Aproximar (⌘/Ctrl + `=`), Afastar (⌘/Ctrl + `-`), Zoom em 100% (⇧0), Ajustar ao conteúdo (⇧1) e Ajustar à seleção (⇧2), cada um com o atalho exibido. As mesmas teclas funcionam direto no canvas focado (ver `KeyboardAction` `zoom-in`, `zoom-out`, `zoom-reset`, `zoom-fit` e `zoom-selection` em `@canvash/interaction`, configuráveis como as demais ações); fora do canvas, o navegador mantém o comportamento dele.

Teclado: o botão abre o menu com seta para cima ou para baixo; as setas, Home e End andam pelos itens; Enter ou Espaço ativam; Esc fecha e devolve o foco ao botão; clicar fora também fecha. Aproximar e Afastar usam o fator 1,2.

#### Diálogo de ajuda
O botão "?" abre um `<dialog>` modal com os atalhos reais do editor (edição, organização e visão). Esc e "Fechar" fecham e devolvem o foco ao botão.

#### Slots
- `<slot name="help"></slot>`: Substitui a lista padrão de atalhos do diálogo.

#### Partes (`::part()`)
`controls`, `history-group`, `action-button`, `zoom-group`, `zoom-button`, `zoom-menu`, `zoom-item`, `zoom-shortcut`, `help-button`, `help-dialog`, `help-body`, `help-title`, `help-section`, `help-row`, `help-keys` e `help-close`. Os tokens `--canvash-toolbar-*` e `--canvash-menu-*` valem aqui também.

```html
<canvas-surface id="canvas" grid></canvas-surface>
<canvas-controls id="controls"></canvas-controls>
<script type="module">
  const canvas = document.getElementById('canvas');
  const controls = document.getElementById('controls');
  canvas.addEventListener('canvas-ready', (event) => {
    controls.section = event.detail.section;
    controls.canvas = canvas;
  });
</script>
```

---

### `<canvas-selection-menu>`
Mini-menu flutuante da seleção, com cinco ações (mais **Exportar board**, opcional, descrita adiante): **Trazer para frente**, **Enviar para trás**, **Agrupar**, **Desagrupar** e **Excluir**, nessa ordem. As propriedades da seleção abrem na ilha da `<canvas-toolbar>`; o mini-menu não tem botão nem painel de propriedades. Fica sobre o canvas, centralizado acima da caixa da seleção (abaixo dela quando acima não cabe, e sempre a 16 px das bordas do canvas), e vai no slot `overlay` do `<canvas-section>`. As ações usam os mesmos comandos dos atalhos de teclado (`executeReorder`, `executeGroup`, `executeUngroup` e `executeDelete`), com uma entrada de histórico por clique; depois de excluir, o foco vai para o canvas.

**Agrupar e Desagrupar** aparecem conforme a seleção (`getGroupActions`, de `@canvash/interaction`), contando só os nós que existem e que outra sessão não bloqueia:

| Seleção | Agrupar | Desagrupar |
| --- | --- | --- |
| um nó solto, ou nada livre | escondido | escondido |
| dois ou mais nós soltos, da mesma camada, sem `locked` | habilitado | escondido |
| um ou mais grupos (e nada mais) | escondido com um grupo; desabilitado com dois | habilitado |
| um grupo e um nó solto | desabilitado | habilitado |
| grupo e membro, ou camadas diferentes, ou nó ou camada com `locked` | desabilitado | escondido (sem grupo) |
| todos os grupos com `locked` ou em camada com `locked` | — | desabilitado |
| modo leitura | escondido | escondido |

Botão **desabilitado** leva `aria-disabled="true"` (não `disabled`): continua na navegação por teclado, o clique e o Enter não fazem nada, e o estilo usa `opacity: 0.4`. Agrupar seleciona o grupo criado; Desagrupar seleciona os filhos liberados (e tira da seleção os nós soltos), todos os grupos de uma vez numa única entrada de histórico. Os dois botões têm `title` e `aria-keyshortcuts` por plataforma: `Agrupar (⌘G)` e `Desagrupar (⌘⇧G)` no macOS; `Agrupar (Ctrl+G)` e `Desagrupar (Ctrl+Shift+G)` nas outras. Depois da ação o foco vai ao botão oposto (de Agrupar para Desagrupar e vice-versa), sem roubar o foco de outro elemento.

Aparece só com seleção não vazia, a ferramenta de seleção, nenhum gesto em andamento (`interactionState === 'idle'`) e fora do modo leitura, e quando a seleção está ao menos em parte dentro do canvas. Some durante mover, redimensionar, girar, marquee, pan e edição de texto, e volta ao fim do gesto. A posição é recalculada em mudança de seleção, viewport, documento e tamanho do canvas, agrupada num `requestAnimationFrame` e sem loop em repouso.

**Exportar board** é opcional: com o atributo `export-board`, o botão aparece entre Desagrupar e Excluir quando a seleção é **um só nó e ele é um board**; com um retângulo, vários nós ou nenhum, não existe. Clicar nele (ou Enter, Espaço ou seta para baixo) abre um submenu com **SVG** e **PNG**, e escolher um formato fecha o submenu, devolve o foco ao botão e dispara o evento `export-board-request` uma única vez. O componente não baixa nada: o host chama a exportação do pacote `@canvash/export` com o escopo `{ board: boardId }` (a área recortada no retângulo do board, sem o título) e entrega o arquivo.

| Evento | `detail` | Quando |
| --- | --- | --- |
| `export-board-request` | `{ boardId: string, format: 'svg' \| 'png' }` | O formato foi escolhido no submenu. Borbulha e atravessa o shadow DOM (`bubbles` e `composed`). |

```ts
import { boardExportFileName, exportPng, exportSvg } from '@canvash/export';

const menu = document.getElementById('menu'); // <canvas-selection-menu export-board>
menu.addEventListener('export-board-request', async (event) => {
  const { boardId, format } = event.detail;
  const node = section.getSnapshot().document.nodes[boardId];
  const filename = boardExportFileName(node?.type === 'board' ? node.title : '', format);
  const scope = { board: boardId };
  const result =
    format === 'svg' ? await exportSvg(section, { scope }) : await exportPng(section, { scope, scale: 2 });
  // INVALID_SCOPE traz details.reason: 'not-found', 'not-a-board', 'hidden' ou 'malformed'.
  if (!result.ok) return showError(result.error.message);
  const blob = format === 'svg' ? new Blob([result.value], { type: 'image/svg+xml;charset=utf-8' }) : result.value;
  download(blob, filename); // 'Fluxo de aprovação-v2-final.svg'
});
```

No React, `<CanvasSelectionMenu exportBoard onExportBoardRequest={...} />`; no Vue, `<CanvasSelectionMenu :export-board="true" @export-board-request="..." />`.

#### Propriedades / Atributos
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância compartilhada do canvas. |
| `canvas` | — | `SelectionMenuCanvas \| undefined` | `undefined` | O `<canvas-surface>` do mesmo canvas: dá o estado da interação, a caixa de tela, o foco e o atalho de teclado. Sem ele o menu não aparece. |
| `exportBoard` | `export-board` | `boolean` | `false` | Liga o botão **Exportar board**, que aparece só quando a seleção é um único board. Quem exporta e baixa o arquivo é o host, pelo evento `export-board-request`. |
| `messages` | — | `Partial<SelectionMenuI18nMessages>` | `defaultI18nPtBR.selectionMenu` | Textos e rótulos acessíveis (`toolbarLabel`, `bringToFront`, `sendToBack`, `group`, `ungroup`, `exportBoard`, `exportBoardMenu`, `exportBoardSvg`, `exportBoardPng`, `delete`). Em pt-BR, `group` é `Agrupar` e `ungroup` é `Desagrupar`; em en, `Group` e `Ungroup`. |

#### Quebra de API (pacote em `0.0.0`, sem período de transição)
Saíram o botão Propriedades, o painel `popover`, o slot `properties`, `panelOpen` (`panel-open`), o evento `properties-panel-toggle` (agora da `<canvas-toolbar>`), as chaves `properties` e `panelLabel` do i18n do mini-menu e as partes `properties-panel` e `selection-action-properties`. O tamanho padrão do menu, antes da primeira medida, é `10 + n × 32 + (n − 1) × 2` px de largura por 42 de altura, com `n` botões visíveis: 110 × 42 px com três (a seleção de um nó), 144 com quatro e 178 com cinco.

#### Teclado
O mini-menu é um `role="toolbar"` ("Ações da seleção") com tabindex móvel: setas, Home e End andam entre os botões e Tab sai. Ele entra na ordem de tabulação logo depois do canvas. Com o canvas focado, a tecla de contexto (ContextMenu) ou ⇧F10 levam o foco ao mini-menu; os dois são atalhos de acesso ao menu, não de ferramenta.

No botão Exportar board, Enter, Espaço ou a seta para baixo abrem o submenu com o foco em SVG; as setas andam entre SVG e PNG, Enter ou Espaço escolhem, e Esc ou Tab fecham o submenu (Esc devolve o foco ao botão). Um clique fora também fecha. O botão leva `aria-haspopup="menu"` e `aria-expanded`, o submenu é um `role="menu"` com os itens `role="menuitem"`.

#### Partes (`::part()`)
`selection-menu`, `selection-action`, `selection-action-bring-to-front`, `selection-action-send-to-back`, `selection-action-group`, `selection-action-ungroup`, `selection-action-export-board`, `export-board-menu`, `export-board-item` e `selection-action-delete`. O visual vem dos tokens das ilhas (`--canvash-surface-float`, `--canvash-surface-float-border`, `--canvash-shadow-float`, `--canvash-radius-card`, `--canvash-text-float` e `--canvash-font-float`).

```html
<canvas-section>
  <canvas-surface id="canvas"></canvas-surface>
  <canvas-selection-menu slot="overlay" id="menu"></canvas-selection-menu>
  <canvas-toolbar slot="toolbar" orientation="vertical" hide-history hide-zoom compact-readonly>
    <canvas-properties slot="properties" id="props"></canvas-properties>
  </canvas-toolbar>
</canvas-section>
<script type="module">
  const canvas = document.getElementById('canvas');
  canvas.addEventListener('canvas-ready', (event) => {
    const { section } = event.detail;
    const menu = document.getElementById('menu');
    menu.section = section;
    menu.canvas = canvas;
    document.getElementById('props').section = section;
  });
</script>
```

Fora da ilha, `<canvas-properties>` continua funcionando fixo, como antes. O posicionamento (`placeSelectionMenu`, `placePanel` e `isSelectionVisible`) é geometria pura exportada por `@canvash/interaction`, usada também pelo exemplo Vanilla.

A mesma regra serve a quem monta o próprio menu, sem Lit:

```ts
import { executeGroup, executeUngroup, getGroupActions } from '@canvash/interaction';

const { selectedIds } = section.getSnapshot().session;
const { group, ungroup } = getGroupActions(section, selectedIds);
// group e ungroup valem 'hidden' | 'disabled' | 'enabled'.
if (group === 'enabled') executeGroup(section, selectedIds); // uma entrada de histórico
if (ungroup === 'enabled') executeUngroup(section, selectedIds); // todos os grupos, um transact
```

---

### `<canvas-layers>`
Árvore acessível de camadas e nós com sincronização reativa, suporte a alternar visibilidade (👁/∅), bloqueio (🔒/🔓), reordenação (↑/↓) e seleção simples ou múltipla.

#### Propriedades
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância compartilhada do canvas. |
| `messages` | — | `Partial<LayersI18nMessages>` | `defaultI18nPtBR.layers` | Textos e rótulos acessíveis das camadas e ações. |

#### Board aninhado
Um board aparece como `li.node-branch` com a linha dele (`div.node-item`, título no lugar do tipo) e, abaixo, uma lista aninhada (`ul.node-list`) com os filhos da frente para o fundo; um grupo dentro do board mostra os membros dele. Cada linha de filho leva `data-parent-id` com o ID do board. Subir e descer um filho só o move entre os irmãos do board (ou do grupo), pelo `node.reorder`, e nos extremos o botão fica desabilitado, como na camada. Com o board bloqueado, ou travado por outra sessão, os botões dos filhos ficam desabilitados e o filho não se seleciona.

#### Slots
- `<slot name="header"></slot>`: Substitui ou enriquece o cabeçalho padrão de camadas.
- `<slot></slot>` (padrão): Conteúdo exibido abaixo da lista de camadas.
- `<slot name="footer"></slot>`: Rodapé do painel de camadas.

---

### `<canvas-properties>`
Painel de inspeção e edição de propriedades da seleção ativa: posição (X, Y), dimensões (Largura, Altura), rotação, estilos (preenchimento, contorno, espessura, opacidade) e conteúdo textual.

#### Propriedades
| Propriedade JS | Atributo HTML | Tipo | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `section` | — | `CanvasSectionApi \| undefined` | `undefined` | Instância compartilhada do canvas. |
| `messages` | — | `Partial<PropertiesI18nMessages>` | `defaultI18nPtBR.properties` | Rótulos de campos, seções e estados. |

#### Slots
- `<slot name="header"></slot>`: Substitui ou enriquece o cabeçalho do painel.
- `<slot></slot>` (padrão): Conteúdo inserido após as seções de propriedades.
- `<slot name="footer"></slot>`: Rodapé do painel de propriedades.

#### Controles por figura
Com uma figura selecionada sozinha, o painel mostra os controles próprios dela. Os seletores estáveis são `data-action` (botões) e `data-field` (campos).

| Figura | Controle | Seletor | `part` |
| --- | --- | --- | --- |
| Retângulo | Converter para Quadrado (contenção `min(L, A)` no mesmo centro) | `data-action="convert-to-square"` | `btn-convert-type` |
| Quadrado | Converter para Retângulo | `data-action="convert-to-rectangle"` | `btn-convert-type` |
| Elipse | Converter para Círculo (contenção `min(L, A)` no mesmo centro) | `data-action="convert-to-circle"` | `btn-convert-type` |
| Círculo | Converter para Elipse | `data-action="convert-to-ellipse"` | `btn-convert-type` |
| Triângulo | Variante: isósceles, equilátero, retângulo, escaleno | `select[data-field="variant"]` | `field-triangle-variant`, `select-triangle-variant` |
| Triângulo escaleno | Ápice, de 0 a 1, passo 0,05 | `input[data-field="apex"]` | `field-triangle-apex`, `input-triangle-apex` |
| Polígono | Lados, de 3 a 12 | `input[data-field="sides"]` | `field-polygon-sides`, `input-polygon-sides` |
| Texto | Tamanho da fonte: "Automático (n)" e os 17 tamanhos de `FONT_SIZE_PRESETS` (12 a 120). Um tamanho fixa o modo e muda a fonte; "Automático" volta ao modo `auto` sem mudar o tamanho. Fora da lista, o tamanho exato aparece como opção extra; com textos diferentes selecionados, "Misto" aparece desabilitado. Afeta só os textos da seleção, numa única entrada de histórico | `select[data-field="fontSize"]` | `field-font-size`, `input-font-size` |
| Nota adesiva | Cor: seis amostras `role="radio"` (`aria-checked` na cor atual, vazia se as notas diferem) e um seletor personalizado. Só as notas da seleção mudam, numa única entrada de histórico; o contraste do texto e a dobra acompanham a cor. Com só notas selecionadas, a linha genérica de preenchimento some | `button[data-field="sticky-color"][data-color]`, `input[data-field="sticky-color-custom"]` | `section-sticky`, `sticky-swatches`, `sticky-swatch-<cor>`, `input-sticky-color` |
| Nota adesiva | Conteúdo e tamanho da fonte, como no texto livre | `input[data-property="text"]`, `select[data-field="fontSize"]` | `section-text`, `input-text`, `input-font-size` |
| Traço à mão livre | Contagem de traços, e a cor, que recolore todos os traços do elemento ("Misto" quando diferem; a opacidade do elemento fica na seção de aparência). Sem preenchimento nem contorno | `input[data-field="ink-color"]`, `[data-field="ink-strokes"]` | `section-ink`, `btn-ink-color-preview`, `input-ink-color` |
| Bézier | Simétrica (religar re-espelha `control2` a partir de `control1`) | `input[data-field="symmetric"]` | `section-bezier`, `field-bezier-symmetric`, `input-bezier-symmetric` |
| Cruz | Espessura dos braços, de 0,05 a 1, passo 0,05 | `input[data-field="armRatio"]` | `section-cross`, `field-cross-arm-ratio`, `input-cross-arm-ratio` |
| Chevron | Direção: direita, esquerda, cima, baixo | `select[data-field="direction"]` | `section-chevron`, `field-chevron-direction`, `select-chevron-direction` |
| Chevron | Profundidade da ponta, de 0 a 0,5, passo 0,05 | `input[data-field="notchDepth"]` | `field-chevron-notch-depth`, `input-chevron-notch-depth` |
| Chaves | Orientação da ponta: esquerda (`{`), direita (`}`), cima, baixo | `select[data-field="orientation"]` | `section-brace`, `field-brace-orientation`, `select-brace-orientation` |
| Chaves | Posição da ponta ao longo do eixo, de 0 a 1, passo 0,05 | `input[data-field="tipPosition"]` | `field-brace-tip-position`, `input-brace-tip-position` |
| Chaves | Curvatura dos cantos, de 0 (vivos) a 1 (raio máximo), passo 0,05 | `input[data-field="curvature"]` | `field-brace-curvature`, `input-brace-curvature` |

#### Texto na forma
Com ao menos uma forma elegível na seleção (retângulo, quadrado, elipse, círculo, losango, triângulo, polígono, cruz e chevron), o painel mostra a seção **Texto na forma** (`part="section-label"`), mesmo com várias formas selecionadas. Os seletores estáveis são os `data-field` abaixo, os mesmos no painel do exemplo Vanilla.

| Controle | Seletor | `part` |
| --- | --- | --- |
| Posição: Topo, Centro, Base (`role="radiogroup"`) | `[data-field="label-vertical-align"]`, botões `[data-value="top\|middle\|bottom"]` | `field-label-vertical-align`, `label-radios`, `label-radio` |
| Alinhamento: Esquerda, Centro, Direita (`role="radiogroup"`) | `[data-field="label-align"]`, botões `[data-value="left\|center\|right"]` | `field-label-align`, `label-radios`, `label-radio` |
| Tamanho (`FONT_SIZE_PRESETS`, com "Misto" quando diferem) | `select[data-field="labelFontSize"]` | `field-label-font-size`, `input-label-font-size` |
| Negrito (`aria-pressed` `true`, `false` ou `mixed`) | `button[data-field="label-bold"]` | `button-label-bold` |
| Cor do texto | `input[data-field="label-color"]` | `field-label-color`, `input-label-color` |
| Automática (volta à cor de maior contraste sobre o preenchimento) | `button[data-field="label-color-auto"]` | `button-label-color-auto` |

Cada clique aplica o campo a todas as formas elegíveis da seleção numa só entrada de histórico (`transact` com mais de uma). Os rádios seguem o padrão WAI-ARIA: Tab entra no marcado (no primeiro, se as formas divergem), as setas movem e marcam dando a volta, e Home e End vão às pontas. Os controles ficam desabilitados em modo leitura, com forma `locked` na seleção e com forma bloqueada por outra sessão (o aviso "Em edição por…" aparece). O texto em si se edita no canvas, não no painel: duplo clique na forma, Enter com uma só forma selecionada ou a ação `edit-text` (ver `KeyboardAction` em `@canvash/interaction`; o diálogo de atalhos de `<canvas-controls>` lista "Editar o texto da forma").

#### Board
Com só boards selecionados, o painel mostra a seção **Board** (`part="section-board"`) e, em `section-transform`, só X, Y, largura e altura: sem rotação, sem conversões e sem `section-style`. Com seleção mista, a seção do board some e os campos genéricos só agem nos nós que não são boards. Cada mudança é um `shape.update` e uma entrada de histórico (uma `transact` com vários boards, com estado misto).

| Controle | `part` | Observação |
| --- | --- | --- |
| Título (`maxlength` 200) | `input-board-title` | Só com um board; vazio ou igual ao atual não gera comando |
| Fundo (cor) | `input-board-fill`, `button-board-fill-none` | "Nenhum" grava `fill: null`; o botão se chama "Fundo: Nenhum" |
| Opacidade do fundo (0 a 100%) | `input-board-fill-opacity` | Grava `fillOpacity` de 0 a 1 |
| Borda (cor) | `input-board-stroke`, `button-board-stroke-none` | "Nenhum" grava `stroke: null`; o botão se chama "Borda: Nenhum" |

X e Y de um board levam os filhos pelo mesmo vetor numa só transação (um board com descendente `locked` ou travado por outra sessão não anda); largura e altura mudam só o board. As mensagens ficam em `messages.sectionBoard`, `boardTitle`, `boardBackground`, `boardBackgroundOpacity`, `boardBorder` e `boardNone`. O painel do exemplo Vanilla tem a mesma seção, com os mesmos `part` e `data-*`.

#### Editor do título do board
O duplo clique na faixa do título (os 24 de altura logo acima do board) abre um `<input>` de uma linha sobre ela (`data-testid="canvash-board-title-editor"`, opaco, `aria-label` de `messages.boardTitleLabel`, `maxlength` 200, texto selecionado). Enter e `blur` confirmam com um `shape.update { title }` sem espaços nas pontas; Esc cancela; vazio ou igual ao atual não gera comando. Não abre com o board `locked`, em camada bloqueada, bloqueado por outra sessão ou em somente leitura. O campo vive fora do documento, do preview e da exportação, e `<canvas-surface>` anuncia "Board <título> selecionado" (`messages.announceBoardSelection`) ao selecionar um board.

No texto em modo `auto`, as alças de canto escalam caixa e fonte, e a lateral só refaz a quebra. Em modo `fixed`, toda alça de canto ou lateral muda só a largura, a altura vem do layout e a fonte fica; as alças norte e sul não têm efeito. Na seleção múltipla, o grupo escala texto fixo só na largura.

Em quadrado, círculo, polígono e triângulo equilátero, Largura e Altura andam juntas: editar uma recalcula a outra pela proporção travada (1:1, ou `A = L·√3/2` no equilátero). A Bézier não tem preenchimento nem campos de caixa: o painel mostra só o traço, a opacidade e a simetria.

---

## 5. Theming e Customização Visual

O design dos Web Components é 100% customizável do lado de fora do Shadow DOM através de dois mecanismos padrão: **CSS Custom Properties** (tokens) e a pseudo-classe **`::part()`**.

### Tokens CSS Custom Properties

```css
:root {
  /* Foco e Acessibilidade (padrão: o preto da interface) */
  --canvash-focus-ring: #1f1f1f;

  /* Superfície do Canvas */
  --canvash-canvas-bg: #f2f3f5;

  /* Título dos boards no canvas. A exportação usa sempre #3f3f46, em qualquer tema. */
  --canvash-board-title-color: #3f3f46;

  /* Ilhas flutuantes: pills e cartões sobre o canvas. São o padrão de toolbar, menus, camadas,
     propriedades e controles; os tokens de cada componente (abaixo) vencem os destes. */
  --canvash-surface-float: #ebecef;
  --canvash-surface-float-border: rgba(0, 0, 0, 0.06);
  --canvash-surface-float-hover: #d9dbe0; /* fundo do hover das ilhas do topo e das ilhas temporárias que elas abrem (opaco, mais forte que o de repouso) */
  --canvash-surface-float-item-hover: #ccced3; /* tom de seleção dos itens das ilhas temporárias e início da linha do título em edição */
  --canvash-shadow-float: 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  --canvash-radius-pill: 9999px;
  --canvash-radius-card: 16px;
  --canvash-icon-size: 20px;
  --canvash-text-float: #1f1f1f;
  --canvash-font-float: Inter, 'Google Sans', system-ui, sans-serif;
  --canvash-accent-select: #6d5df6; /* único acento colorido: contorno, alças e marquee da seleção, lido do contêiner do canvas */
  --canvash-island-margin: 16px;
  --canvash-title-edit-bg: transparent; /* fundo do título em edição (aceita qualquer valor de `background`) */
  --canvash-title-edit-line: linear-gradient(90deg, var(--canvash-surface-float-item-hover, #ccced3), var(--canvash-canvas-bg, #f2f3f5)); /* linha de baixo do título em edição (`border-image-source`: precisa ser um gradiente) */

  /* Toolbar */
  --canvash-toolbar-bg: #ffffff;
  --canvash-toolbar-border: #cbd5e1;
  --canvash-toolbar-radius: 8px;
  --canvash-toolbar-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --canvash-toolbar-btn-hover: #f1f5f9;
  --canvash-toolbar-btn-active: #e2e8f0;
  --canvash-toolbar-btn-selected-bg: #dbeafe;
  --canvash-toolbar-btn-selected-color: #1d4ed8;

  /* Menu "Formas" (caem nos tokens da toolbar se omitidos) */
  --canvash-menu-bg: #ffffff;
  --canvash-menu-border: #cbd5e1;
  --canvash-menu-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  --canvash-menu-item-active-bg: #dbeafe;

  /* Indicador circular da borracha, sobre o canvas */
  --canvash-eraser-cursor: #334155;

  /* Painel de Camadas */
  --canvash-layers-bg: #ffffff;
  --canvash-layers-border: #e2e8f0;
  --canvash-layers-header-bg: #f8fafc;
  --canvash-layers-header-color: #1e293b;
  --canvash-node-hover-bg: #f8fafc;
  --canvash-node-selected-bg: #f0f9ff;
  --canvash-node-selected-color: #0369a1;

  /* Painel de Propriedades */
  --canvash-properties-bg: #ffffff;
  --canvash-properties-border: #e2e8f0;
  --canvash-properties-header-bg: #f8fafc;
  --canvash-properties-input-bg: #ffffff;
  --canvash-properties-input-border: #cbd5e1;
  --canvash-properties-input-color: #0f172a;
}
```

### Exemplo de Tema Escuro (Dark Theme)

```css
.dark-theme {
  --canvash-canvas-bg: #0f172a;
  --canvash-board-title-color: #d4d4d8;
  --canvash-toolbar-bg: #1e293b;
  --canvash-toolbar-border: #334155;
  --canvash-toolbar-btn-hover: #334155;
  --canvash-toolbar-btn-active: #475569;
  --canvash-toolbar-btn-selected-bg: #1e3a8a;
  --canvash-toolbar-btn-selected-color: #93c5fd;

  --canvash-layers-bg: #1e293b;
  --canvash-layers-border: #334155;
  --canvash-layers-header-bg: #0f172a;
  --canvash-layers-header-color: #f1f5f9;
  --canvash-node-hover-bg: #334155;
  --canvash-node-selected-bg: #1e3a8a;
  --canvash-node-selected-color: #bfdbfe;

  --canvash-properties-bg: #1e293b;
  --canvash-properties-border: #334155;
  --canvash-properties-header-bg: #0f172a;
  --canvash-properties-header-color: #f1f5f9;
  --canvash-properties-input-bg: #0f172a;
  --canvash-properties-input-border: #475569;
  --canvash-properties-input-color: #f8fafc;
}
```

### Estilização Granular via `::part()`

```css
/* Customiza especificamente os botões de ferramentas na Toolbar */
canvas-toolbar::part(tool-button) {
  border-radius: 6px;
  transition: transform 0.15s ease;
}

canvas-toolbar::part(tool-button):hover {
  transform: translateY(-1px);
}

/* Customiza os itens na lista de camadas */
canvas-layers::part(node-item) {
  padding: 6px 10px;
}

/* Customiza os campos numéricos no painel de propriedades */
canvas-properties::part(prop-input) {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

/* Destaca a ferramenta de curva e os controles próprios das figuras */
canvas-toolbar::part(tool-bezier) {
  font-weight: 600;
}

canvas-properties::part(select-triangle-variant),
canvas-properties::part(input-polygon-sides) {
  max-width: 120px;
}
```

---

## 6. Internacionalização (i18n)

O Canvash suporta internacionalização completa de todos os rótulos de botões, tooltips, atalhos e anúncios acessíveis.

### Configuração Global

```typescript
import {
  setGlobalI18n,
  defaultI18nEnUS,
  defaultI18nPtBR,
} from '@canvash/web-components';

// Muda todo o editor para inglês:
setGlobalI18n(defaultI18nEnUS);

// Ou sobrescreve apenas mensagens pontuais:
setGlobalI18n({
  toolbar: {
    select: 'Ponteiro de Seleção (V)',
    undo: 'Desfazer Última Ação',
  },
});
```

As chaves do `<canvas-section>` são `menu`, `editTitle` (uma função que recebe o título), `untitled`, `titleInput`, `share`, `export`, `exportMenu`, `exportSvg`, `exportPng` e `account` (uma função que recebe o nome), em pt-BR e en-US. As chaves do mini-menu da seleção para exportar um board são `exportBoard`, `exportBoardMenu`, `exportBoardSvg` e `exportBoardPng`, em pt-BR (`Exportar board`, `Opções de exportação do board`, `Exportar board como SVG` e `Exportar board como PNG`) e en-US. As chaves da borracha são `eraser`, `eraserSize`, `eraserThin`, `eraserMedium` e `eraserThick`. As chaves da caneta são `pen`, `penSettings`, `penKind`, `penKindPen`, `penKindMarker`, `penKindHighlighter`, `penWidth`, `penWidthThin`, `penWidthMedium`, `penWidthThick`, `penColor`, `penColorGraphite`, `penColorRed`, `penColorOrange`, `penColorYellow`, `penColorGreen`, `penColorBlue`, `penColorPurple`, `penColorPink` e `penColorCustom` na toolbar, e `sectionInk`, `inkStrokes` (uma função de contagem) e `inkColor` no painel. As chaves da nota adesiva são `sticky`, `stickyColor`, `stickyColorYellow`, `stickyColorPink`, `stickyColorGreen`, `stickyColorBlue`, `stickyColorOrange`, `stickyColorPurple` e `stickyColorCustom` na toolbar, e `sectionSticky` mais as mesmas chaves de cor no painel. As chaves do grupo "Formas" são `shapes`, `shapesOpen` e `shapesCurrent` (uma função que recebe o nome da forma). As chaves das figuras do Épico 01 são `square`, `circle`, `diamond`, `triangle`, `polygon`, `pentagon`, `hexagon`, `octagon`, `cross`, `chevron`, `brace` e `bezier` na toolbar, e `fontSize`, `fontSizeAuto`, `crossArmRatio`, `chevronDirection`, `directionRight`, `directionLeft`, `directionUp`, `directionDown`, `chevronNotchDepth`, `braceOrientation`, `braceTipPosition`, `braceCurvature`, `convertToRectangle`, `convertToSquare`, `convertToEllipse`, `convertToCircle`, `triangleVariant`, `triangleIsosceles`, `triangleEquilateral`, `triangleRight`, `triangleScalene`, `triangleApex`, `polygonSides` e `bezierSymmetric` no painel de propriedades, com textos em pt-BR e en-US.

### Customização por Instância do Componente

```typescript
const toolbar = document.querySelector('canvas-toolbar');
toolbar.messages = {
  select: 'Select Tool (V)',
  rect: 'Box Tool (R)',
};

const layers = document.querySelector('canvas-layers');
layers.messages = {
  title: 'Element Tree',
  empty: 'No items',
};
```

---

## 7. Conformidade com Acessibilidade (WCAG 2.1 AA)

- **Leitores de Tela:** Container com `role="region"`, rótulos semânticos e live announcer acessível via `aria-live="polite"` que anuncia seleção, ferramenta ativa e zoom sem poluir o leitor de tela durante gestos interativos contínuos de preview.
- **Teclado:** Navegação e acionamento completos sem necessidade de mouse.
- **Contraste de Cores:** Todos os tokens de texto e ícones respeitam a taxa mínima de contraste de 4.5:1 exigida pelo WCAG AA.
- **Auditoria Automatizada:** Testado com `@axe-core/playwright` com zero violações críticas ou sérias.
