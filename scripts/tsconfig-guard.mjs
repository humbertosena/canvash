#!/usr/bin/env node
// tsconfig-guard.mjs — confere o que o `tsc -b` não confere: que nada fica fora dele.
// O `tsc -b` só verifica os projetos que o tsconfig.json da raiz referencia, com as opções que
// cada um declara. Sem esta conferência, um pacote novo, um arquivo fora dos `include` ou um
// projeto com o modo strict desligado passariam pelo `pnpm typecheck` sem nenhum erro.
// Uso: node scripts/tsconfig-guard.mjs   (a partir da raiz do workspace)
// Saída: 0 tudo coberto; 1 falta projeto ou registro, há arquivo fora de todo projeto ou
// projeto fora do modo strict ou sem as opções de REQUIRED_ON.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT_TSCONFIG = 'tsconfig.json';
// Projetos que todo pacote tem: o código (sem os testes) e os testes.
const PACKAGE_PROJECTS = ['tsconfig.json', 'tsconfig.test.json'];
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.claude',
  'test-results',
  'playwright-report',
]);
// `strict` liga todas estas, mas cada uma pode ser desligada à parte.
const STRICT_FAMILY = [
  'strict',
  'alwaysStrict',
  'noImplicitAny',
  'noImplicitThis',
  'strictBindCallApply',
  'strictBuiltinIteratorReturn',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
];
// Fora do `strict`, e desligada por padrão: o projeto precisa ligá-la, e não só não a desligar.
const REQUIRED_ON = ['noUncheckedIndexedAccess'];

const relative = (file) => path.relative('.', file);
const bail = (problems) => {
  console.error('tsconfig-guard: o `pnpm typecheck` não cobre tudo');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
};

const root = ts.readConfigFile(ROOT_TSCONFIG, ts.sys.readFile);
if (root.error) {
  const reason = ts.flattenDiagnosticMessageText(root.error.messageText, ' ');
  bail([`não foi possível ler ${ROOT_TSCONFIG} (${reason})`]);
}

// Percorre as references a partir da raiz, como o `tsc -b`, guardando de cada projeto as opções
// efetivas (com o `extends` resolvido) e os arquivos que ele inclui. Projeto ausente ou
// ilegível não cobre nada; quem acusa o erro dele é o próprio `tsc -b`.
const projects = new Map();
const visit = (configFile) => {
  const file = path.resolve(configFile);
  if (projects.has(file)) return;
  const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  projects.set(file, parsed);
  for (const reference of parsed?.projectReferences ?? []) {
    visit(ts.resolveProjectReferencePath(reference));
  }
};
visit(ROOT_TSCONFIG);

const problems = [];

// 1. Todo pacote tem os dois projetos, e os dois estão ao alcance da raiz.
const packageDirs = existsSync('packages')
  ? readdirSync('packages', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join('packages', entry.name))
  : [];
for (const dir of packageDirs) {
  if (!existsSync(path.join(dir, 'package.json'))) {
    // Trocar de branch deixa para trás o que o git ignora de um pacote que não existe mais.
    const leftover = readdirSync(dir).every((name) => SKIPPED_DIRS.has(name));
    if (!leftover) problems.push(`falta ${path.join(dir, 'package.json')}`);
    continue;
  }
  for (const project of PACKAGE_PROJECTS.map((file) => path.join(dir, file))) {
    if (!existsSync(project)) problems.push(`falta ${project}`);
    else if (!projects.has(path.resolve(project))) {
      problems.push(`${project} não está em "references" do ${ROOT_TSCONFIG} da raiz`);
    }
  }
}

// Toda dependência workspace: de um pacote aparece nas references dos seus dois tsconfig (questão 13).
// Sem isto, o typecheck do consumidor compila o fonte do fornecedor com as opções do consumidor
// (que no renderer incluem DOM), e o fornecedor deixa de ser compilado sem DOM.
const packageManifests = new Map();
for (const dir of packageDirs) {
  const manifestFile = path.join(dir, 'package.json');
  if (existsSync(manifestFile)) {
    let manifest;
    try {
      manifest = JSON.parse(ts.sys.readFile(manifestFile) ?? '{}');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      bail([`não foi possível ler ${manifestFile} (${reason})`]);
    }
    if (manifest && typeof manifest === 'object' && typeof manifest.name === 'string') {
      packageManifests.set(manifest.name, { dir, manifest });
    }
  }
}
for (const { dir, manifest } of packageManifests.values()) {
  const workspaceDeps = new Set();
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [dep, version] of Object.entries(manifest[section] ?? {})) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        workspaceDeps.add(dep);
      }
    }
  }
  for (const dep of workspaceDeps) {
    const target = packageManifests.get(dep);
    if (!target) {
      problems.push(
        `${path.join(dir, 'package.json')} declara dependência "${dep}" como workspace, mas o pacote não existe`,
      );
      continue;
    }
    const targetTsconfig = path.resolve(path.join(target.dir, 'tsconfig.json'));
    for (const file of PACKAGE_PROJECTS) {
      const project = path.join(dir, file);
      const parsed = projects.get(path.resolve(project));
      if (!parsed) continue;
      const refs = new Set(
        (parsed.projectReferences ?? []).map((ref) =>
          path.resolve(ts.resolveProjectReferencePath(ref)),
        ),
      );
      if (!refs.has(targetTsconfig)) {
        problems.push(
          `${project} não referencia ${relative(targetTsconfig)} (dependência de ${dep})`,
        );
      }
    }
  }
}

// 2. Nenhum projeto desliga o modo strict, e todo projeto com arquivos liga as opções de REQUIRED_ON.
const covered = new Set();
for (const [file, parsed] of projects) {
  if (!parsed) continue;
  for (const name of parsed.fileNames) covered.add(path.resolve(name));
  for (const flag of STRICT_FAMILY) {
    if (parsed.options[flag] === false) {
      problems.push(`${relative(file)} desliga o modo strict ("${flag}": false)`);
    }
  }
  // Projeto de solução (só `references`, sem arquivos) não compila nada: não precisa das opções.
  if (parsed.fileNames.length === 0) continue;
  for (const flag of REQUIRED_ON) {
    if (parsed.options[flag] !== true) {
      problems.push(`${relative(file)} não liga "${flag}"`);
    }
  }
}

// 3. Todo arquivo TypeScript pertence a algum projeto. Um arquivo fora de todos eles
// (examples/, um diretório novo, uma extensão que o `include` não lista) não é verificado.
const sourcesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourcesIn(file);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [file] : [];
  });
for (const file of sourcesIn('.')) {
  if (!covered.has(path.resolve(file))) {
    problems.push(`${file} não pertence a nenhum projeto referenciado pelo ${ROOT_TSCONFIG}`);
  }
}

if (problems.length > 0) bail(problems);
