import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública.
  entries: [
    'src/index',
    { input: 'src/ws/index', name: 'ws' },
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
        if (warning.code !== 'CIRCULAR_DEPENDENCY') {
          ctx.warnings.add(`Rollup: ${warning.message}`);
        }
      };
    },
  },
});
