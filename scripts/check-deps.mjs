#!/usr/bin/env node
// check-deps.mjs — gate de dependências: reprova vulnerabilidade com CVSS ≥ 7.0 (alta ou crítica).
// Roda `osv-scanner scan source -r . --format json` na raiz do repositório; severidade
// desconhecida conta como alta. O gate depende do código de saída do osv-scanner: ele imprime
// `{"results": []}` também quando a consulta à api.osv.dev falha, então JSON vazio não prova nada.
// Uso: node scripts/check-deps.mjs
// Saída: 0 sem vulnerabilidade alta ou crítica; 1 há alguma; 2 o osv-scanner não concluiu a análise
// ou devolveu saída não confiável (código inesperado, sinal, JSON inválido ou incoerente).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const HIGH = 7;

class Bail extends Error {}

const bail = (msg, detail = '') => {
  throw new Bail(detail.trim() === '' ? msg : `${msg}\n${detail.trimEnd()}`);
};

/** Severidade ausente, vazia, só com espaços ou ilegível conta como alta. */
const isHigh = (severity) => {
  if (typeof severity === 'number') return Number.isNaN(severity) || severity >= HIGH;
  if (typeof severity !== 'string' || severity.trim() === '') return true;
  const score = Number(severity.trim());
  return Number.isNaN(score) || score >= HIGH;
};

/** Percorre results[].packages[].groups[] como scripts/osv-high.jq fazia. */
const scanGroups = (report) => {
  const groups = [];
  const results = Array.isArray(report?.results) ? report.results : [];
  for (const result of results) {
    const packages = Array.isArray(result?.packages) ? result.packages : [];
    for (const entry of packages) {
      for (const group of Array.isArray(entry?.groups) ? entry.groups : []) {
        groups.push({ pkg: entry?.package, group });
      }
    }
  }
  return groups;
};

const describeFinding = ({ pkg, group }) => {
  const severity = group?.max_severity;
  const ids = Array.isArray(group?.ids) ? group.ids.join(', ') : '';
  const cvss = typeof severity === 'string' && severity.trim() !== '' ? severity : 'desconhecido';
  return `${pkg?.name}@${pkg?.version}: ${ids} (CVSS ${cvss})`;
};

const run = () => {
  const scan = spawnSync('osv-scanner', ['scan', 'source', '-r', '.', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (scan.error) {
    const reason =
      scan.error.code === 'ENOENT'
        ? 'osv-scanner não encontrado no PATH; instale-o (Homebrew: brew install osv-scanner).'
        : `não foi possível executar o osv-scanner (${scan.error.message}).`;
    bail(reason, scan.stderr ?? '');
  }
  if (scan.status === null) {
    bail(
      `osv-scanner interrompido pelo sinal ${scan.signal}; a análise não terminou.`,
      scan.stderr,
    );
  }
  // 0: nada encontrado; 1: vulnerabilidades listadas. Os demais (127 erro geral ou de rede,
  // 128 nenhum pacote encontrado) significam que não houve análise confiável.
  if (scan.status !== 0 && scan.status !== 1) {
    bail(
      `osv-scanner saiu com código ${scan.status}; a análise não foi concluída (rede, extração ou ` +
        'lockfile ausente). Sem resultado confiável, o gate reprova.',
      scan.stderr,
    );
  }

  let report;
  try {
    report = JSON.parse(scan.stdout);
  } catch (error) {
    bail(`a saída do osv-scanner não é JSON válido (${error.message}).`, scan.stderr);
  }
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    bail('a saída do osv-scanner não é um objeto JSON.', scan.stderr);
  }

  const groups = scanGroups(report);
  // Exit 1 promete vulnerabilidades no JSON; sem nenhuma, a saída não é confiável.
  if (scan.status === 1 && groups.length === 0) {
    bail(
      'osv-scanner saiu com código 1, mas nenhuma vulnerabilidade listada no JSON; saída incoerente.',
      scan.stderr,
    );
  }

  const findings = groups.filter(({ group }) => isHigh(group?.max_severity)).map(describeFinding);
  if (findings.length > 0) {
    console.error(`check:deps: ${findings.length} vulnerabilidade(s) alta(s) ou crítica(s):`);
    for (const finding of findings) console.error(`  ${finding}`);
    return 1;
  }
  console.log('check:deps: nenhuma vulnerabilidade alta ou crítica');
  return 0;
};

// process.exitCode, e não process.exit, para não truncar stderr longo em pipe assíncrono (macOS).
try {
  process.exitCode = run();
} catch (error) {
  // Erro inesperado também é 2: o código 1 fica reservado para "há vulnerabilidade alta".
  console.error(`check:deps: ${error instanceof Bail ? error.message : (error?.stack ?? error)}`);
  process.exitCode = 2;
}
