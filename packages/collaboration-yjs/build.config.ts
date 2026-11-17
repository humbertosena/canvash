import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  // Um bundle por entrada pública: a principal e a suíte de contrato do transporte, que o host
  // importa só nos testes dele.
  entries: ['src/index', { input: 'src/testing/index', name: 'testing' }],
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
