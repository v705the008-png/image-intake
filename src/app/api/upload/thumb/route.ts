import fsp from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { isSafeId, thumbPath } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 送信したばかりの PDF の1ページ目（お客さんの画面のプレビュー用）。受付前の一時ファイルなので保存させない */
export async function GET(req: Request) {
  const uploadId = new URL(req.url).searchParams.get('uploadId') ?? '';
  if (!isSafeId(uploadId)) {
    return NextResponse.json({ error: '不正なアップロードIDです' }, { status: 400 });
  }
  try {
    const buf = await fsp.readFile(thumbPath(uploadId));
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'プレビューがありません' }, { status: 404 });
  }
}
