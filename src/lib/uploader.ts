'use client';

import type { ImageMeta } from './types';

const CHUNK = 2 * 1024 * 1024; // 2MB（スマホ回線で1回あたりの送信を軽くし、やり直しの無駄も減らす）
/** 送信中に1バイトも進まない時間がこれを超えたら、止まったとみなして送り直す */
const STALL_MS = 20_000;
/** 送り終わってから返事を待つ上限。超えたらサーバーに受け取り状況を聞いて先へ進む */
const RESPONSE_WAIT_MS = 15_000;
/** 1チャンクにかけてよい時間の上限（細い回線でも 2MB を送り切れる長さ） */
const CHUNK_TIMEOUT_MS = 180_000;
/** 同じ場所で続けて失敗してよい回数（間隔は 1, 2, 4, 8, 16, 20… 秒と伸ばす） */
const MAX_FAILURES = 10;

export type UploadResult = {
  uploadId: string;
  image: ImageMeta;
  /** PDF の1ページ目のプレビュー画像（サーバーで作れたときだけ） */
  previewUrl?: string;
};

export type UploadHandle = {
  /** アップロード完了時に uploadId と画像情報を返す */
  done: Promise<UploadResult>;
  abort: () => void;
};

class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const aborted = () => new DOMException('Aborted', 'AbortError');

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(aborted());
      },
      { once: true },
    );
  });
}

/** スマホで別のアプリを開いている間などは通信が止まるので、画面に戻ってくるまで待つ */
function waitVisible(signal: AbortSignal) {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    const onChange = () => {
      if (!document.hidden) done();
    };
    document.addEventListener('visibilitychange', onChange);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** 時間切れつきの fetch。通信の途切れ・時間切れはすべて「送り直せる失敗」として投げる */
async function request(url: string, init: RequestInit, parent: AbortSignal, timeoutMs: number) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new HttpError(res.status, String(body.error ?? `送信に失敗しました（${res.status}）`), body);
    }
    return body;
  } catch (e) {
    if (parent.aborted) throw aborted();
    if (e instanceof HttpError) throw e;
    throw new Error('通信が途切れました');
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

/**
 * チャンクは XHR で送る（fetch と違い、送信の進み具合が分かる）。
 * - 送信中に STALL_MS のあいだ1バイトも進まない → 止まったとみなして中断
 * - 送り終わってから RESPONSE_WAIT_MS 待っても返事が来ない → 中断。サーバーは受け取っていることが多いので、
 *   呼び出し側が受け取り状況を聞いて先へ進む（スマホ＋中継で返事だけが数分遅れる現象への対策）
 */
function sendChunk(
  url: string,
  blob: Blob,
  parent: AbortSignal,
  onBytes: (sent: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (parent.aborted) return reject(aborted());
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    let lastActivity = started;
    let uploaded = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      parent.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      xhr.abort();
      finish(() => reject(aborted()));
    };
    const watch = setInterval(() => {
      const now = Date.now();
      const idle = now - lastActivity;
      if ((!uploaded && idle > STALL_MS) || (uploaded && idle > RESPONSE_WAIT_MS) || now - started > CHUNK_TIMEOUT_MS) {
        xhr.abort();
        finish(() => reject(new Error(uploaded ? '返事が届きませんでした' : '通信が止まりました')));
      }
    }, 1000);

    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now();
      onBytes(e.loaded);
    };
    xhr.upload.onload = () => {
      uploaded = true;
      lastActivity = Date.now();
      onBytes(blob.size);
    };
    xhr.onload = () =>
      finish(() => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText || '{}');
        } catch {
          /* 本文なし */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new HttpError(xhr.status, String(body.error ?? `送信に失敗しました（${xhr.status}）`), body));
      });
    xhr.onerror = () => finish(() => reject(new Error('通信が途切れました')));

    parent.addEventListener('abort', onAbort, { once: true });
    xhr.open('POST', url);
    xhr.send(blob);
  });
}

/** サーバー側の都合（混雑・再起動中など）で、送り直せば通る可能性がある失敗か */
const retryable = (e: unknown) =>
  !(e instanceof HttpError) || e.status >= 500 || e.status === 408 || e.status === 429 || e.body.retryable === true;

/**
 * ファイルを 4MB ずつ送る。
 * - 1回ごとに時間切れを設け、止まったままにならないようにする
 * - 失敗したら間隔を空けて送り直す。その前にサーバーが実際にどこまで受け取ったかを聞き、続きから再開する
 * - 返事だけが届かなかったチャンクを送り直しても、サーバー側で二重に書き込まれない
 */
export function startUpload(
  file: File,
  onProgress: (ratio: number) => void,
  onRetry?: (retrying: boolean) => void,
): UploadHandle {
  const ac = new AbortController();
  const signal = ac.signal;

  /** 失敗しても決まった回数まではやり直す小さな共通処理 */
  async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fn();
        onRetry?.(false);
        return r;
      } catch (e) {
        if (signal.aborted || !retryable(e) || attempt >= maxAttempts) throw e;
        onRetry?.(true);
        await waitVisible(signal);
        await sleep(Math.min(20_000, 1000 * 2 ** (attempt - 1)), signal);
      }
    }
  }

  const done = (async () => {
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));

    const init = await withRetry(
      () =>
        request(
          '/api/upload/init',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalName: file.name || 'image', totalBytes: file.size, totalChunks }),
          },
          signal,
          30_000,
        ),
      5,
    );
    const uploadId = String(init.uploadId);

    let next = 0;
    let failures = 0;
    while (next < totalChunks) {
      const offset = next * CHUNK;
      const blob = file.slice(offset, Math.min(offset + CHUNK, file.size));
      try {
        const r = await sendChunk(
          `/api/upload/chunk?uploadId=${uploadId}&index=${next}&offset=${offset}&size=${blob.size}`,
          blob,
          signal,
          // 送っている途中も進み具合を出す（最後の確認が終わるまでは 100% にしない）
          (sent) => onProgress(Math.min(0.99, (offset + sent) / file.size)),
        );
        next = Number.isInteger(r.receivedChunks) ? Number(r.receivedChunks) : next + 1;
        failures = 0;
        onRetry?.(false);
        onProgress(Math.min(0.99, (next * CHUNK) / file.size));
      } catch (e) {
        if (signal.aborted) throw e;
        // 順番のずれは、サーバーが受け取った位置からそのまま続ける
        if (e instanceof HttpError && e.status === 409 && Number.isInteger(e.body.expected)) {
          next = Number(e.body.expected);
          continue;
        }
        if (!retryable(e)) throw e;
        failures++;
        if (failures >= MAX_FAILURES) {
          throw new Error('通信が不安定なため送信できませんでした。電波の良い場所で「もう一度送る」を押してください。');
        }
        onRetry?.(true);
        await waitVisible(signal);
        await sleep(Math.min(20_000, 1000 * 2 ** (failures - 1)), signal);
        try {
          const st = await request(`/api/upload/chunk?uploadId=${uploadId}`, { method: 'GET' }, signal, 15_000);
          if (Number.isInteger(st.receivedChunks)) {
            // 返事が届かなかっただけで、サーバーは受け取れていた → 失敗には数えずに先へ進む
            if (Number(st.receivedChunks) > next) {
              failures = 0;
              onProgress(Math.min(0.99, (Number(st.receivedChunks) * CHUNK) / file.size));
            }
            next = Number(st.receivedChunks);
          }
        } catch {
          /* 状態が聞けなくても、次の送信で順番のずれとして分かる */
        }
      }
    }

    // 大きな PDF は中身の確認に時間がかかることがあるので、待ち時間は長めに取る
    const comp = await withRetry(
      () =>
        request(
          '/api/upload/complete',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }) },
          signal,
          300_000,
        ),
      4,
    );
    if (!comp.ok) throw new Error(String(comp.error ?? '画像を確認できませんでした'));
    onProgress(1);
    return {
      uploadId,
      image: comp.image as ImageMeta,
      previewUrl: typeof comp.previewUrl === 'string' ? comp.previewUrl : undefined,
    };
  })();

  return { done, abort: () => ac.abort() };
}

/** ブラウザ側だけで、選ばれた画像の縦横を先に読む（アップロードを待たずに判定を出すため） */
export async function readLocalSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  // PDF は画像として読めないので、サーバーの結果を待つ
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return null;
  try {
    if ('createImageBitmap' in window) {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return size;
    }
  } catch {
    /* HEIC など、ブラウザが読めない形式。サーバー側の結果を待つ */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
