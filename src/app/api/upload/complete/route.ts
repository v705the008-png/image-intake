import { NextResponse } from 'next/server';
import { readImageMeta } from '@/lib/bleed';
import { renderPdfThumb } from '@/lib/pdfThumb';
import { blobPath, isSafeId, readUpload, thumbPath, withUploadLock, writeUpload } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  let uploadId = '';
  try {
    uploadId = String((await req.json()).uploadId ?? '');
  } catch {
    /* 下の検証で弾く */
  }
  if (!isSafeId(uploadId)) {
    return NextResponse.json({ error: '不正なアップロードIDです' }, { status: 400 });
  }

  return withUploadLock(uploadId, async () => {
    const meta = await readUpload(uploadId);
    if (!meta) {
      return NextResponse.json({ error: 'アップロードが見つかりません' }, { status: 404 });
    }
    if (meta.receivedBytes !== meta.totalBytes) {
      return NextResponse.json(
        { error: '送信が途中で終わっています。もう一度お試しください。' },
        { status: 400 },
      );
    }

    const previewUrl = () => (meta.thumb ? `/api/upload/thumb?uploadId=${uploadId}` : null);

    // 返事が届かず完了の確認が再送されても、大きなファイルを読み直さない
    if (meta.image) return NextResponse.json({ ok: true, image: meta.image, previewUrl: previewUrl() });

    try {
      const image = await readImageMeta(blobPath(uploadId), meta.totalBytes);
      meta.image = image;
      // PDF はブラウザで画像として表示できないので、1ページ目をプレビュー画像にしておく
      if (image.format === 'pdf') {
        meta.thumb = Boolean(await renderPdfThumb(blobPath(uploadId), thumbPath(uploadId)));
      }
      await writeUpload(meta);
      return NextResponse.json({ ok: true, image, previewUrl: previewUrl() });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ファイルを読み取れませんでした。JPEG / PNG / WebP / TIFF / PDF のいずれかでお送りください。',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 422 },
      );
    }
  });
}
