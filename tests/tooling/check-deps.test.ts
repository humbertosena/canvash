import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Cada caso troca o osv-scanner por um script falso, posto à frente no PATH, que imprime uma
// saída fixa e sai com um código escolhido.

const checkDeps = fileURLToPath(new URL('../../scripts/check-deps.mjs', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number | null; stdout: string; stderr: string };

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'canvash-check-deps-'));
  dirs.push(dir);
  return dir;
}

function run(path: string): Run {
  const result = spawnSync(process.execPath, [checkDeps], {
    encoding: 'utf8',
    env: { ...process.env, PATH: path },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Roda o gate com um osv-scanner falso que imprime `stdout` e termina com `ending` (exit ou kill). */
function runWithFake(stdout: string, ending: string): Run {
  const bin = tempDir();
  writeFileSync(join(bin, 'saida.json'), stdout);
  const fake = join(bin, 'osv-scanner');
  writeFileSync(
    fake,
    ['#!/bin/sh', `cat "${join(bin, 'saida.json')}"`, 'echo "erro simulado" >&2', ending, ''].join(
      '\n',
    ),
  );
  chmodSync(fake, 0o755);
  return run(`${bin}${delimiter}${process.env.PATH ?? ''}`);
}

const report = (...groups: Record<string, unknown>[]): string =>
  JSON.stringify({
    results: [
      {
        source: { path: 'pnpm-lock.yaml', type: 'lockfile' },
        packages: [{ package: { name: 'pacote-x', version: '1.2.3', ecosystem: 'npm' }, groups }],
      },
    ],
  });

describe('check-deps', () => {
  it('reprova quando o osv-scanner falha (exit 127) mesmo imprimindo results vazio', () => {
    const result = runWithFake('{"results": []}', 'exit 127');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('código 127');
    expect(result.stderr).toContain('erro simulado');
  });

  it('aprova um scan limpo (exit 0 com results vazio)', () => {
    const result = runWithFake('{"results": []}', 'exit 0');

    expect(result.status).toBe(0);
  });

  it('reprova vulnerabilidade com CVSS 7.5 e lista pacote e IDs', () => {
    const result = runWithFake(
      report({ ids: ['GHSA-aaaa-bbbb-cccc', 'CVE-2026-0001'], max_severity: '7.5' }),
      'exit 1',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'pacote-x@1.2.3: GHSA-aaaa-bbbb-cccc, CVE-2026-0001 (CVSS 7.5)',
    );
  });

  it('aprova quando só há vulnerabilidade moderada (CVSS 6.5)', () => {
    const result = runWithFake(report({ ids: ['GHSA-dddd'], max_severity: '6.5' }), 'exit 1');

    expect(result.status).toBe(0);
  });

  it('reprova vulnerabilidade sem severidade, que conta como alta', () => {
    const ausente = runWithFake(report({ ids: ['GHSA-eeee'] }), 'exit 1');
    const vazia = runWithFake(report({ ids: ['GHSA-ffff'], max_severity: '' }), 'exit 1');

    expect(ausente.status).toBe(1);
    expect(ausente.stderr).toContain('pacote-x@1.2.3: GHSA-eeee');
    expect(vazia.status).toBe(1);
    expect(vazia.stderr).toContain('GHSA-ffff');
  });

  it('reprova severidade só com espaços, que o filtro jq também não aceitava como número', () => {
    const result = runWithFake(report({ ids: ['GHSA-gggg'], max_severity: '  ' }), 'exit 1');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pacote-x@1.2.3: GHSA-gggg');
  });

  it('reprova vulnerabilidade alta mesmo quando o osv-scanner sai com 0', () => {
    const result = runWithFake(report({ ids: ['GHSA-hhhh'], max_severity: '9.8' }), 'exit 0');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHSA-hhhh (CVSS 9.8)');
  });

  it('reprova exit 1 sem nenhuma vulnerabilidade listada, saída incoerente com o código', () => {
    const result = runWithFake('{"results": []}', 'exit 1');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nenhuma vulnerabilidade listada');
  });

  it('reprova quando a saída do osv-scanner não é JSON', () => {
    const result = runWithFake('isto não é JSON', 'exit 0');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('não é JSON válido');
  });

  it('reprova quando o osv-scanner é interrompido por sinal', () => {
    const result = runWithFake('{"results": []}', 'kill -TERM $$');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sinal');
  });

  it('reprova com mensagem clara quando o osv-scanner não está instalado', () => {
    const result = run(tempDir());

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('osv-scanner não encontrado no PATH');
  });
});
