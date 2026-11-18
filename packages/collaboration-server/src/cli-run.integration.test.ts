import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliOptions } from './cli-args.js';
import { startCli, type CliRun } from './cli-run.js';
import { addRectangle } from './test-support/test-client.js';
import { NodeClient } from './ws/test-support/node-client.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'canvash-cli-run-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function optionsOf(data: string, extra: Partial<CliOptions> = {}): CliOptions {
  return { help: false, port: 0, host: '127.0.0.1', data, origins: undefined, ...extra };
}

async function run(options: CliOptions): Promise<{ run: CliRun; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const started = await startCli(options, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  if (!started.ok) throw new Error(started.error.message);
  cleanups.push(() => started.value.stop());
  return { run: started.value, out, err };
}

describe('startCli (a CLI sem o processo)', () => {
  it('sobe, anuncia a URL e a pasta, e avisa que é de desenvolvimento', async () => {
    const data = await tempDir();

    const { run: started, out, err } = await run(optionsOf(data));

    expect(started.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/collab$/);
    expect(started.directory).toBe(data);
    expect(out).toEqual([`canvash-collab-server escutando em ${started.url} (salas em ${data})`]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain('DESENVOLVIMENTO');
  });

  it('guarda a sala em arquivo: o commit confirmado fica na pasta e a próxima subida o devolve', async () => {
    const data = await tempDir();
    const first = await run(optionsOf(data));
    const client = await NodeClient.join(first.run.url, { sessionId: 'a', documentId: 'doc-cli' });
    cleanups.push(async () => client.terminate());
    const receipt = await client.commit(
      'commit-1',
      client.edit((doc) => addRectangle(doc, 'r1')),
      client.roomEpoch(),
    );
    await first.run.stop();

    const second = await run(optionsOf(data));
    const back = await NodeClient.join(second.run.url, { sessionId: 'b', documentId: 'doc-cli' });
    cleanups.push(async () => back.terminate());

    expect(await readdir(join(data, 'doc-cli'))).toContain('room.json');
    expect(Object.keys(back.doc.getMap('shapes').toJSON())).toEqual(['r1']);
    const again = await back.commit(
      'commit-1',
      client.edit((doc) => addRectangle(doc, 'r1')),
      back.roomEpoch(),
    );
    expect(again).toEqual(receipt);
  });

  it('--origin vira allowedOrigins: a de fora recebe 403, a da lista entra', async () => {
    const data = await tempDir();
    const { run: started } = await run(optionsOf(data, { origins: ['http://localhost:5173'] }));

    await expect(
      NodeClient.open(started.url, { sessionId: 'x', origin: 'http://atacante.test' }),
    ).rejects.toThrow('HTTP 403');
    const allowed = await NodeClient.join(started.url, {
      sessionId: 'y',
      origin: 'http://localhost:5173',
    });
    cleanups.push(async () => allowed.terminate());

    expect(allowed.of('welcome')).toHaveLength(1);
  });

  it('stop fecha os clientes com 1001, solta a porta e é idempotente', async () => {
    const data = await tempDir();
    const { run: started } = await run(optionsOf(data));
    const client = await NodeClient.join(started.url, { sessionId: 'a' });

    const first = started.stop();
    const second = started.stop();

    expect(second).toBe(first);
    await first;
    expect((await client.waitClosed()).code).toBe(1001);
    await expect(NodeClient.open(started.url, { sessionId: 'b' })).rejects.toThrow();
  });

  it('porta ocupada: devolve o erro e não deixa nada aberto', async () => {
    const data = await tempDir();
    const { run: started } = await run(optionsOf(data));
    const port = Number(new URL(started.url).port);

    const result = await startCli(optionsOf(data, { port }), {
      out: () => undefined,
      err: () => undefined,
    });

    expect(!result.ok && result.error.code).toBe('CONNECTION_FAILED');
  });
});
