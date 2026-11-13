# Publicação local dos pacotes `@canvash/*`

> **Este guia é para desenvolver a biblioteca com um registro local.** Quem só usa a Canvash instala pelos tarballs da Release do GitHub, sem registro: veja a seção Instalação do [README](../README.md).

Este guia leva do zero a um app novo, fora deste repositório, que instala `@canvash/react` de um registro npm **local** (Verdaccio) e desenha numa tela. Os pacotes ainda não estão no npmjs.

Conferido em 2026-11-06, com Node 26, pnpm 11.1.2 e o template `react-ts` do `create-vite` 9.3.4. Foram executados contra um Verdaccio 6.11.1 de ensaio: subir o registro, criar o usuário por HTTP, publicar os dez tarballs, criar o app, instalar, `pnpm dev` com um retângulo desenhado, `pnpm build`, atualizar um patch e despublicar. Ficam para a entrega da `0.1.0-alpha`, que confere este guia de ponta a ponta: `npm adduser` interativo, a tag e o `pnpm publish:local` real na `main`.

## Visão geral

```
repositório canvash  ──pnpm publish:local──▶  Verdaccio (localhost:4873)  ──pnpm add──▶  app novo
   main + tag v<versão>                         registro só da sua máquina
```

- Os dez pacotes sobem juntos, na mesma versão (`0.1.0-alpha`, depois `0.1.0-alpha.1`…).
- A publicação sai **só da `main`**, com a tag `v<versão>` no `HEAD` e a árvore limpa. Cada correção que o app precisa vira um patch novo.
- O repositório não tem remoto. Nada daqui vai para o npm público.

## 1. Subir o registro

O Verdaccio fica fora do repositório e não é dependência. Use a versão exata abaixo: é a última 6.x publicada há mais de sete dias (a 6.11.1, de 2026-10-24). O `latest` do npm já é a 7.x, mas a rodada foi validada na 6.

Num terminal separado, que fica aberto enquanto você publica e instala:

```bash
npx verdaccio@6.11.1
```

Na primeira execução ele cria a configuração padrão e mostra no log a linha `config file - <caminho>`. Confirme que está de pé:

```bash
curl -s http://localhost:4873/-/ping
# {}
```

### Trave o escopo `@canvash` (recomendado)

A configuração padrão repassa ao npmjs qualquer pacote que ele não tenha. Se alguém publicar um `@canvash/...` no npmjs, o seu registro poderia servi-lo no lugar do seu. Hoje o escopo `@canvash` não existe no npmjs, mas feche a porta: no `config.yaml` mostrado no log, acrescente a regra abaixo **antes** de `'@*/*'` (a ordem importa), e reinicie o Verdaccio.

```yaml
packages:
  '@canvash/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
  '@*/*':
    # ... o resto continua como estava
```

Sem a linha `proxy`, o Verdaccio nunca consulta o npmjs para esse escopo: um nome que você não publicou dá 404.

## 2. Criar o usuário

Só quem está autenticado publica. Uma vez por máquina:

```bash
npm adduser --registry http://localhost:4873/
```

Escolha usuário e senha quaisquer (o registro é seu). O token vai para o `~/.npmrc` da sua conta, **nunca para o repositório**. Confira:

```bash
pnpm whoami --registry http://localhost:4873/
```

Sem terminal interativo, o mesmo se faz por HTTP (testado):

```bash
curl -s -X PUT -H 'content-type: application/json' \
  http://localhost:4873/-/user/org.couchdb.user:SEU_USUARIO \
  -d '{"name":"SEU_USUARIO","password":"SUA_SENHA","email":"voce@example.com"}'
# devolve {"ok":"user ... created","token":"..."}: grave o token no ~/.npmrc como
#   //localhost:4873/:_authToken=<token>
```

## 3. Publicar uma versão

Pré-requisitos: tudo commitado e testado.

```bash
pnpm check:full                       # tem de sair com 0
git switch main
git merge --no-ff <sua-branch>        # a publicação sai só da main
git tag -a v0.1.0-alpha -m "Canvash 0.1.0-alpha"  # a versão dos manifestos, com o prefixo v
pnpm publish:local --dry-run          # confere tudo e imprime o comando, sem publicar
pnpm publish:local
```

O `publish:local` confere, nesta ordem, e sai com código 2, sem publicar nada, se alguma falhar:

1. os dez manifestos declaram `publishConfig.registry` igual ao registro usado;
2. todos têm a mesma versão;
3. a árvore de trabalho está limpa;
4. a branch é a `main`;
5. o `HEAD` tem a tag `v<versão>`;
6. o registro responde;
7. há usuário autenticado nele;
8. a versão ainda não existe no registro.

Só então roda `pnpm -r --filter "./packages/*" publish --registry http://localhost:4873/ --no-git-checks` e lista `nome@versão` de cada pacote, em ordem topológica. Se a publicação falhar no meio, sai com código 1 e diz quais pacotes já subiram.

Pontos que importam:

- **Use sempre o `pnpm`, nunca o `npm publish`.** No repositório, o `exports` de cada pacote aponta para `src`. Só o pnpm troca por `dist` no tarball e converte `workspace:*` na versão exata.
- **O registro vem do `publishConfig`.** Nos testes, o `publishConfig.registry` de cada manifesto vence a opção `--registry` do `pnpm publish`. Por isso o `publish:local` exige que os dez manifestos declarem o mesmo registro que ele vai usar, e `--registry` só aceita `localhost` e `127.0.0.1`.
- **Registro não aceita republicar.** Se a versão já existe, o script recusa. Suba a versão com `pnpm version:set` (seção 5).

Confira o resultado:

```bash
pnpm view @canvash/react@0.1.0-alpha version --registry http://localhost:4873/
```

## 4. Criar o app e instalar

Fora deste repositório:

```bash
pnpm create vite meu-desenho --template react-ts
cd meu-desenho
```

**`.npmrc`** do app. Só o escopo vai para o Verdaccio; o resto continua no npmjs:

```
@canvash:registry=http://localhost:4873/
```

**`pnpm-workspace.yaml`** do app:

```yaml
minimumReleaseAgeExclude:
  - '@canvash/*'
```

O pnpm 11 não instala, por padrão, uma versão publicada há menos de um dia, e prefere a anterior. Sem essa exclusão, um patch recém-publicado não chega ao app com `pnpm update` (testado: ficou na `0.1.0` com a `0.1.2` no registro). A exclusão vale só para o escopo `@canvash`. Se o seu app define um `minimumReleaseAge` maior, o restante das dependências continua sujeito a ele.

Instale:

```bash
pnpm add @canvash/core @canvash/react
```

Se o pnpm acusar `ERR_PNPM_IGNORED_BUILDS` (algum pacote com script de instalação, como o `esbuild`), libere-o no mesmo `pnpm-workspace.yaml` com `allowBuilds: { esbuild: true }`. O template do Vite 8 não precisa disso.

**CSS com altura.** O template do Vite traz um `src/index.css` que dá `min-height` ao `#root`, sem `height`. O canvas ocupa `100%` do pai e some (altura 0). Troque o conteúdo de `src/index.css` por:

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}
```

E remova a linha `import './App.css'` do `src/App.tsx`, se ela existir.

**`src/App.tsx`:**

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

Rode:

```bash
pnpm dev
```

Abra o endereço que o Vite mostrar. Escolha "Retângulo" na barra de ferramentas e arraste sobre a tela: o contador sobe para `1 nós`. Confira também `pnpm build`: ele compila sem erro de tipo e gera um bundle de cerca de 670 kB (180 kB com gzip), acima do aviso de 500 kB do Vite. Se isso incomoda, carregue o editor com `import()` dinâmico.

## 5. Atualizar para um patch (0.1.1)

No repositório do Canvash, para cada correção que o app precisa:

```bash
git switch -c correcao-x               # trabalhe numa branch
# ... corrija, com testes ...
pnpm version:set 0.1.1                 # grava os dez manifestos e as sete constantes
# acrescente "## 0.1.1 — AAAA-MM-DD" no topo do CHANGELOG.md de cada pacote
pnpm check:full
git commit -am "release: 0.1.1"
git switch main && git merge --no-ff correcao-x
git tag -a v0.1.1 -m "Canvash 0.1.1"
pnpm publish:local
```

O `version:set` não escreve o changelog: o teste de coerência falha enquanto algum pacote não tiver a seção da versão do manifesto.

No app:

```bash
pnpm update @canvash/core @canvash/react
```

Como o `package.json` do app guarda `^0.1.0-alpha`, uma versão alpha posterior entra sem editar nada. Confira com `pnpm list @canvash/core`.

## 6. Despublicar e recomeçar

Despublicar uma versão (o Verdaccio padrão permite a quem está autenticado):

```bash
npm unpublish @canvash/core@0.1.1 --registry http://localhost:4873/
```

Em vez de republicar o mesmo número, suba o seguinte (`0.1.2`): os caches do pnpm e do npm podem ter guardado a versão despublicada.

Para começar do zero, pare o Verdaccio e apague a pasta `storage` que fica ao lado do `config.yaml` (o caminho aparece no log de inicialização). O `htpasswd` ao lado guarda os usuários.

## 7. Se algo falhar

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `publish-local: o registro … não responde` | Verdaccio parado | `npx verdaccio@6.11.1` em outro terminal |
| `não há usuário autenticado` | sem token para esse registro | seção 2 |
| `o HEAD não tem a tag v…` | falta a tag, ou ela está noutro commit | `git tag -a v<versão> -m "…"` no `HEAD` da `main` |
| `a versão já existe no registro` | já publicada | `pnpm version:set` com um número novo |
| `404` ao instalar `@canvash/…` | o app não tem o `.npmrc` do escopo, ou a versão não foi publicada | seção 4 |
| Tela do app em branco | `#root` sem altura | CSS da seção 4 |
| `pnpm update` não traz o patch | idade mínima de release | `minimumReleaseAgeExclude` da seção 4 |
| Aviso "class-field-shadowing" do Lit no console, ou `canvas-ready` que não chega | `@canvash/web-components` construído sem `useDefineForClassFields: false` | já corrigido na `0.1.0-alpha`; atualize os pacotes |
