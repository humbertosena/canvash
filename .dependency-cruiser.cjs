// Fronteiras entre módulos: cada módulo só depende dos módulos listados em `dependsOn`.

// Namespace provisório: atualize aqui se ele mudar.
const SCOPE = '@canvash';

const MODULES = {
  core: { packages: ['core'], dependsOn: [] },
  'renderer-canvas2d': { packages: ['renderer-canvas2d'], dependsOn: ['core'] },
  interaction: { packages: ['interaction'], dependsOn: ['core'] },
  'web-components': {
    packages: ['web-components'],
    dependsOn: ['core', 'renderer-canvas2d', 'interaction'],
  },
  'framework-adapters': { packages: ['react', 'vue'], dependsOn: ['core', 'web-components'] },
  'persistence-export': {
    packages: ['persistence', 'export'],
    dependsOn: ['core', 'renderer-canvas2d'],
  },
  collaboration: { packages: ['collaboration', 'collaboration-yjs'], dependsOn: ['core'] },
  // Só Node: nenhum pacote de navegador o importa, porque nenhum o lista em `dependsOn`.
  'collaboration-server': {
    packages: ['collaboration-server'],
    dependsOn: ['core', 'collaboration'],
  },
};

// Cada exemplo é um projeto isolado, com servidor, porta e código próprios.
const EXAMPLES = ['vanilla', 'react', 'vue', 'web-components'];

const group = (names) => `(${names.join('|')})`;
const packagesOf = (id) => MODULES[id].packages;
const allPackages = Object.values(MODULES).flatMap((m) => m.packages);

// Um import entre pacotes aparece como caminho resolvido (packages/x/...), porque o `exports`
// de cada pacote aponta para o fonte, ou como o próprio nome do pacote (@canvash/x) quando não
// resolve, que é o caso da dependência não declarada.
const fromPackages = (names) => `^packages/${group(names)}/`;
const toPackages = (names) => [`^packages/${group(names)}/`, `^${SCOPE}/${group(names)}(/|$)`];
const toLibrary = (names) => `(^|/node_modules/)${group(names)}(/|$)`;

const moduleBoundaries = Object.entries(MODULES).map(([id, { packages, dependsOn }]) => {
  const allowed = [...packages, ...dependsOn.flatMap(packagesOf)];
  return {
    name: `fronteira-${id}`,
    comment: `${id} só depende de: ${dependsOn.join(', ') || 'nenhum módulo'}.`,
    severity: 'error',
    from: { path: fromPackages(packages) },
    to: { path: toPackages(allPackages.filter((name) => !allowed.includes(name))) },
  };
});

const exampleBoundaries = EXAMPLES.map((name) => ({
  name: `exemplo-${name}-isolado`,
  comment: `O exemplo ${name} não importa código de outro exemplo.`,
  severity: 'error',
  from: { path: `^examples/${name}/` },
  to: { path: `^examples/(?!${name}/)` },
}));

const libraryOwners = [
  ['lit', ['web-components'], ['lit', 'lit-html', 'lit-element', '@lit/[^/]+']],
  ['react', ['react'], ['react', 'react-dom']],
  ['vue', ['vue'], ['vue', '@vue/[^/]+']],
  [
    'yjs',
    ['collaboration-yjs', 'collaboration-server'],
    ['yjs', 'y-websocket', 'y-indexeddb', 'y-protocols'],
  ],
  ['ws', ['collaboration-server'], ['ws']],
].map(([library, owners, names]) => ({
  name: `${library}-so-no-seu-pacote`,
  comment: `${library} só pode ser importado por: ${owners.join(', ')}.`,
  severity: 'error',
  from: { path: '^packages/', pathNot: fromPackages(owners) },
  to: { path: toLibrary(names) },
}));

const wrapperPairs = [
  ['react', 'vue'],
  ['vue', 'react'],
].map(([from, to]) => ({
  name: `${from}-sem-${to}`,
  comment: 'O wrapper React não traz Vue e vice-versa.',
  severity: 'error',
  from: { path: fromPackages([from]) },
  to: { path: toPackages([to]) },
}));

module.exports = {
  forbidden: [
    ...moduleBoundaries,
    ...exampleBoundaries,
    ...libraryOwners,
    ...wrapperPairs,
    {
      name: 'servidor-so-em-node',
      comment:
        'O servidor de colaboração é só Node: os exemplos, que rodam no navegador, não o importam.',
      severity: 'error',
      from: { path: '^examples/' },
      to: { path: toPackages(['collaboration-server']) },
    },
    {
      name: 'nucleo-do-servidor-sem-ws',
      comment:
        'O núcleo do servidor é independente do meio: `ws` só entra pelo adaptador (src/ws) e pela CLI.',
      severity: 'error',
      from: {
        path: '^packages/collaboration-server/src/',
        pathNot: '^packages/collaboration-server/src/(ws/|cli\\.ts$)',
      },
      to: { path: toLibrary(['ws']) },
    },
    {
      name: 'sessao-so-conhece-a-interface-de-transporte',
      comment:
        'A sessão Yjs fala com a rede só por CollaborationTransport: não importa o hub em memória nem o emulador de servidor.',
      severity: 'error',
      from: { path: '^packages/collaboration-yjs/src/session\\.ts$' },
      to: { path: '^packages/collaboration-yjs/src/(transport|server-emulator)\\.ts$' },
    },
    {
      name: 'pacote-fora-do-mapa',
      comment: 'Pacote novo entra primeiro em MODULES acima.',
      severity: 'error',
      from: { path: '^packages/', pathNot: fromPackages(allPackages) },
      to: {},
    },
    {
      name: 'sem-ciclos',
      comment: 'O grafo de módulos é acíclico.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // O dist não é percorrido, mas continua no grafo: excluí-lo apagaria a aresta de um import
    // que chegasse a ele, e a fronteira deixaria de ser vista.
    doNotFollow: { path: ['node_modules', '(^|/)dist/'] },
    exclude: { path: '(^|/)coverage/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
