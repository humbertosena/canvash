# Canvash

Biblioteca de canvas para desenho e quadros colaborativos na web. O motor não depende de DOM nem de framework; sobre ele há renderização em Canvas 2D, interações, persistência, exportação, colaboração CRDT (Yjs; nesta alpha o transporte dos exemplos é entre abas do mesmo navegador, sem servidor de rede) e adaptadores para React, Vue e Web Components.

> **Versão `0.1.0-alpha`.** Primeira liberação alpha: a API pode mudar entre versões alpha sem aviso de depreciação. A biblioteca **não é publicada no npm**: usa-se apontando direto para o GitHub; veja [Instalação](#instalação).

## Pacotes

Todos os pacotes saem juntos, na mesma versão, na mesma Release do GitHub.

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

A biblioteca **não é publicada no npm**. Cada [Release do GitHub](https://github.com/humbertosena/canvash/releases) traz um arquivo `.tgz` por pacote (o mesmo que o `pnpm pack` gera, com `dist` e tipos) e um `SHA256SUMS`. O app aponta o `pnpm add` para a URL desses arquivos.

> **Por que não `pnpm add github:humbertosena/canvash`?** Este é um monorepo: no código-fonte, o `exports` de cada pacote aponta para `src/*.ts` e as dependências entre pacotes são `workspace:*`. Instalado direto do repositório, o pacote chega quebrado (`ERR_MODULE_NOT_FOUND`). Só os tarballs da Release têm o `dist` e as dependências internas resolvidas.

**1. Libere a instalação por URL.** Os pacotes `@canvash/*` dependem uns dos outros por URL, e o pnpm 11 bloqueia dependência por URL dentro de outra dependência (`ERR_PNPM_EXOTIC_SUBDEP`). No `pnpm-workspace.yaml` do app:

```yaml
blockExoticSubdeps: false
```

Essa chave vale para todas as dependências do app, não só para as `@canvash/*`. Com npm ou yarn não há esse passo.

**2. Instale.** Troque `V` pela versão da Release que você quer (veja a [página de Releases](https://github.com/humbertosena/canvash/releases)):

```bash
V=0.1.0-alpha
B=https://github.com/humbertosena/canvash/releases/download/v$V
pnpm add $B/canvash-core-$V.tgz $B/canvash-react-$V.tgz react react-dom
```

Para cada pacote, o arquivo se chama `canvash-<nome>-<versão>.tgz`: `canvash-core`, `canvash-react`, `canvash-vue`, `canvash-web-components`, `canvash-renderer-canvas2d`, `canvash-interaction`, `canvash-persistence`, `canvash-export`, `canvash-collaboration` e `canvash-collaboration-yjs`. **Instale como dependência direta todo pacote `@canvash/*` que o seu código importa** (ao menos `@canvash/core`): o pnpm não expõe ao app uma dependência que só outro pacote declara.

**3. Conferir a integridade (opcional).** Baixe da página da Release os `.tgz` que quer conferir e o `SHA256SUMS` para a mesma pasta e rode `shasum -a 256 --ignore-missing -c SHA256SUMS`. O `SHA256SUMS` está na mesma Release dos arquivos: ele detecta download corrompido, não protege contra uma Release adulterada. Depois do primeiro `pnpm add`, o `pnpm-lock.yaml` do app guarda o hash de cada tarball e o pnpm o confere nas instalações seguintes.

**Atualizar.** Mude o `V` e rode o `pnpm add` de novo: o `package.json` do app guarda a URL, então a versão nova só entra ao trocar a URL.

Para desenvolver a biblioteca com um registro npm local (Verdaccio), veja [`docs/publicacao-local.md`](./docs/publicacao-local.md).

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

## Releases

Não há publicação em registro npm. A Release do GitHub é criada por um workflow, a partir da `main`:

1. Numa branch, suba a versão: `pnpm version:set <versão>`, acrescente a seção `## <versão> — AAAA-MM-DD` no `CHANGELOG.md` de cada pacote e atualize a linha `V=` do README, de `docs/guia-para-agentes.md` e dos READMEs dos pacotes (o teste `release-ci` aponta o arquivo que ficar para trás).
2. Abra a PR para a `main` (push direto é bloqueado) e mescle.
3. Espere a CI da `main` ficar verde.
4. Em **Actions → Release → Run workflow**, na `main`: o workflow confere a versão, monta os dez tarballs, cria a tag `v<versão>` e a Release (marcada como pré-release quando a versão tem hífen, como `0.1.0-alpha`) com os `.tgz` e o `SHA256SUMS`. Marque `dry_run` para só simular.

## Licença

[MIT](./LICENSE)
