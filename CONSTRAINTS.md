# Constraints

Última revisão: 2026-11-13 por @humberto.santos (pipeline de release do GitHub sem publicação em npm: linha Release no GitHub. Antes, na primeira liberação alpha, 0.1.0-alpha: histórico reduzido a um commit raiz e saem as exceções W4, W5 e W6, que só valiam para o diff da rodada. Antes, em 2026-11-06: rodada da versão 0.1.0 e publicação local: linha Publicação nova, Empacotamento com o app React e os arquivos de apoio nos tarballs, exceções W4, W5 e W6 até 2027-01-29 e medição do `test:packaging`. Antes, em 2026-11-03: revisão do `check:full`: cache por conteúdo no lint e na formatação do estágio rápido, com contraprova sem cache no completo; `check:deps` reprova quando o scanner não conclui; base dos checks de diff por `scripts/diff-base.mjs`; gitleaks sem a saída gerada; `check:a11y` fora da cadeia do completo, que já o roda pela suíte de jornadas; sai a exceção W3, cujas asserções a `main` já contém; tabelas Medido e Fora deste contrato atualizadas. Antes, no mesmo dia, a mesclagem da rodada Organização e rótulos tirou a exceção W2 e a equivalência por renomeação do `floor-guard`)

Contrato de qualidade do Canvash. A [SPEC.md](./SPEC.md) diz o que construir; este arquivo diz o que é bom o bastante para entregar e qual comando dá o veredito.

Todo check é bloqueante: saída diferente de zero significa corrigir o código, nunca o check. Este arquivo é a fonte canônica. Os scripts do `package.json` e as configs (`tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `tests/packaging/vitest.config.ts`, `playwright.config.ts`, `.gitleaks.toml`, `.dependency-cruiser.cjs`) apenas o espelham; se divergirem, vale o que está aqui.

## Piso (sempre em vigor)

- Sem comentários de supressão novos: `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `v8 ignore`, `istanbul ignore`, `nosemgrep`, `gitleaks:allow`
- Sem stubs: `throw new Error('Not implemented')`, `catch {}` vazio, `TODO` no lugar da implementação
- Sem teste pulado, removido ou com asserção retirada (SPEC §11)
- Sem segredos no código
- Este arquivo não é enfraquecido para uma mudança passar

O piso é verificado no diff por `pnpm check:floor`, que também acusa limite reduzido, regra removida e exceção inválida neste arquivo. Uma asserção só pode ser trocada quando uma spec aprovada muda o comportamento que ela afirmava, e com uma exceção formal válida (ver Exceções).

## Com enforcement

| Dimensão | Regra | Verificado por | Roda em | Por quê |
| --- | --- | --- | --- | --- |
| Tipos | Zero erros em modo `strict`, com cada pacote verificado pelos próprios `tsconfig.json` e `tsconfig.test.json`; nenhum arquivo TypeScript fora de um projeto verificado e nenhum projeto com o modo strict desligado e `noUncheckedIndexedAccess` ligada em todo projeto com arquivos; lib sem DOM e sem tipos de Node, salvo no projeto que os declara | `pnpm check:fast` (`tsconfig-guard` e `tsc -b` incremental); `pnpm typecheck` (`node scripts/tsconfig-guard.mjs && tsc -b --force`) | cada edição (incremental); fim de tarefa e revisão (`--force`) | SPEC §4: contratos públicos e domínio tipados; `--force` porque o cache incremental do `tsc -b` aprovava arquivo movido entre projetos; ele sozinho levava 5,5 s e não cabia no estágio rápido |
| Lint | Zero erros; sem `any`, supressão inline sem efeito, DOM/timers/rede/armazenamento e globais de Node proibidos em `packages/core`, diretiva triple-slash proibida nos pacotes | `pnpm check:fast` (`eslint .` com cache por conteúdo em `node_modules/.cache/eslint/`); `pnpm lint` (`eslint .`, sem cache) | cada edição (com cache); revisão (sem cache, logo depois do estágio rápido) | SPEC §2 e §6 |
| Formatação | Zero arquivos fora do padrão do Prettier: dois espaços, ponto e vírgula e aspas simples. Markdown fica fora | `pnpm check:fast` (`prettier --check .` com cache por conteúdo em `node_modules/.cache/prettier/`); `pnpm format:check` (`prettier --check .`, sem cache) | cada edição (com cache); revisão (sem cache, logo depois do estágio rápido) | SPEC §6 e §8: o formatter aplica o padrão, sem discussão em revisão |
| Segredos | Zero achados | `pnpm check:secrets` (`gitleaks dir . --redact --no-banner`, com `.gitleaks.toml`: regras padrão; fora da varredura só a saída gerada e ignorada pelo git, `coverage/`, `dist/`, `test-results/` e `playwright-report/`) | cada edição | Segredo publicado não se desfaz com revert |
| Piso | Zero violações no diff | `pnpm check:floor` (`node scripts/floor-guard.mjs`) | cada edição | O caminho mais barato até o verde é silenciar o check |
| Nomes legados | Zero ocorrência dos nomes de `scripts/legacy-names.json` marcados `enforced` (palavra inteira) ou `type-context` (só em posição de tipo) | `pnpm check:names` (`node scripts/legacy-names-guard.mjs`) | cada edição | A renomeação libera o nome antigo para a área nova do canvas, sem alias; o guard impede o resto do sentido antigo |
| Arquitetura | Zero violações das fronteiras do CAPABILITY-MAP; Lit, React, Vue e Yjs só no pacote dono; nenhum exemplo importa código de outro exemplo; sem ciclos | `pnpm check:arch` (`depcruise . --config .dependency-cruiser.cjs`) | fim de tarefa, revisão | SPEC §1 e §7: core sem dependência de UI, mesmo transitiva |
| Cobertura: core | ≥ 90% statements/lines/functions, ≥ 85% branches | `pnpm test:changed` nos arquivos alterados; `pnpm test:coverage` no pacote inteiro | fim de tarefa, revisão | SPEC §9 |
| Cobertura: demais pacotes | ≥ 80% em cada métrica, por pacote | os mesmos comandos | fim de tarefa, revisão | SPEC §9; por pacote, para um pacote fraco não se esconder na média |
| Cobertura: linhas alteradas | ≥ 80% | `pnpm check:diff-coverage` (`node scripts/check-diff-coverage.mjs`, que roda `diff-cover coverage/lcov.info --compare-branch=<base de scripts/diff-base.mjs> --include-untracked --fail-under=80`) | fim de tarefa, revisão | Alto o bastante para forçar um teste, baixo o bastante para permitir uma linha de config |
| Empacotamento | Cada um dos dez pacotes de `packages/*` tem um teste em `tests/packaging` que instala o seu tarball fora do workspace, executa-o pelas duas entradas em Node sem DOM e compila seus tipos para consumidores ESM, CJS e bundler. Em core, interaction, web-components e no renderer o teste prova o contrato completo: o tarball traz só o manifesto, o `dist`, o README, o LICENSE (idêntico ao da raiz) e o CHANGELOG com a seção da versão (o `files` de cada pacote o declara, porque o pnpm não o inclui sozinho); o manifesto declara `exports` de `import` e de `require` com os tipos de cada um e não cita o fonte; os bundles `.mjs` e `.cjs` não embutem código de fora do pacote. Um app React montado só com os tarballs compila no Vite, abre no Chromium em produção e em desenvolvimento e desenha um retângulo pela toolbar sem erro de console (`tests/packaging/react-app.test.ts`) | `pnpm test:packaging` (`vitest run --config tests/packaging/vitest.config.ts`; o `globalSetup` constrói e empacota cada pacote uma vez por execução) | revisão | SPEC §7: o contrato de distribuição é provado por tarball, e uma regressão de empacotamento não aparece nos testes unitários |
| Publicação | Os dez pacotes têm a mesma versão no `package.json`; as sete constantes de versão (`src/version.ts`) repetem essa versão; cada `CHANGELOG.md` tem a seção `## <versão> — AAAA-MM-DD` da versão do manifesto; nenhum pacote é `private` (a raiz e os exemplos continuam); cada pacote declara `publishConfig.registry` igual a `http://localhost:4873/`; `pnpm publish:local` recusa publicar, com código 2, se a árvore tem alteração, a branch não é a `main`, o `HEAD` não tem a tag `v<versão>`, o registro não responde, não há usuário ou a versão já existe, e só aceita registro em `localhost` ou `127.0.0.1` | `tests/tooling/release.test.ts` (projeto `serial`, estágio `check:task`; as recusas rodam num repositório git temporário contra um registro falso, e o registro real nunca é usado) | fim de tarefa, revisão | Pacotes em versões diferentes, sem changelog ou com destino errado só apareceriam na hora de publicar, e uma publicação não se desfaz sem rastro |
| Release no GitHub | O workflow `.github/workflows/release.yml` dispara só à mão (`workflow_dispatch`) e só roda na `main`; toda ação vem presa ao hash de um commit; as permissões do topo são só leitura (a escrita fica no job); nenhum segredo além do `GITHUB_TOKEN` e nenhuma publicação em registro npm (a biblioteca é usada pelos tarballs da Release); nenhum bloco `run:` interpola `${{ }}`; `scripts/release-ci.mjs` recusa versão incoerente, troca `workspace:` entre pacotes pela URL do tarball na Release (https, ou http só em loopback) e recusa `workspace:` que aponta para fora de `packages/*` | `tests/tooling/release-ci.test.ts` (projeto `serial`, estágio `check:task`) | fim de tarefa, revisão | Um workflow de release editado à mão pode ganhar gatilho automático, segredo ou injeção de script sem que nenhum teste de código perceba, e uma Release publicada não se desfaz sem rastro |
| Jornadas e2e | 100% dos testes e2e passam nas três engines (Chromium, Firefox, WebKit); fixtures visuais RENDER-01 a RENDER-05 | `pnpm test:e2e` (`playwright test tests/e2e`) | revisão (`check:full`) | SPEC §9 e SPEC-renderer-canvas2d: paridade entre browsers e regressão visual comprovada em navegador real |
| Segurança: código | Zero achados de `p/default` e `p/owasp-top-ten`, inclusive em `tests/` (`.semgrepignore`) | `pnpm check:sast` (`semgrep scan --config p/default --config p/owasp-top-ten --error --quiet .`) | revisão | Filtrar só severidade alta deixava um `eval` passar; o repositório começa em zero |
| Segurança: supply chain | `minimumReleaseAge` ≥ 10080 minutos, `blockExoticSubdeps: true`, `trustPolicy: no-downgrade` | `pnpm check:sast` (regras pnpm do Semgrep) | revisão | Versão recém-publicada é o vetor usual de pacote malicioso; sete dias é o valor exigido pela regra |
| Segurança: dependências | Nenhuma vulnerabilidade alta ou crítica (CVSS a partir de 7.0); severidade desconhecida conta como alta | `pnpm check:deps` (`node scripts/check-deps.mjs`, que roda `osv-scanner scan source -r . --format json` e reprova também quando o scanner não conclui a consulta, sem rede por exemplo, ou devolve saída que não é JSON) | revisão | Abaixo de alta é majoritariamente ruído |
| Acessibilidade (axe-core) | Zero violações críticas ou sérias via axe-core nos componentes e playground; contraste WCAG AA | `pnpm check:a11y` (`playwright test tests/e2e/web-components/a11y.spec.ts`) | revisão (`check:full`) | WCAG 2.1 AA e SPEC-web-components: conformidade acessível automatizada com axe-core |

Os checks de diff (`check:floor`, `test:changed` e `check:diff-coverage`) tomam a base de `scripts/diff-base.mjs`: o merge-base de `main` (ou de `CONSTRAINTS_BASE`, por exemplo `origin/main` em um pipeline) com o HEAD. Na própria `main` esse merge-base é o HEAD e o diff ficaria vazio, então a base recua para o primeiro pai: o guard enxerga o último commit direto, ou o conjunto do branch numa mesclagem, mais a árvore de trabalho; commits anteriores ao HEAD não são revistos. Num clone raso que cortou o pai do HEAD, ou com base inexistente, os checks saem com 2 em vez de aprovar um diff vazio.

A spec de acessibilidade fica em `tests/e2e`, então `pnpm test:e2e` já a executa nas três engines dentro do `check:full`; `pnpm check:a11y` roda só ela, isolada, e não entra na cadeia do completo para não repetir os mesmos testes. Em troca, uma violação de acessibilidade aparece durante a suíte de jornadas e não antes dela. Aprovado pelo dono em 2026-11-03.

## Estágios

| Estágio | Comando | Quando | Orçamento |
| --- | --- | --- | --- |
| Rápido | `pnpm check:fast` | depois de cada edição | ≤ 5 s |
| Tarefa | `pnpm check:task` | antes de devolver o trabalho | ≤ 90 s |
| Completo | `pnpm check:full` | revisão e pipeline | sem limite |

Um check que estoura o orçamento sobe de estágio; não é desligado. O pipeline `.github/workflows/ci.yml` roda `pnpm check:full` com os browsers do Playwright instalados; o repositório ainda não tem remoto, então hoje ele não executa.

Os testes de `tests/tooling` e `tests/benchmarks` rodam no projeto Vitest `serial`, depois do resto da suíte e um arquivo por vez: executam processos ou geram cenas grandes e, em paralelo com a suíte, estouravam o tempo por disputa de CPU. Nenhum limite de tempo foi aumentado.

Os limites de cobertura por pacote valem sobre a suíte inteira (`pnpm test:coverage`, no `check:full`). O `pnpm test:changed`, do estágio de tarefa, roda só os testes afetados e mede o pacote pelos poucos arquivos carregados, então não aplica esses limites; o gate daquele estágio é a cobertura das linhas alteradas (`pnpm check:diff-coverage`, ≥ 80%). Aprovado pelo dono em 2026-10-26, ao ver que editar o arquivo da toolbar (hoje `canvas-toolbar.ts`) reprovava o `check:task` com 73% de funções, pelo recorte do pacote.

Ferramentas fora do `pnpm install`: `gitleaks`, `osv-scanner` (versão 2 ou superior, pelo subcomando `scan source`) e `semgrep` (Homebrew), `diff-cover` (`pipx install diff-cover`) e os browsers do Playwright (`pnpm exec playwright install chromium firefox webkit`). O pipeline fixa as mesmas versões usadas localmente, com hash verificado: gitleaks 8.30.1, osv-scanner 2.5.1, semgrep 1.175.0 e diff-cover 10.6.0; ao atualizar uma delas aqui, atualize as duas pontas.

Este arquivo é versionado: o `floor-guard` só enxerga no diff o que está no git, e é assim que limite afrouxado, regra removida e exceção nova aparecem.

## Medido, ainda sem enforcement

As linhas sem data própria foram medidas em 2026-10-26, na revalidação para a spec vertical-island; as linhas datadas de 2026-11-03 são a remedição da revisão do `check:full` (etapas cronometradas uma a uma, Node 26.0.0, pnpm 11.1.2, Apple M4 Pro) e substituem, na leitura, as de mesmo nome sem data. As métricas de desempenho são as dos checkpoints dos Marcos 2 e 4 e dos relatórios citados em cada linha.

| Métrica | Valor | Direção |
| --- | --- | --- |
| Tempo de `check:fast` | 4,2 a 4,6 s (era 6,6 a 7,0 s com `tsc --force`) | não pode crescer além do orçamento |
| Tempo de `check:names` | 0,4 s; com ele o `check:fast` mede 4,6 a 5,0 s (2026-10-31) | não pode crescer além do orçamento |
| Tempo de `check:task` | 50 s no pior caso (mudança em `scripts/` refaz a suíte inteira: 3205 testes) | não pode crescer além do orçamento |
| Tempo de `check:full` | 543 s (9 min), sendo 6,1 min da suíte E2E (2448 testes nas três engines) | acompanhar |
| Vulnerabilidades conhecidas, qualquer severidade | 2: o aviso moderado GHSA-p458-7748-mcp3 em `@vitest/browser` e `@vitest/ui` 5.0.3, dependências de desenvolvimento (era 0) | não pode crescer |
| Tempo de `check:fast` com cache (2026-11-03) | 0,9 s com o cache quente; 5,7 s na primeira rodada depois de mudar config ou versão do ESLint, do Prettier ou do Node, ou depois de `pnpm typecheck` | não pode crescer além do orçamento |
| Tempo de `check:task` (2026-11-03) | 58 s no pior caso (mudança em `scripts/` refaz a suíte inteira: 4580 testes) | não pode crescer além do orçamento |
| Tempo de `check:full` (2026-11-03) | 779 s (13 min, uma execução de `pnpm check:full`), sendo 11,0 min da suíte E2E (4392 testes, 1464 por engine, já com a spec de acessibilidade), 50 s do `test:coverage` (4580 testes) e 27 s do `test:packaging`; era ≈ 945 s antes desta revisão | acompanhar |
| Tempo de `test:packaging` (2026-11-06) | 30 s, com 137 testes em 14 arquivos, incluindo o app React montado só com os tarballs e a conferência de LICENSE, README e CHANGELOG nos dez tarballs (27 s antes da rodada da versão 0.1.0) | acompanhar |
| Tempo de `tests/tooling/release.test.ts` (2026-11-06) | 19 s, com 67 testes no projeto `serial`, sendo a maior parte os cenários do `publish:local` num repositório git temporário | não pode crescer além do orçamento do `check:task` |
| Vulnerabilidades conhecidas, qualquer severidade (2026-11-03) | 2: GHSA-gcqx-w48m-w2h4 em `deepmerge` 4.3.1 (sem versão corrigida publicada; dependência de build via `unbuild`) e GHSA-g3hv-75wg-m249 em `minimatch` 10.2.6 (via ESLint; nenhum dependente aceita a versão corrigida, então a correção é um override para a 11, a aplicar quando ela passar do `minimumReleaseAge`). GHSA-p458-7748-mcp3 saiu com o Vitest 5.0.5 | não pode crescer |
| Pan/zoom frame time no Marco 2 (10k nós, 734 visíveis, p95) | 1,8 ms | no máximo 16,7 ms |
| Hit-test pontual no Marco 2 (mesma cena, p95) | 0,1 ms | no máximo 4,0 ms |
| Repouso no Marco 2 (1s estável) | 0 repinturas | no máximo 0 repinturas |
| Pan/zoom frame time no Marco 4 (10k nós avançados, ~1100 visíveis, p95) | 3,8 ms | no máximo 16,7 ms |
| Hit-test pontual no Marco 4 (mesma cena avançada, p95) | 0,1 ms | no máximo 4,0 ms |
| Repouso no Marco 4 (1s estável) | 0 repinturas | no máximo 0 repinturas |
| Prévia do arrasto remoto (10k nós, 3 participantes × 20 nós, p95 além do quadro sem prévia) | 0 ms (2026-10-29, `pnpm benchmark:peers`; relatório em `docs/benchmarks/colaboracao-2026-10-peers.md`) | orçamento de 4 ms, medido, sem gate |
| `getGroupActions` (10k nós selecionados e um cursor remoto por quadro, p95) | 0,4 ms (2026-11-01, `pnpm benchmark:peers`; relatório em `docs/benchmarks/colaboracao-2026-10-peers.md`) | orçamento de 1 ms, medido, sem gate |
| Pan/zoom com texto nas formas (10k formas, 5k com texto de três linhas, 778 visíveis, p95) | 5,2 ms (2026-11-01, `pnpm benchmark:labels`; relatório em `docs/benchmarks/organizacao-2026-10-labels.md`) | no máximo 16,7 ms, medido, sem gate |
| Hit-test pontual na cena com texto nas formas (p95) | 0,1 ms (2026-11-01, `pnpm benchmark:labels`) | no máximo 4,0 ms, medido, sem gate |
| Layouts de texto após `replaceDocument` sem mudança e num quadro de arrasto de 500 formas com texto | 0 e 0 (2026-11-01, `pnpm benchmark:labels`) | no máximo 0, medido, sem gate |
| Quadro do arrasto local de um board com 1.000 filhos (10k nós, p95) | 1,9 ms (2026-11-01, `pnpm benchmark:boards`; relatório em `docs/benchmarks/organizacao-2026-11-boards.md`) | no máximo 16,7 ms, medido, sem gate |
| Commit do movimento de um board com 1.000 filhos (`transact` de 1.001 `shape.update`, p95) | 4,7 ms (2026-11-01, `pnpm benchmark:boards`) | no máximo 50 ms, medido, sem gate |

## Fora deste contrato por enquanto, e o que já entrou

| Dimensão | Situação | Quando rever |
| --- | --- | --- |
| Performance | As metas da SPEC §9 são medidas por `pnpm benchmark*` (build de produção de `examples/vanilla` servido localmente, Chromium headless) na máquina de referência eleita no Marco 2 (Apple M4 Pro, `docs/benchmarks/marco-2.md`); os valores estão na tabela Medido. Não vira gate porque o resultado depende da máquina, e a SPEC prefere benchmark dedicado a tempos de CI compartilhada como evidência absoluta | Ao definir remoto e pipeline: decidir entre runner dedicado com limiar (gate novo e infraestrutura externa exigem alinhamento prévio) ou medição manual por marco |
| Acessibilidade | Entrou no contrato no Marco 5 com o `check:a11y` (ver tabela Com enforcement); a linha fica porque o `check:floor` acusa a retirada de linha de tabela deste arquivo | Marco 5, concluído |

Performance tem medição reproduzível (`pnpm benchmark*`), mas nenhum check bloqueante inventado no lugar: sem máquina de referência no pipeline, a meta continua sendo a da SPEC. Acessibilidade já está na tabela Com enforcement.

## Exceções

Toda exceção tem dono e validade de no máximo 90 dias: tempo para planejar a correção sem esquecer o motivo. Linha nova aqui entra em commit separado da mudança que estava falhando, com aprovação explícita do dono.

`pnpm check:floor` lê esta tabela a cada execução e só aplica uma linha válida:

- a regra é `assercao-removida`, a única que admite exceção, para a asserção trocada por uma mudança de comportamento aprovada numa spec;
- o caminho lista os arquivos de teste um a um, separados por vírgula, sem curinga;
- motivo e dono estão preenchidos;
- a validade é uma data `AAAA-MM-DD` entre hoje e 90 dias à frente.

Uma linha válida cobre só os achados da regra nos arquivos listados, e o guard informa quantos achados ela cobre. Linha inválida não cobre nada e é acusada: como `nova-excecao` quando entra no diff, ou como `excecao-invalida` quando já existia (vencida, por exemplo). A linha sai no commit seguinte à mesclagem com a `main`: na mesclagem o guard ainda compara com o primeiro pai e precisa dela; no commit seguinte a base já contém as asserções novas.

| ID | Regra | Caminho | Motivo | Dono | Expira |
| --- | --- | --- | --- | --- | --- |
