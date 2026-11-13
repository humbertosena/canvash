#!/usr/bin/env node
// legacy-names-guard.mjs — proíbe os nomes antigos listados em scripts/legacy-names.json.
// Uso: node scripts/legacy-names-guard.mjs
// Saída: 0 limpo, 1 nome antigo encontrado, 2 o guard não conseguiu rodar.
// O script lê os nomes do JSON e não contém nenhum deles: quem precisa citar um nome antigo
// (os testes, por exemplo) o lê do JSON ou o monta por concatenação.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LIST = 'scripts/legacy-names.json';
const GUARDS = new Set(['pending', 'enforced', 'type-context', 'reserved']);

const bail = (msg) => {
  console.error('legacy-names-guard: ' + msg);
  process.exit(2);
};

// `git grep` sai com 1 quando nada casa, que aqui é o caso limpo.
const git = (args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (e.status === 1 && typeof e.stdout === 'string') return e.stdout;
    return null;
  }
};

const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('fora de um repositório git');
process.chdir(top);

let entries;
try {
  entries = JSON.parse(readFileSync(LIST, 'utf8')).entries;
} catch {
  bail(`não foi possível ler ${LIST}`);
}
if (!Array.isArray(entries)) bail(`${LIST} precisa de uma lista "entries"`);
for (const e of entries) {
  if (typeof e.old !== 'string' || typeof e.new !== 'string' || !GUARDS.has(e.guard)) {
    bail(`entrada inválida em ${LIST}: ${JSON.stringify(e)}`);
  }
}

const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
/** As posições em que `token` aparece como palavra inteira, como o `-w` do git grep decide. */
const wordPositions = (text, token) => {
  const out = [];
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + token.length])) out.push(at);
  }
  return out;
};

// Uma posição de tipo é uma das formas em que um nome de tipo aparece no TypeScript: anotação,
// argumento genérico, união, interseção, `as`, `extends`, `implements`, declaração e import.
// Texto entre aspas (título, rótulo) nunca é posição de tipo.
const isTypePosition = (text, at, token) => {
  const before = text.slice(0, at);
  const after = text.slice(at + token.length);
  return (
    /(:|<|\||&)\s*$/.test(before) ||
    /\b(as|extends|implements|type|interface)\s+$/.test(before) ||
    /^\s*(\[\]|\||&)/.test(after) ||
    /\bimport\b[^'"]*\{[^}]*$/.test(before) ||
    (/^\s*(type\s+)?$/.test(before) && /^\s*,?\s*$/.test(after))
  );
};

const guardedPaths = ['--', '.', `:!${LIST}`];
const grep = (tokens) => {
  if (tokens.length === 0) return [];
  const args = ['grep', '--untracked', '-n', '-I', '-F', '-w'];
  for (const t of tokens) args.push('-e', t);
  const out = git([...args, ...guardedPaths]);
  if (out === null) bail('o git grep falhou');
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*?):(\d+):(.*)$/.exec(line);
      return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
    })
    .filter(Boolean);
};

const findings = [];
const report = (hit, entry) =>
  findings.push(`${hit.file}:${hit.line}: ${entry.old} → ${entry.new}`);

const enforced = entries.filter((e) => e.guard === 'enforced');
const typed = entries.filter((e) => e.guard === 'type-context');

// Em `a-b` e `a-b-c`, o nome mais longo vale sozinho: o curto é o mesmo trecho.
const longestOnly = (hit, candidates) => {
  const spans = [];
  for (const e of candidates) {
    for (const at of wordPositions(hit.text, e.old)) spans.push({ e, at, end: at + e.old.length });
  }
  return spans.filter(
    (a) =>
      !spans.some((b) => b !== a && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at),
  );
};

for (const hit of grep(enforced.map((e) => e.old))) {
  for (const { e } of longestOnly(hit, enforced)) report(hit, e);
}
for (const hit of grep(typed.map((e) => e.old))) {
  for (const e of typed) {
    if (wordPositions(hit.text, e.old).some((at) => isTypePosition(hit.text, at, e.old))) {
      report(hit, e);
    }
  }
}

if (findings.length === 0) {
  console.log('check:names: limpo');
  process.exit(0);
}
console.error(`check:names: ${findings.length} nome(s) antigo(s):`);
for (const f of findings) console.error('  ' + f);
console.error('\nTroque pelo nome novo. A tabela de mapeamento fica em ' + LIST + '.');
process.exit(1);
