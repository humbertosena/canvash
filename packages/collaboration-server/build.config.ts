import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública. As entradas `./ws` e `./testing` entram com as tarefas que
  // criam o conteúdo delas.
  entries: ['src/index'],
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
        if (warning.code !== 'CIRCULAR_DEPENDENCY') {
          ctx.warnings.add(`Rollup: ${warning.message}`);
        }
      };
    },
  },
});
