#!/usr/bin/env node
// floor-guard.mjs — aplica o piso de qualidade sobre o diff.
// Uso: node scripts/floor-guard.mjs [--base <ref>]   (padrão: $CONSTRAINTS_BASE ou main; a base
// efetiva vem de scripts/diff-base.mjs, que na própria main recua para o primeiro pai)
// Saída: 0 limpo, 1 violação do piso, 2 o guard não conseguiu rodar.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveDiffBaseOrExit } from './diff-base.mjs';

// `git diff --no-index` sai com 1 sempre que os lados diferem, o caso normal de um arquivo
// novo, então essa saída é mantida. Qualquer outra falha vira null, e null nunca conta como limpo;
// o stderr do git fica guardado para o bail mostrar a causa.
let lastGitError = '';
const git = (args, { diffExit = false } = {}) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (diffExit && e.status === 1 && typeof e.stdout === 'string') return e.stdout;
    lastGitError = (typeof e.stderr === 'string' ? e.stderr : String(e.message)).trim();
    return null;
  }
};
const bail = (msg) => {
  console.error('floor-guard: ' + msg + (lastGitError ? '\n  git: ' + lastGitError : ''));
  process.exit(2);
};

// Roda a partir da raiz: `git ls-files` só lista a subárvore do diretório atual.
const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('fora de um repositório git');
process.chdir(top);

const diffBase = resolveDiffBaseOrExit('floor-guard', { cwd: top });

// Diff unificado mais os arquivos não rastreados (o git diff sozinho não vê arquivo novo).
const tracked = git(['diff', '--unified=0', diffBase, '--']);
if (tracked === null) bail('não foi possível gerar o diff contra ' + diffBase);
const untrackedFiles = git(['ls-files', '--others', '--exclude-standard']);
if (untrackedFiles === null) bail('não foi possível listar os arquivos não rastreados');
const untracked = untrackedFiles
  .split('\n')
  .filter(Boolean)
  .map((f) => {
    const d = git(['diff', '--no-index', '--unified=0', '/dev/null', f], { diffExit: true });
    if (d === null) bail('não foi possível gerar o diff do arquivo novo ' + f);
    return d;
  })
  .join('\n');
const diff = tracked + '\n' + untracked;

// `---` e `+++` só são cabeçalhos entre a linha `diff` do arquivo e o primeiro `@@`; dentro de
// um hunk toda linha é conteúdo. Os dois cabeçalhos nomeiam o arquivo, então uma remoção
// (`+++ /dev/null`) mantém o nome.
const added = [];
const removed = [];
const deleted = [];
const pathOf = (s) => s.replace(/^[ab]\//, '');
let file = '';
let oldFile = '';
let inHeader = false;
for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) inHeader = true;
  else if (line.startsWith('@@')) inHeader = false;
  else if (inHeader) {
    if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
    else if (line.startsWith('+++ ')) {
      const newFile = pathOf(line.slice(4));
      file = newFile === '/dev/null' ? oldFile : newFile;
      if (newFile === '/dev/null') deleted.push(file);
    }
  } else if (line.startsWith('+')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-')) removed.push({ file, text: line.slice(1) });
}

const findings = [];
const flag = (rule, f, text) => findings.push({ rule, file: f, text: text.trim().slice(0, 120) });
const isCode = (f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/.test(f);
const isTest = (f) => /\.(test|spec)\./.test(f);
const isConstraints = (f) => /CONSTRAINTS\.md$/.test(f);

// Os padrões são montados em pedaços para o guard não casar com o próprio fonte.
const pattern = (...alternatives) => new RegExp(alternatives.map((a) => a.join('')).join('|'));
// 1. Checker silenciado.
const SUPPRESSIONS = pattern(
  ['@ts-', 'ignore'],
  ['@ts-', 'nocheck'],
  ['eslint-', 'disable'],
  ['v8 ', 'ignore'],
  ['c8 ', 'ignore'],
  ['istanbul ', 'ignore'],
  ['no', 'semgrep'],
  ['gitleaks:', 'allow'],
  ['Stryker ', 'disable'],
);
// 4. Trabalho inacabado.
const STUBS = pattern(
  ['throw new \\w*Error.*', '([Nn]ot implemented|[Nn]ão implementad)'],
  ['catch\\s*\\(\\w*\\)\\s*', '\\{\\s*\\}'],
  ['catch\\s*', '\\{\\s*\\}'],
  ['\\bTO', 'DO\\b'],
);
// 2. Teste facilitado: pulado, condicionado ou isolado (o `.only` desliga todos os outros).
const SKIPS = pattern(
  ['\\.(skip|skip', 'If|run', 'If|on', 'ly|to', 'do|fixme)\\b'],
  ['\\bx', 'it\\('],
  ['\\bx', 'describe\\('],
);

const addedExceptions = [];
for (const { file, text } of added) {
  if (isCode(file)) {
    if (SUPPRESSIONS.test(text)) flag('checker-silenciado', file, text);
    if (STUBS.test(text)) flag('trabalho-inacabado', file, text);
    if (isTest(file) && SKIPS.test(text)) flag('teste-facilitado', file, text);
  }
  if (isConstraints(file) && isException(text)) addedExceptions.push({ file, text });
}

// 1b. Regra do piso de qualidade enfraquecida ou removida. Uma regra é um item do piso ou uma linha
// de tabela, identificada pelo texto antes dos dois-pontos ou pela primeira célula. Cada número
// tem uma direção lida das palavras ao redor: um mínimo (≥, não pode cair) afrouxa ao descer, um
// máximo (≤, não pode crescer) ao subir. Número sem direção legível é reportado sempre que muda,
// porque o guard não distingue apertar de afrouxar e ficar calado é o padrão errado.
function isException(t) {
  return /^\| *(W|E)\d+ *\|/.test(t.trim());
}
const ruleKey = (t) => {
  const s = t.trim();
  if (s.startsWith('|')) {
    return (
      s
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)[0] ?? ''
    );
  }
  if (/^[-*] /.test(s)) return s.slice(2).split(':')[0].trim();
  return null; // prosa, títulos, datas: não é regra
};
const MIN_BEFORE = /(>=|>|≥|no mínimo|pelo menos|at least|minimum|\bmin\b)\s*$/;
const MAX_BEFORE = /(<=|<|≤|no máximo|at most|maximum|\bmax\b|abaixo de|under|below)\s*$/;
const MIN_AFTER = /^\s*\S*\s*\|?\s*(ou mais|não pode cair|or more|must not fall)/;
const MAX_AFTER = /^\s*\S*\s*\|?\s*(ou menos|não pode crescer|or less|must not grow)/;
const thresholds = (t) => {
  const out = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    const dir =
      MIN_BEFORE.test(before) || MIN_AFTER.test(after)
        ? 'min'
        : MAX_BEFORE.test(before) || MAX_AFTER.test(after)
          ? 'max'
          : null;
    out.push({ n: Number(m[0].replace(',', '.')), dir });
  }
  return out;
};
const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
for (const r of removedRules) {
  const a = addedRules.find((x) => ruleKey(x.text) === ruleKey(r.text));
  if (!a) {
    // remover uma exceção aperta a barra: silencioso
    if (!isException(r.text)) flag('regra-removida', r.file, r.text);
    continue;
  }
  const before = thresholds(r.text);
  const after = thresholds(a.text);
  let verdict = null;
  for (const dir of ['min', 'max', null]) {
    const was = before.filter((x) => x.dir === dir);
    const now = after.filter((x) => x.dir === dir);
    was.forEach((b, i) => {
      const n = now[i];
      if (verdict) return;
      if (!n) verdict = 'limite-removido';
      else if (n.n === b.n) return;
      else if (dir === 'min' ? n.n < b.n : dir === 'max' ? n.n > b.n : true) {
        verdict = dir ? 'limite-afrouxado' : 'limite-alterado';
      }
    });
  }
  if (verdict) flag(verdict, r.file, r.text + '  ->  ' + a.text);
}

// 3. Exceções formais, lidas da seção "Exceções" do CONSTRAINTS.md. Só `assercao-removida` admite
// exceção: a asserção trocada por uma mudança de comportamento aprovada. Cada linha cita os
// arquivos de teste um a um, tem motivo e dono, e vence em no máximo 90 dias a partir de hoje.
// Linha nova inválida é acusada como `nova-excecao`; linha antiga inválida (vencida, por exemplo),
// como `excecao-invalida`. Exceção inválida não cobre nada.
const EXCEPTABLE = new Set(['assercao-removida']);
const MAX_EXCEPTION_DAYS = 90;
const DAY_MS = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10));

function parseException(text) {
  const cells = text
    .trim()
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  const [id = '', rule = '', paths = '', reason = '', owner = '', expires = ''] = cells;
  const files = paths
    .split(',')
    .map((p) => p.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? new Date(expires) : null;
  let problem = null;
  if (cells.length !== 6) problem = 'a linha precisa das 6 colunas';
  else if (!EXCEPTABLE.has(rule)) problem = `a regra "${rule}" não admite exceção`;
  else if (files.length === 0) problem = 'sem caminho';
  else if (!reason || !owner) problem = 'sem motivo ou sem dono';
  else if (!date || Number.isNaN(date.getTime())) problem = 'validade fora do formato AAAA-MM-DD';
  else if (date < today) problem = 'vencida em ' + expires;
  else if ((date - today) / DAY_MS > MAX_EXCEPTION_DAYS) {
    problem = `validade além de ${MAX_EXCEPTION_DAYS} dias`;
  }
  return { id, rule, files, expires, problem, text: text.trim() };
}

const readConstraints = () => {
  try {
    return readFileSync('CONSTRAINTS.md', 'utf8');
  } catch {
    return ''; // sem o arquivo, não há exceção a aplicar
  }
};
const exceptions = readConstraints().split('\n').filter(isException).map(parseException);
const addedExceptionTexts = new Set(addedExceptions.map((e) => e.text.trim()));
for (const e of exceptions) {
  if (!e.problem) continue;
  const rule = addedExceptionTexts.has(e.text) ? 'nova-excecao' : 'excecao-invalida';
  flag(rule, 'CONSTRAINTS.md', `${e.id}: ${e.problem}`);
}
const active = exceptions.filter((e) => !e.problem);

// 2b. Arquivo de teste removido, ou asserção retirada de um teste que continua existindo.
for (const f of deleted) if (isTest(f)) flag('teste-removido', f, 'arquivo removido');
for (const { file, text } of removed) {
  if (isTest(file) && !deleted.includes(file) && /\b(expect|assert|should)\b/.test(text)) {
    flag('assercao-removida', file, text);
  }
}

const covered = new Map(active.map((e) => [e, 0]));
const uncovered = findings.filter((f) => {
  const by = active.find((e) => e.rule === f.rule && e.files.includes(f.file));
  if (by) covered.set(by, covered.get(by) + 1);
  return !by;
});
for (const [e, count] of covered) {
  console.log(
    `floor-guard: exceção ${e.id} (${e.rule}, vence em ${e.expires}) cobre ${count} achado(s)`,
  );
}
findings.splice(0, findings.length, ...uncovered);

if (findings.length === 0) {
  console.log('floor-guard: limpo');
  process.exit(0);
}
console.error('floor-guard: ' + findings.length + ' violação(ões) do piso:');
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
if (findings.some((f) => f.rule === 'regra-removida')) {
  console.error(
    '\nregra-removida também aparece quando o rótulo da regra muda: renomeie em um commit e altere os limites em outro.',
  );
}
if (findings.some((f) => f.rule === 'limite-removido')) {
  console.error(
    '\nlimite-removido também aparece quando um número ganha ou perde o símbolo de direção ("≥ 80%" virando "80%"): compare as duas linhas.',
  );
}
console.error('\nCada item baixa a barra. Corrija o código ou registre uma exceção formal.');
process.exit(1);
