# Exemplo Vanilla

Monta o core, o renderer Canvas 2D e a interação à mão, sem componentes prontos nem framework: um playground em HTML e TypeScript com barra de ferramentas, painéis e botões de persistência, exportação e colaboração próprios.

- Pacote: `@canvash/example-vanilla`
- Endereço de desenvolvimento e de pré-visualização: <http://127.0.0.1:5173>
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
pnpm dev:vanilla
```

ou, equivalente:

```bash
pnpm --filter @canvash/example-vanilla dev
```

## Build e pré-visualização

O build gera `examples/vanilla/dist`, que não é versionado:

```bash
pnpm --filter @canvash/example-vanilla build
pnpm --filter @canvash/example-vanilla preview
```

O `preview` serve o `dist` na mesma porta 5173.

## Layout

O padrão é o de ilhas flutuantes: o canvas ocupa a tela inteira e a interface flutua sobre ele.

- **Menu (≡), no canto superior esquerdo:** três itens do host ("Novo projeto", "Abrir projeto…" e
  "Sobre o Canvash"). Escolher um mostra um aviso passageiro ("Selecionado: …") logo abaixo do topo.
- **Título do projeto:** negrito; clique ou F2 para editar (itálico, com fundo em gradiente); Enter
  ou sair do campo confirma, Esc cancela.
- **Topo à direita:** Compartilhar (copia o link com `collab=true` e avisa "Link copiado"), Exportar
  (abre uma ilha com "Exportar SVG" e "Exportar PNG", que baixam o arquivo) e o avatar da conta
  (`public/avatar.svg`; se a foto falhar, mostra as iniciais). No `?layout=classic` os botões de
  exportação ficam soltos, no topo.
- **Direita:** as ferramentas, numa pílula vertical. O botão de controles deslizantes, abaixo do
  divisor, abre o cartão do **playground**: zoom e pan, grade e snap, informações do viewport e da
  ferramenta, seleção e tipo, nota adesiva, caneta, borracha, persistência e colaboração. Esc ou
  clique fora fecham o cartão. No `?layout=classic` esses controles ficam soltos na página.
- **Base à direita:** histórico, menu de zoom e ajuda.

## Parâmetros de URL

- `?collab=true`: liga a colaboração em tempo real (Yjs) entre abas **deste** exemplo. Cada exemplo
  roda em uma origem própria, então abas de exemplos diferentes não colaboram entre si; o botão
  "Abrir Nova Aba" abre outra aba do mesmo exemplo.
- `?layout=classic`: o layout anterior, em barras fixas e com o canvas de 800 × 600, que as jornadas de teste de renderer e interação usam; o padrão é o layout de ilhas flutuantes.
- `?grid=lines`: usa o grid de linhas no lugar do grid de pontos, que é o padrão.

## Isolamento

Este exemplo não importa código de nenhum outro exemplo (a regra é verificada por `pnpm check:arch`).
Ele consome os pacotes `@canvash/*` diretamente pelo fonte do repositório, sem build prévio.
