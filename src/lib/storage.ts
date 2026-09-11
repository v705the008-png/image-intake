import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ImageMeta, Order } from './types';

/**
 * 保存先の実体。いまはローカルディスクのみ。
 * S3 / Cloudflare R2 に移すときは、この 4 つの関数を差し替えれば済むようにしてあります。
 */

const ROOT =
  process.env.STORAGE_LOCAL_DIR && process.env.STORAGE_LOCAL_DIR.trim() !== ''
    ? process.env.STORAGE_LOCAL_DIR
    : path.join(process.cwd(), 'data');

export const TMP_DIR = path.join(ROOT, 'tmp');
export const ORDERS_DIR = path.join(ROOT, 'orders');

async function ensure(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
}

/** 受付番号。人が読み上げられる形にする（例: 260911-K4F2）。 */
export function newOrderId() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除外
  let tail = '';
  for (let i = 0; i < 4; i++) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${stamp}-${tail}`;
}

export function isSafeId(id: string) {
  return /^[A-Za-z0-9._-]{1,64}$/.test(id);
}

/* ---------- 分割アップロードの一時領域 ---------- */

export type UploadMeta = {
  uploadId: string;
  originalName: string;
  totalBytes: number;
  totalChunks: number;
  receivedChunks: number;
  receivedBytes: number;
  createdAt: string;
  /** 送信完了の時点で読み取った画像（PDF）の情報。受付で大きなファイルを二度読まないためのもの */
  image?: ImageMeta;
  /** PDF の1ページ目のプレビュー（thumbPath）を作れたか */
  thumb?: boolean;
};

const metaPath = (uploadId: string) => path.join(TMP_DIR, `${uploadId}.json`);
export const blobPath = (uploadId: string) => path.join(TMP_DIR, `${uploadId}.bin`);
/** PDF のプレビュー画像（送信完了時に作る） */
export const thumbPath = (uploadId: string) => path.join(TMP_DIR, `${uploadId}.thumb.jpg`);

/** 送信時に作った PDF のプレビューを、案件フォルダへ移す。無ければ null */
export async function moveUploadThumb(uploadId: string, dest: string): Promise<number | null> {
  try {
    await fsp.rename(thumbPath(uploadId), dest);
  } catch {
    try {
      await fsp.copyFile(thumbPath(uploadId), dest);
      await fsp.rm(thumbPath(uploadId), { force: true });
    } catch {
      return null;
    }
  }
  return (await fsp.stat(dest)).size;
}

export async function createUpload(meta: UploadMeta) {
  await ensure(TMP_DIR);
  await fsp.writeFile(blobPath(meta.uploadId), Buffer.alloc(0));
  await fsp.writeFile(metaPath(meta.uploadId), JSON.stringify(meta, null, 2));
}

export async function readUpload(uploadId: string): Promise<UploadMeta | null> {
  try {
    return JSON.parse(await fsp.readFile(metaPath(uploadId), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeUpload(meta: UploadMeta) {
  await fsp.writeFile(metaPath(meta.uploadId), JSON.stringify(meta, null, 2));
}

/**
 * チャンクを「指定の位置」に書き込む。末尾への追記にしないのは、
 * 途中まで書かれて失敗した残りがあっても、同じ位置に書き直せば壊れないようにするため。
 */
export async function writeChunkAt(uploadId: string, position: number, data: Buffer) {
  const fh = await fsp.open(blobPath(uploadId), 'r+');
  try {
    await fh.truncate(position);
    let written = 0;
    while (written < data.length) {
      const { bytesWritten } = await fh.write(data, written, data.length - written, position + written);
      written += bytesWritten;
    }
  } finally {
    await fh.close();
  }
}

type LockMap = Map<string, Promise<unknown>>;
const lockHost = globalThis as typeof globalThis & { __imageIntakeUploadLocks?: LockMap };
const uploadLocks: LockMap = (lockHost.__imageIntakeUploadLocks ??= new Map());

/**
 * 同じアップロードへの処理を1つずつ順番に実行する。
 * 送り直しと、遅れて届いた送信が同時に来ても、受信位置の読み書きが食い違わないようにする。
 * （API ルートごとにモジュールが分かれても共有できるよう globalThis に置く）
 */
export function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = uploadLocks.get(uploadId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  uploadLocks.set(uploadId, tail);
  void tail.then(() => {
    if (uploadLocks.get(uploadId) === tail) uploadLocks.delete(uploadId);
  });
  return run;
}

export async function discardUpload(uploadId: string) {
  await fsp.rm(blobPath(uploadId), { force: true });
  await fsp.rm(metaPath(uploadId), { force: true });
  await fsp.rm(thumbPath(uploadId), { force: true });
}

/* ---------- 受付済みの案件 ---------- */

export const orderDir = (orderId: string) => path.join(ORDERS_DIR, orderId);

export async function initOrderDir(orderId: string) {
  await ensure(orderDir(orderId));
}

/** 一時ファイルを案件フォルダへ移す（同一ボリューム外でもコピーで対応） */
export async function moveIntoOrder(uploadId: string, orderId: string, filename: string) {
  const dest = path.join(orderDir(orderId), filename);
  await ensure(orderDir(orderId));
  try {
    await fsp.rename(blobPath(uploadId), dest);
  } catch {
    await fsp.copyFile(blobPath(uploadId), dest);
    await fsp.rm(blobPath(uploadId), { force: true });
  }
  await fsp.rm(metaPath(uploadId), { force: true });
  return dest;
}

export async function saveOrder(order: Order) {
  await ensure(orderDir(order.id));
  await fsp.writeFile(
    path.join(orderDir(order.id), 'order.json'),
    JSON.stringify(order, null, 2),
  );
}

export async function readOrder(orderId: string): Promise<Order | null> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(orderDir(orderId), 'order.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}

export async function listOrders(): Promise<Order[]> {
  await ensure(ORDERS_DIR);
  const names = await fsp.readdir(ORDERS_DIR);
  const out: Order[] = [];
  for (const n of names) {
    const o = await readOrder(n);
    if (o) out.push(o);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function orderFileStream(orderId: string, filename: string) {
  return fs.createReadStream(path.join(orderDir(orderId), filename));
}

export function orderFilePath(orderId: string, filename: string) {
  return path.join(orderDir(orderId), filename);
}

/** 24時間以上残っている中断アップロードを掃除する */
export async function sweepTmp() {
  try {
    const names = await fsp.readdir(TMP_DIR);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const n of names) {
      const p = path.join(TMP_DIR, n);
      const st = await fsp.stat(p);
      if (st.mtimeMs < cutoff) await fsp.rm(p, { force: true });
    }
  } catch {
    /* tmp がまだ無いだけ */
  }
}
