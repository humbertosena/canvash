import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública.
  entries: [
    'src/index',
    { input: 'src/ws/index', name: 'ws' },
    { input: 'src/cli', name: 'cli' },
    { input: 'src/testing/index', name: 'testing' },
  ],
  declaration: 'node16',
  sourcemap: true,
  clean: true,
  failOnWarn: true,
  rollup: {
    emitCJS: true,
    esbuild: { target: 'es2022' },
  },
  hooks: {
    'rollup:options'(ctx, options) {
      options.onwarn = (warning) => {
        // A CLI não exporta nada: o bundle de tipos dela sai vazio, e é descartado abaixo.
        const emptyCli = warning.code === 'EMPTY_BUNDLE' && warning.names?.includes('cli') === true;
        if (warning.code !== 'CIRCULAR_DEPENDENCY' && !emptyCli) {
          ctx.warnings.add(`Rollup: ${warning.message}`);
        }
      };
    },
    // O `bin` é só ESM: o resto que o unbuild gera para a CLI (CJS e tipos vazios) não é publicado.
    'build:done'(ctx) {
      for (const name of ['cli.cjs', 'cli.cjs.map', 'cli.d.mts', 'cli.d.cts']) {
        rmSync(join(ctx.options.outDir, name), { force: true });
      }
    },
  },
});
