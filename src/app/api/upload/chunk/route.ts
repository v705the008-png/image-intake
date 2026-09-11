import { NextResponse } from 'next/server';
import { isSafeId, readUpload, withUploadLock, writeChunkAt, writeUpload } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 0 以上の整数のクエリ。無ければ null、不正なら NaN */
function intParam(url: URL, name: string) {
  const v = url.searchParams.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}

/** どこまで受け取ったか。通信が途切れたあと、クライアントが続きの位置を知るために使う */
export async function GET(req: Request) {
  const uploadId = new URL(req.url).searchParams.get('uploadId') ?? '';
  if (!isSafeId(uploadId)) {
    return NextResponse.json({ error: '不正なアップロードIDです' }, { status: 400 });
  }
  const meta = await readUpload(uploadId);
  if (!meta) {
    return NextResponse.json({ error: 'アップロードが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({
    receivedChunks: meta.receivedChunks,
    receivedBytes: meta.receivedBytes,
    totalChunks: meta.totalChunks,
    totalBytes: meta.totalBytes,
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const uploadId = url.searchParams.get('uploadId') ?? '';
  const index = intParam(url, 'index');
  const offset = intParam(url, 'offset');
  const size = intParam(url, 'size');

  if (!isSafeId(uploadId)) {
    return NextResponse.json({ error: '不正なアップロードIDです' }, { status: 400 });
  }
  if (index === null || Number.isNaN(index) || Number.isNaN(offset) || Number.isNaN(size)) {
    return NextResponse.json({ error: '送信の指定が不正です' }, { status: 400 });
  }

  // 本文は先に受け取りきる（遅い回線の送信中に、ほかの処理を待たせない）
  let buf: Buffer;
  try {
    buf = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: '通信が途中で途切れました', retryable: true }, { status: 400 });
  }
  // 申告より短い＝途中で切れた本文。書き込まずに送り直してもらう
  if (size !== null && buf.length !== size) {
    return NextResponse.json({ error: '通信が途中で途切れました', retryable: true }, { status: 400 });
  }

  return withUploadLock(uploadId, async () => {
    const meta = await readUpload(uploadId);
    if (!meta) {
      return NextResponse.json({ error: 'アップロードが見つかりません' }, { status: 404 });
    }

    // 位置はバイト数で確かめる（offset が無い古いクライアントはチャンク番号で）
    const inOrder = offset !== null ? offset === meta.receivedBytes : index === meta.receivedChunks;
    if (!inOrder) {
      // すでに受け取った部分の再送（返事だけ届かなかった場合など）は、書き込まずに成功として返す
      const already = offset !== null ? offset + buf.length <= meta.receivedBytes : index < meta.receivedChunks;
      if (already) {
        return NextResponse.json({
          receivedChunks: meta.receivedChunks,
          receivedBytes: meta.receivedBytes,
          duplicate: true,
        });
      }
      return NextResponse.json(
        {
          error: `順番が合いません（期待 ${meta.receivedChunks} / 受信 ${index}）`,
          expected: meta.receivedChunks,
          receivedBytes: meta.receivedBytes,
        },
        { status: 409 },
      );
    }

    if (meta.receivedBytes + buf.length > meta.totalBytes) {
      return NextResponse.json({ error: '受信サイズが申告より大きいです' }, { status: 400 });
    }

    await writeChunkAt(uploadId, meta.receivedBytes, buf);
    meta.receivedChunks += 1;
    meta.receivedBytes += buf.length;
    await writeUpload(meta);

    return NextResponse.json({ receivedChunks: meta.receivedChunks, receivedBytes: meta.receivedBytes });
  });
}
