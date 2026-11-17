import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitReceipt } from '@canvash/collaboration';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AppendBatch, RoomStorage, StoredCommit, StoredRoom } from './storage.js';
import { createFileRoomStorage, roomDirectoryName } from './storage-file.js';
import { roomStorageContractCases } from './testing/index.js';

const created: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'canvash-room-storage-'));
  created.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function markerUpdate(label: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('meta').set(`contract:${label}`, label);
  return Y.encodeStateAsUpdate(doc);
}

function commitOf(label: string, timestamp = 1_000): StoredCommit {
  return {
    commitId: `commit-${label}`,
    update: markerUpdate(label),
    receipt: { commitId: `commit-${label}`, roomEpoch: 'epoch-1', timestamp, durable: true },
  };
}

function roomOf(label: string, roomEpoch = 'epoch-1'): StoredRoom {
  return {
    provider: 'yjs',
    roomEpoch,
    snapshot: markerUpdate(label),
    log: [],
    receipts: [],
  };
}

function batchOf(...commits: StoredCommit[]): AppendBatch {
  return { commits, document: {} as never, encodeSnapshot: () => new Uint8Array() };
}

async function must<T>(
  result: Promise<
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }
  >,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`falhou: ${JSON.stringify(settled.error)}`);
  return settled.value;
}

async function loadedRoom(storage: RoomStorage, documentId: string): Promise<StoredRoom> {
  const room = await must(storage.load(documentId));
  if (room === null) throw new Error(`a sala ${documentId} não existe`);
  return room;
}

describe('createFileRoomStorage: suíte de contrato', () => {
  const directories = new WeakMap<RoomStorage, string>();
  const cases = roomStorageContractCases(
    async () => {
      const directory = await tempDirectory();
      const storage = createFileRoomStorage({ directory });
      directories.set(storage, directory);
      return storage;
    },
    {
      // Reinício do processo: uma instância nova sobre os mesmos arquivos.
      reopen: (storage) => {
        const directory = directories.get(storage);
        if (directory === undefined) throw new Error('armazenamento desconhecido');
        return createFileRoomStorage({ directory });
      },
    },
  );

  it('a suíte traz os casos do contrato, nenhum pulado', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((contractCase) => contractCase.skipped !== undefined)).toEqual([]);
  });

  for (const contractCase of cases) {
    it(contractCase.name, async () => {
      await contractCase.run();
    });
  }
});

describe('createFileRoomStorage: nome do diretório da sala', () => {
  it('deixa passar o que é seguro e codifica o resto, um byte por vez', () => {
    expect(roomDirectoryName('5f3c-9a_b')).toBe('5f3c-9a_b');
    expect(roomDirectoryName('Desenho 1')).toBe('%44esenho%201');
    expect(roomDirectoryName('../x')).toBe('%2E%2E%2Fx');
    expect(roomDirectoryName('ação')).toBe('a%C3%A7%C3%A3o');
  });

  it('maiúscula e minúscula dão pastas diferentes, mesmo em disco que não as distingue', () => {
    const names = ['Doc', 'doc', 'DOC', 'dOc'].map(roomDirectoryName);

    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(4);
  });

  it('um documentId com ".." ou "/" fica dentro do diretório do armazenamento', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });

    await must(storage.create('../fora', roomOf('base')));

    expect(await readdir(directory)).toEqual(['%2E%2E%2Ffora']);
    expect(await readdir(join(directory, '..')).then((names) => names.includes('fora'))).toBe(
      false,
    );
  });

  it('documentId vazio ou grande demais para um nome de diretório falha com LIMIT_EXCEEDED', async () => {
    const storage = createFileRoomStorage({ directory: await tempDirectory() });

    for (const documentId of ['', 'x'.repeat(201), 'Ç'.repeat(40)]) {
      const created = await storage.create(documentId, roomOf('base'));
      expect(!created.ok && created.error.code).toBe('LIMIT_EXCEEDED');
    }
  });
});

describe('createFileRoomStorage: formato em disco', () => {
  it('grava room.json, snapshot, log e recibos, com o log em [u32][JSON][u32][update]', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    const commit = commitOf('a', 1_234);
    await must(storage.create('doc', roomOf('base', 'epoch-9')));

    await must(storage.append('doc', batchOf(commit)));

    const room = join(directory, 'doc');
    expect((await readdir(room)).sort()).toEqual([
      'log.0.bin',
      'receipts.0.bin',
      'room.json',
      'snapshot.0.bin',
    ]);
    expect(JSON.parse(await readFile(join(room, 'room.json'), 'utf8'))).toEqual({
      format: 1,
      provider: 'yjs',
      roomEpoch: 'epoch-9',
      generation: 0,
    });
    const log = await readFile(join(room, 'log.0.bin'));
    const headerLength = log.readUInt32BE(0);
    expect(JSON.parse(log.subarray(4, 4 + headerLength).toString('utf8'))).toEqual({
      commitId: 'commit-a',
      receipt: commit.receipt,
    });
    const updateLength = log.readUInt32BE(4 + headerLength);
    expect(updateLength).toBe(commit.update.byteLength);
    expect([...log.subarray(8 + headerLength)]).toEqual([...commit.update]);
    expect((await readFile(join(room, 'receipts.0.bin'))).byteLength).toBe(0);
  });

  it('compact grava a geração seguinte e não deixa arquivo da anterior', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    await must(storage.append('doc', batchOf(commitOf('a'), commitOf('b'))));

    await must(storage.compact('doc', markerUpdate('tudo'), 'commit-a'));

    expect((await readdir(join(directory, 'doc'))).sort()).toEqual([
      'log.1.bin',
      'receipts.1.bin',
      'room.json',
      'snapshot.1.bin',
    ]);
    const back = await loadedRoom(storage, 'doc');
    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-b']);
    expect(back.receipts.map((receipt) => receipt.commitId)).toEqual(['commit-a']);
  });

  it('reset troca a epoch e a geração, e o append seguinte vai para o log novo', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    await must(storage.append('doc', batchOf(commitOf('a'))));

    await must(storage.reset('doc', roomOf('novo', 'epoch-2')));
    await must(storage.append('doc', batchOf(commitOf('b'))));

    const back = await loadedRoom(storage, 'doc');
    expect(back.roomEpoch).toBe('epoch-2');
    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-b']);
    expect(await readdir(join(directory, 'doc'))).toContain('log.1.bin');
  });
});

describe('createFileRoomStorage: queda durante a escrita do log (US-S.7)', () => {
  async function roomWithThreeCommits(): Promise<{
    readonly directory: string;
    readonly log: string;
    readonly sizes: readonly number[];
  }> {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    const log = join(directory, 'doc', 'log.0.bin');
    const sizes: number[] = [0];
    for (const label of ['a', 'b', 'c']) {
      await must(storage.append('doc', batchOf(commitOf(label))));
      sizes.push((await stat(log)).size);
    }
    return { directory, log, sizes };
  }

  it('o último registro cortado em qualquer byte é descartado e o arquivo volta ao último inteiro', async () => {
    const { directory, log, sizes } = await roomWithThreeCommits();
    const full = await readFile(log);
    const [, afterA = 0, afterB = 0, afterC = 0] = sizes;
    expect(afterC).toBe(full.byteLength);

    for (let cut = afterB; cut < afterC; cut += 1) {
      const copy = await tempDirectory();
      await cp(join(directory, 'doc'), join(copy, 'doc'), { recursive: true });
      await truncate(join(copy, 'doc', 'log.0.bin'), cut);

      const back = await loadedRoom(createFileRoomStorage({ directory: copy }), 'doc');

      expect(
        back.log.map((commit) => commit.commitId),
        `corte em ${cut}`,
      ).toEqual(['commit-a', 'commit-b']);
      expect((await stat(join(copy, 'doc', 'log.0.bin'))).size, `corte em ${cut}`).toBe(afterB);
    }
    expect(afterA).toBeGreaterThan(0);
  });

  it('o registro seguinte à carga cortada é gravado depois do último inteiro e lê de volta', async () => {
    const { directory, log, sizes } = await roomWithThreeCommits();
    const afterB = sizes[2] ?? 0;
    await truncate(log, afterB + 3);
    const storage = createFileRoomStorage({ directory });
    await loadedRoom(storage, 'doc');

    await must(storage.append('doc', batchOf(commitOf('d'))));

    const back = await loadedRoom(createFileRoomStorage({ directory }), 'doc');
    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-a', 'commit-b', 'commit-d']);
  });

  it('um lote cortado no meio mantém os registros inteiros dele', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    const log = join(directory, 'doc', 'log.0.bin');
    await must(storage.append('doc', batchOf(commitOf('a'))));
    const afterFirst = (await stat(log)).size;
    await must(storage.append('doc', batchOf(commitOf('b'), commitOf('c'), commitOf('d'))));
    const full = (await stat(log)).size;
    // Corta no meio do terceiro registro do lote (o `commit-c`... e o `commit-d` some inteiro).
    const batchBytes = full - afterFirst;
    await truncate(log, afterFirst + Math.floor((batchBytes * 2) / 3) - 5);

    const back = await loadedRoom(createFileRoomStorage({ directory }), 'doc');

    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-a', 'commit-b']);
  });

  it('um log que acaba logo depois do tamanho do cabeçalho, ou no meio dele, também é cortado', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    await must(storage.append('doc', batchOf(commitOf('a'))));
    const log = join(directory, 'doc', 'log.0.bin');
    const full = await readFile(log);
    const headerEnd = 4 + full.readUInt32BE(0);

    for (const cut of [1, 3, 4, 5, headerEnd, headerEnd + 2]) {
      await writeFile(log, full.subarray(0, cut));

      const back = await loadedRoom(createFileRoomStorage({ directory }), 'doc');

      expect(back.log, `corte em ${cut}`).toEqual([]);
      expect((await stat(log)).size, `corte em ${cut}`).toBe(0);
    }
  });
});

describe('createFileRoomStorage: arquivos que não se leem', () => {
  async function roomWithThreeCommits(): Promise<{ directory: string; log: string }> {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    await must(storage.append('doc', batchOf(commitOf('a'), commitOf('b'), commitOf('c'))));
    return { directory, log: join(directory, 'doc', 'log.0.bin') };
  }

  it('registro do meio com cabeçalho corrompido: load falha com STORAGE_UNAVAILABLE e o arquivo fica intacto', async () => {
    const { directory, log } = await roomWithThreeCommits();
    const bytes = await readFile(log);
    const secondStart =
      4 + bytes.readUInt32BE(0) + 4 + bytes.readUInt32BE(4 + bytes.readUInt32BE(0));
    bytes[secondStart + 4] = 0x58; // o `{` do JSON do segundo registro vira `X`
    await writeFile(log, bytes);

    const result = await createFileRoomStorage({ directory }).load('doc');

    expect(!result.ok && result.error.code).toBe('STORAGE_UNAVAILABLE');
    expect((await readFile(log)).equals(bytes)).toBe(true);
  });

  it('cabeçalho que é JSON mas não é um commit também recusa a sala', async () => {
    const { directory, log } = await roomWithThreeCommits();
    const header = Buffer.from(JSON.stringify({ commitId: 7 }), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(header.byteLength);
    const update = Buffer.alloc(4);
    await writeFile(log, Buffer.concat([head, header, update]));

    const result = await createFileRoomStorage({ directory }).load('doc');

    expect(!result.ok && result.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('room.json num formato desconhecido ou com JSON inválido recusa a sala', async () => {
    const { directory } = await roomWithThreeCommits();
    const meta = join(directory, 'doc', 'room.json');

    for (const content of [
      JSON.stringify({ format: 2, provider: 'yjs', roomEpoch: 'e', generation: 0 }),
      JSON.stringify({ format: 1, provider: 'yjs', roomEpoch: 'e', generation: -1 }),
      JSON.stringify({ format: 1, provider: 'yjs', generation: 0 }),
      'isto não é JSON',
      'null',
    ]) {
      await writeFile(meta, content);

      const result = await createFileRoomStorage({ directory }).load('doc');

      expect(!result.ok && result.error.code, content).toBe('STORAGE_UNAVAILABLE');
    }
  });

  it('arquivo de dados que sumiu ou recibos truncados recusam a sala', async () => {
    const { directory } = await roomWithThreeCommits();
    const room = join(directory, 'doc');
    await rm(join(room, 'snapshot.0.bin'));

    const missingSnapshot = await createFileRoomStorage({ directory }).load('doc');

    expect(!missingSnapshot.ok && missingSnapshot.error.code).toBe('STORAGE_UNAVAILABLE');

    await writeFile(join(room, 'snapshot.0.bin'), markerUpdate('base'));
    await writeFile(join(room, 'receipts.0.bin'), Buffer.from([0, 0, 0, 9, 1]));
    const truncated = await createFileRoomStorage({ directory }).load('doc');
    expect(!truncated.ok && truncated.error.code).toBe('STORAGE_UNAVAILABLE');

    const bad = Buffer.from('{"commitId":1}', 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(bad.byteLength);
    await writeFile(join(room, 'receipts.0.bin'), Buffer.concat([head, bad]));
    const invalid = await createFileRoomStorage({ directory }).load('doc');
    expect(!invalid.ok && invalid.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('uma falha de disco na gravação vira STORAGE_UNAVAILABLE com o código do sistema', async () => {
    const { directory, log } = await roomWithThreeCommits();
    await rm(log);
    await mkdir(log); // o log passa a ser uma pasta: abrir para anexar falha

    const result = await createFileRoomStorage({ directory }).append('doc', batchOf(commitOf('d')));

    expect(!result.ok && result.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(!result.ok && JSON.stringify(result.error.details)).toContain('EISDIR');
  });

  it('recibo compactado de um commit que ainda está no log não aparece duas vezes', async () => {
    const { directory } = await roomWithThreeCommits();
    const receipt: CommitReceipt = {
      commitId: 'commit-b',
      roomEpoch: 'epoch-1',
      timestamp: 1_000,
      durable: true,
    };
    const other: CommitReceipt = { ...receipt, commitId: 'commit-velho', timestamp: 5 };
    const body = (value: CommitReceipt): Buffer => {
      const json = Buffer.from(JSON.stringify(value), 'utf8');
      const head = Buffer.alloc(4);
      head.writeUInt32BE(json.byteLength);
      return Buffer.concat([head, json]);
    };
    await writeFile(
      join(directory, 'doc', 'receipts.0.bin'),
      Buffer.concat([body(other), body(receipt)]),
    );

    const back = await loadedRoom(createFileRoomStorage({ directory }), 'doc');

    expect(back.receipts.map((entry) => entry.commitId)).toEqual(['commit-velho']);
    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-a', 'commit-b', 'commit-c']);
  });
});

describe('createFileRoomStorage: compactação interrompida (US-S.7)', () => {
  /** A sala antes e depois de uma compactação, para montar o que uma queda deixaria. */
  async function beforeAndAfter(): Promise<{
    readonly before: string;
    readonly after: string;
  }> {
    const base = await tempDirectory();
    const storage = createFileRoomStorage({ directory: base });
    await must(storage.create('doc', roomOf('base')));
    await must(storage.append('doc', batchOf(commitOf('a'), commitOf('b'))));
    const before = await tempDirectory();
    await cp(join(base, 'doc'), join(before, 'doc'), { recursive: true });
    await must(storage.compact('doc', markerUpdate('tudo'), 'commit-b'));
    return { before, after: base };
  }

  async function copyFiles(from: string, to: string, names: readonly string[]): Promise<void> {
    for (const name of names) await cp(join(from, 'doc', name), join(to, 'doc', name));
  }

  it('queda depois de escrever a geração nova e antes de trocar o room.json: vale a anterior inteira', async () => {
    const { before, after } = await beforeAndAfter();
    await copyFiles(after, before, ['snapshot.1.bin', 'log.1.bin', 'receipts.1.bin']);
    await writeFile(join(before, 'doc', 'room.json.tmp'), '{"format":1');

    const back = await loadedRoom(createFileRoomStorage({ directory: before }), 'doc');

    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-a', 'commit-b']);
    expect(back.receipts).toEqual([]);
    expect(back.roomEpoch).toBe('epoch-1');
  });

  it('queda no meio da escrita dos arquivos novos: a geração anterior segue valendo e o próximo compact limpa o resto', async () => {
    const { before, after } = await beforeAndAfter();
    await writeFile(
      join(before, 'doc', 'snapshot.1.bin'),
      (await readFile(join(after, 'doc', 'snapshot.1.bin'))).subarray(0, 3),
    );
    const storage = createFileRoomStorage({ directory: before });

    const back = await loadedRoom(storage, 'doc');
    expect(back.log.map((commit) => commit.commitId)).toEqual(['commit-a', 'commit-b']);

    await must(storage.compact('doc', markerUpdate('tudo'), 'commit-b'));

    expect((await readdir(join(before, 'doc'))).sort()).toEqual([
      'log.1.bin',
      'receipts.1.bin',
      'room.json',
      'snapshot.1.bin',
    ]);
    const done = await loadedRoom(storage, 'doc');
    expect(done.log).toEqual([]);
    expect(done.receipts.map((receipt) => receipt.commitId)).toEqual(['commit-a', 'commit-b']);
  });

  it('queda depois de trocar o room.json e antes de apagar a geração velha: vale a nova inteira', async () => {
    const { before, after } = await beforeAndAfter();
    await copyFiles(after, before, ['snapshot.1.bin', 'log.1.bin', 'receipts.1.bin', 'room.json']);

    const back = await loadedRoom(createFileRoomStorage({ directory: before }), 'doc');

    expect(back.log).toEqual([]);
    expect(back.receipts.map((receipt) => receipt.commitId)).toEqual(['commit-a', 'commit-b']);
    expect(await readdir(join(before, 'doc'))).toContain('log.0.bin');
  });
});

describe('createFileRoomStorage: concorrência e criação', () => {
  it('appends simultâneos na mesma sala entram todos, na ordem das chamadas', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));
    const labels = Array.from({ length: 25 }, (_, index) => `n${String(index).padStart(2, '0')}`);

    const results = await Promise.all(
      labels.map((label) => storage.append('doc', batchOf(commitOf(label)))),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const back = await loadedRoom(storage, 'doc');
    expect(back.log.map((commit) => commit.commitId)).toEqual(
      labels.map((label) => `commit-${label}`),
    );
  });

  it('dois create ao mesmo tempo: um grava e o outro recebe CONFLICT', async () => {
    const storage = createFileRoomStorage({ directory: await tempDirectory() });
    const one = roomOf('um');
    const two = roomOf('dois');

    const [first, second] = await Promise.all([
      storage.create('doc', one),
      storage.create('doc', two),
    ]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const loser = first.ok ? second : first;
    expect(!loser.ok && loser.error.code).toBe('CONFLICT');
    const back = await loadedRoom(storage, 'doc');
    expect(back.snapshot).toEqual(first.ok ? one.snapshot : two.snapshot);
  });

  it('create não deixa diretório temporário para trás, nem quando a sala já existe', async () => {
    const directory = await tempDirectory();
    const storage = createFileRoomStorage({ directory });
    await must(storage.create('doc', roomOf('base')));

    await storage.create('doc', roomOf('outra'));

    expect(await readdir(directory)).toEqual(['doc']);
  });

  it('um create que não consegue gravar devolve STORAGE_UNAVAILABLE e não deixa a sala', async () => {
    const directory = await tempDirectory();
    await writeFile(join(directory, 'arquivo'), 'não é pasta');
    const storage = createFileRoomStorage({ directory: join(directory, 'arquivo') });

    const result = await storage.create('doc', roomOf('base'));

    expect(!result.ok && result.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('o diretório do armazenamento é criado na primeira sala', async () => {
    const base = await tempDirectory();
    const storage = createFileRoomStorage({ directory: join(base, 'a', 'b') });

    const missing = await storage.load('doc');
    await must(storage.create('doc', roomOf('base')));

    expect(missing.ok && missing.value).toBeNull();
    expect(await readdir(join(base, 'a', 'b'))).toEqual(['doc']);
  });
});
