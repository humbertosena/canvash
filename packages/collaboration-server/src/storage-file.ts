import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CommitReceipt,
  type Result,
} from '@canvash/collaboration';
import type {
  AppendBatch,
  CompactOptions,
  RoomStorage,
  StoredCommit,
  StoredRoom,
} from './storage.js';

/** Versão do formato em disco. */
const FORMAT = 1;
const MAX_DIRECTORY_NAME_LENGTH = 200;
const META_FILE = 'room.json';

interface RoomMeta {
  readonly format: typeof FORMAT;
  readonly provider: string;
  readonly roomEpoch: string;
  /** Geração dos arquivos de dados. Só `room.json` aponta para a geração viva. */
  readonly generation: number;
}

interface RoomContents {
  readonly snapshot: Uint8Array;
  readonly log: readonly StoredCommit[];
  readonly receipts: readonly CommitReceipt[];
}

/** Falha esperada de uma operação, já no formato do erro público. */
class StorageFailure extends Error {
  constructor(readonly failure: CollaborationError) {
    super(failure.message);
  }
}

function fail(code: CollaborationError['code'], message: string, details?: unknown): never {
  throw new StorageFailure(createCollaborationError(code, message, details));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function unavailable(what: string, cause: unknown): CollaborationError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return createCollaborationError('STORAGE_UNAVAILABLE', `${what}: ${reason}`, {
    cause: errorCode(cause) ?? reason,
  });
}

/**
 * Nome do diretório da sala. Só `a-z`, `0-9`, `_` e `-` passam; o resto vira `%XX` (um byte UTF-8
 * por vez, em maiúsculas). A troca é injetiva, não deixa o `documentId` sair do diretório
 * (`..`, `/`, `\`) e não depende de a pasta distinguir maiúsculas de minúsculas, porque a
 * maiúscula do `documentId` nunca sai como letra.
 */
export function roomDirectoryName(documentId: string): string {
  let name = '';
  for (const byte of Buffer.from(documentId, 'utf8')) {
    const char = String.fromCharCode(byte);
    name += /[a-z0-9_-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return name;
}

function generationFiles(generation: number): {
  readonly snapshot: string;
  readonly log: string;
  readonly receipts: string;
} {
  return {
    snapshot: `snapshot.${generation}.bin`,
    log: `log.${generation}.bin`,
    receipts: `receipts.${generation}.bin`,
  };
}

function frame(payload: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(payload.byteLength);
  return Buffer.concat([head, payload]);
}

function encodeCommit(commit: StoredCommit): Buffer {
  const header = Buffer.from(
    JSON.stringify({ commitId: commit.commitId, receipt: commit.receipt }),
    'utf8',
  );
  return Buffer.concat([frame(header), frame(commit.update)]);
}

function encodeReceipt(receipt: CommitReceipt): Buffer {
  return frame(Buffer.from(JSON.stringify(receipt), 'utf8'));
}

interface Frame {
  readonly payload: Buffer;
  readonly end: number;
}

/** Lê um quadro `[u32 tamanho][payload]`. `null` quando o arquivo acaba antes de ele terminar. */
function readFrame(bytes: Buffer, offset: number): Frame | null {
  if (bytes.length - offset < 4) return null;
  const end = offset + 4 + bytes.readUInt32BE(offset);
  if (end > bytes.length) return null;
  return { payload: bytes.subarray(offset + 4, end), end };
}

function isReceipt(value: unknown): value is CommitReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.commitId === 'string' &&
    typeof candidate.roomEpoch === 'string' &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp) &&
    typeof candidate.durable === 'boolean'
  );
}

function parseJson(payload: Buffer, where: string): unknown {
  try {
    return JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    return fail('STORAGE_UNAVAILABLE', `${where}: registro com JSON inválido; a sala não abre.`);
  }
}

interface ParsedLog {
  readonly commits: StoredCommit[];
  /** Bytes que fecham o último registro inteiro. */
  readonly validBytes: number;
}

/**
 * Lê `log.bin`. O fim truncado (queda durante a escrita) fica de fora e `validBytes` diz onde
 * cortar; um registro inteiro que não vale é corrupção e a carga falha.
 */
function parseLog(bytes: Buffer, where: string): ParsedLog {
  const commits: StoredCommit[] = [];
  let offset = 0;
  for (;;) {
    if (offset >= bytes.length) return { commits, validBytes: offset };
    const header = readFrame(bytes, offset);
    const body = header === null ? null : readFrame(bytes, header.end);
    if (header === null || body === null) return { commits, validBytes: offset };
    const meta = parseJson(header.payload, where) as { commitId?: unknown; receipt?: unknown };
    if (typeof meta.commitId !== 'string' || !isReceipt(meta.receipt)) {
      fail('STORAGE_UNAVAILABLE', `${where}: registro com cabeçalho inválido; a sala não abre.`);
    }
    commits.push({
      commitId: meta.commitId,
      update: new Uint8Array(body.payload),
      receipt: meta.receipt,
    });
    offset = body.end;
  }
}

function parseReceipts(bytes: Buffer, where: string): CommitReceipt[] {
  const receipts: CommitReceipt[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const record = readFrame(bytes, offset);
    if (record === null) {
      fail('STORAGE_UNAVAILABLE', `${where}: arquivo de recibos truncado; a sala não abre.`);
    }
    const receipt = parseJson(record.payload, where);
    if (!isReceipt(receipt)) {
      fail('STORAGE_UNAVAILABLE', `${where}: recibo inválido; a sala não abre.`);
    }
    receipts.push(receipt);
    offset = record.end;
  }
  return receipts;
}

function parseMeta(text: string, where: string): RoomMeta {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('STORAGE_UNAVAILABLE', `${where}: ${META_FILE} com JSON inválido.`);
  }
  const candidate = value as Partial<RoomMeta> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    candidate.format !== FORMAT ||
    typeof candidate.provider !== 'string' ||
    typeof candidate.roomEpoch !== 'string' ||
    typeof candidate.generation !== 'number' ||
    !Number.isInteger(candidate.generation) ||
    candidate.generation < 0
  ) {
    return fail(
      'STORAGE_UNAVAILABLE',
      `${where}: ${META_FILE} num formato que este armazenamento não conhece (esperado ${FORMAT}).`,
    );
  }
  return candidate as RoomMeta;
}

async function writeFileDurable(path: string, data: Uint8Array): Promise<void> {
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** `fsync` do diretório, para o `rename` e a criação de arquivo chegarem ao disco. */
async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    // Alguns sistemas (Windows) não deixam sincronizar um diretório; o resto é falha de verdade.
    const code = errorCode(error);
    if (code !== 'EISDIR' && code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function writeGeneration(
  directory: string,
  generation: number,
  contents: RoomContents,
): Promise<void> {
  const files = generationFiles(generation);
  await writeFileDurable(join(directory, files.snapshot), contents.snapshot);
  await writeFileDurable(join(directory, files.log), Buffer.concat(contents.log.map(encodeCommit)));
  await writeFileDurable(
    join(directory, files.receipts),
    Buffer.concat(contents.receipts.map(encodeReceipt)),
  );
}

/** Troca `room.json` de uma vez: é o ponto em que a geração nova passa a valer. */
async function writeMeta(directory: string, meta: RoomMeta): Promise<void> {
  const temporary = join(directory, `${META_FILE}.tmp`);
  await writeFileDurable(temporary, Buffer.from(JSON.stringify(meta), 'utf8'));
  await rename(temporary, join(directory, META_FILE));
  await syncDirectory(directory);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Tira da pasta os arquivos de gerações mortas e os temporários que uma queda deixou. */
async function removeStaleFiles(directory: string, liveGeneration: number): Promise<void> {
  const live = new Set(Object.values(generationFiles(liveGeneration)));
  for (const name of await readdir(directory)) {
    const isData = /^(snapshot|log|receipts)\.\d+\.bin$/.test(name);
    if ((isData && !live.has(name)) || name === `${META_FILE}.tmp`) {
      await rm(join(directory, name), { force: true });
    }
  }
}

/**
 * Armazenamento em arquivos, um diretório por sala (`directory/<documentId>/`):
 *
 * - `room.json`: `provider`, `roomEpoch`, formato e geração viva;
 * - `snapshot.<g>.bin`: estado Yjs compactado;
 * - `log.<g>.bin`: registros `[u32 tamanho][JSON {commitId, receipt}][u32 tamanho][update]`;
 * - `receipts.<g>.bin`: recibos já compactados, `[u32 tamanho][JSON do recibo]`.
 *
 * `append` escreve o lote numa só escrita e faz `fsync` antes de resolver. `compact` e `reset`
 * gravam a geração seguinte inteira, com `fsync`, e só então trocam `room.json` por `rename`: uma
 * queda deixa a geração anterior ou a nova, nunca uma mistura. Um processo por diretório.
 */
export function createFileRoomStorage(options: { readonly directory: string }): RoomStorage {
  const root = options.directory;
  const locks = new Map<string, Promise<unknown>>();

  function directoryOf(documentId: string): { readonly name: string; readonly path: string } {
    const name = roomDirectoryName(documentId);
    if (name.length === 0 || name.length > MAX_DIRECTORY_NAME_LENGTH) {
      fail(
        'LIMIT_EXCEEDED',
        `O documentId "${documentId.slice(0, 40)}" não cabe num nome de diretório (de 1 a ${MAX_DIRECTORY_NAME_LENGTH} caracteres depois de codificado).`,
      );
    }
    return { name, path: join(root, name) };
  }

  /** Uma operação por vez em cada sala, na ordem em que chegaram. */
  async function serialized<T>(documentId: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(documentId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    locks.set(documentId, tail);
    try {
      return await run;
    } finally {
      if (locks.get(documentId) === tail) locks.delete(documentId);
    }
  }

  async function guarded<T>(
    what: string,
    documentId: string,
    task: () => Promise<T>,
  ): Promise<Result<T, CollaborationError>> {
    try {
      return ok(await serialized(documentId, task));
    } catch (error) {
      if (error instanceof StorageFailure) return err(error.failure);
      return err(unavailable(`${what} da sala "${documentId}"`, error));
    }
  }

  async function readMeta(directory: string, documentId: string): Promise<RoomMeta | null> {
    let text: string;
    try {
      text = await readFile(join(directory, META_FILE), 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
    return parseMeta(text, `Sala "${documentId}"`);
  }

  async function requireMeta(directory: string, documentId: string): Promise<RoomMeta> {
    const meta = await readMeta(directory, documentId);
    if (meta === null) {
      return fail('NOT_FOUND', `A sala "${documentId}" não existe no armazenamento.`);
    }
    return meta;
  }

  async function readContents(
    directory: string,
    meta: RoomMeta,
    documentId: string,
  ): Promise<RoomContents> {
    const files = generationFiles(meta.generation);
    const where = `Sala "${documentId}"`;
    const logPath = join(directory, files.log);
    const [snapshot, logBytes, receiptsBytes] = await Promise.all([
      readFile(join(directory, files.snapshot)),
      readFile(logPath),
      readFile(join(directory, files.receipts)),
    ]);
    const parsed = parseLog(logBytes, `${where}, ${files.log}`);
    if (parsed.validBytes < logBytes.length) {
      // Queda no meio da escrita: o lote nunca recebeu ACK, então o resto é descartado.
      const handle = await open(logPath, 'r+');
      try {
        await handle.truncate(parsed.validBytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const inLog = new Set(parsed.commits.map((commit) => commit.commitId));
    return {
      snapshot: new Uint8Array(snapshot),
      log: parsed.commits,
      receipts: parseReceipts(receiptsBytes, `${where}, ${files.receipts}`).filter(
        (receipt) => !inLog.has(receipt.commitId),
      ),
    };
  }

  /** Grava a geração seguinte e a torna a viva. */
  async function switchGeneration(
    directory: string,
    meta: RoomMeta,
    contents: RoomContents,
    roomEpoch: string,
    provider: string,
  ): Promise<void> {
    const generation = meta.generation + 1;
    await writeGeneration(directory, generation, contents);
    await syncDirectory(directory);
    await writeMeta(directory, { format: FORMAT, provider, roomEpoch, generation });
    await removeStaleFiles(directory, generation);
  }

  return {
    load(documentId) {
      return guarded('Carga', documentId, async () => {
        const { path } = directoryOf(documentId);
        const meta = await readMeta(path, documentId);
        if (meta === null) return null;
        const contents = await readContents(path, meta, documentId);
        const room: StoredRoom = {
          provider: meta.provider,
          roomEpoch: meta.roomEpoch,
          snapshot: contents.snapshot,
          log: contents.log,
          receipts: contents.receipts,
        };
        return room;
      });
    },

    create(documentId, room) {
      return guarded('Criação', documentId, async () => {
        const { path } = directoryOf(documentId);
        if (await exists(join(path, META_FILE))) {
          fail('CONFLICT', `A sala "${documentId}" já existe.`);
        }
        // A sala nasce inteira num diretório temporário e entra no lugar por um `rename`.
        const temporary = join(root, `.tmp-${randomUUID()}`);
        await mkdir(temporary, { recursive: true });
        try {
          await writeGeneration(temporary, 0, room);
          await writeMeta(temporary, {
            format: FORMAT,
            provider: room.provider,
            roomEpoch: room.roomEpoch,
            generation: 0,
          });
          await syncDirectory(temporary);
          await rename(temporary, path);
        } catch (error) {
          await rm(temporary, { recursive: true, force: true });
          const code = errorCode(error);
          if (code === 'EEXIST' || code === 'ENOTEMPTY') {
            fail('CONFLICT', `A sala "${documentId}" já existe.`);
          }
          throw error;
        }
        await syncDirectory(root);
      });
    },

    append(documentId, batch: AppendBatch) {
      return guarded('Gravação', documentId, async () => {
        const { path } = directoryOf(documentId);
        const meta = await requireMeta(path, documentId);
        const logPath = join(path, generationFiles(meta.generation).log);
        const bytes = Buffer.concat(batch.commits.map(encodeCommit));
        const handle = await open(logPath, 'a');
        let sizeBefore = 0;
        try {
          sizeBefore = (await handle.stat()).size;
          await handle.appendFile(bytes);
          await handle.sync();
        } catch (error) {
          // Uma escrita pela metade não pode ficar no meio do log: volta ao tamanho de antes.
          await handle.truncate(sizeBefore).catch(() => undefined);
          throw error;
        } finally {
          await handle.close();
        }
      });
    },

    compact(
      documentId,
      snapshot,
      throughCommitId,
      compactOptions: CompactOptions = {},
    ): Promise<Result<void, CollaborationError>> {
      return guarded('Compactação', documentId, async () => {
        const { path } = directoryOf(documentId);
        const meta = await requireMeta(path, documentId);
        const current = await readContents(path, meta, documentId);
        const through = current.log.findIndex((commit) => commit.commitId === throughCommitId);
        const dropped = through < 0 ? [] : current.log.slice(0, through + 1);
        const cutoff = compactOptions.dropReceiptsBefore;
        await switchGeneration(
          path,
          meta,
          {
            snapshot,
            log: through < 0 ? current.log : current.log.slice(through + 1),
            receipts: [...current.receipts, ...dropped.map((commit) => commit.receipt)].filter(
              (receipt) => cutoff === undefined || receipt.timestamp >= cutoff,
            ),
          },
          meta.roomEpoch,
          meta.provider,
        );
      });
    },

    reset(documentId, room) {
      return guarded('Reinício', documentId, async () => {
        const { path } = directoryOf(documentId);
        const meta = await requireMeta(path, documentId);
        await switchGeneration(path, meta, room, room.roomEpoch, room.provider);
      });
    },
  };
}
