# Exemplo Vue

Usa os wrappers Vue (`@canvash/vue`) sobre os Web Components: `CanvasSurface`, `CanvasToolbar`, `CanvasLayers` e `CanvasProperties`, com o snapshot do canvas lido por `useCanvasSnapshot`.

- Pacote: `@canvash/example-vue`
- Endereço de desenvolvimento e de pré-visualização: <http://127.0.0.1:5175>
- A porta é fixa (`strictPort`): com a porta ocupada, o servidor falha em vez de subir em outra.

## Pré-requisitos

- Node e pnpm nas versões do `package.json` da raiz (`engines` e `packageManager`).
- Dependências instaladas a partir da raiz do repositório:

```bash
pnpm install --frozen-lockfile
```

## Executar

Na raiz do repositório:

```bash
pnpm dev:vue
```

ou, equivalente:

```bash
pnpm --filter @canvash/example-vue dev
```

## Build e pré-visualização

O build gera `examples/vue/dist`, que não é versionado:

```bash
pnpm --filter @canvash/example-vue build
pnpm --filter @canvash/example-vue preview
```

O `preview` serve o `dist` na mesma porta 5175.

## Layout

A página usa `<CanvasSection>`: o canvas ocupa a tela inteira e a interface flutua sobre ele.

- **Menu (≡), no canto superior esquerdo:** três itens do host ("Novo projeto", "Abrir projeto…" e
  "Sobre o Canvash"), passados em `menuItems`. Escolher um mostra um aviso passageiro
  ("Selecionado: …") logo abaixo do topo.
- **Título do projeto:** negrito; clique ou F2 para editar; Enter ou sair do campo confirma, Esc
  cancela.
- **Topo à direita:** Compartilhar (copia o link com `collab=true` e avisa "Link copiado"), Exportar
  (abre uma ilha com "Exportar SVG" e "Exportar PNG", que baixam o arquivo) e o avatar da conta
  (`public/avatar.svg`; se a foto falhar, mostra as iniciais).
- **Direita:** a `<CanvasToolbar>` vertical. O botão de controles deslizantes, abaixo do divisor, abre
  o cartão do **playground**: botões de figuras, leitura, o botão "Painéis" (camadas e propriedades,
  que começam escondidas), persistência e colaboração. Esc ou clique fora fecham o cartão.
- **Base à direita:** `<CanvasControls>` (desfazer, refazer, zoom e ajuda).

## Parâmetros de URL

- `?collab=true`: liga a colaboração em tempo real (Yjs) entre abas **deste** exemplo. Cada exemplo
  roda em uma origem própria, então abas de exemplos diferentes não colaboram entre si; o botão
  "Abrir Nova Aba" abre outra aba do mesmo exemplo.

## Isolamento

Este exemplo não importa código de nenhum outro exemplo (a regra é verificada por `pnpm check:arch`).
Ele consome os pacotes `@canvash/*` diretamente pelo fonte do repositório, sem build prévio.
