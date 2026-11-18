#!/usr/bin/env node
import { HELP_TEXT, parseCliArgs } from './cli-args.js';
import { startCli } from './cli-run.js';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`canvash-collab-server: ${parsed.error}\n\n${HELP_TEXT}`);
    process.exit(EXIT_USAGE);
  }
  if (parsed.value.help) {
    console.log(HELP_TEXT);
    return;
  }
  const started = await startCli(parsed.value, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  if (!started.ok) {
    console.error(`canvash-collab-server: ${started.error.message}`);
    process.exit(EXIT_FAILURE);
  }
  const stop = (): void => {
    started.value.stop().then(
      () => process.exit(0),
      () => process.exit(EXIT_FAILURE),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(`canvash-collab-server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_FAILURE);
});
