import fsp from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { isSafeId, orderFilePath, readOrder } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 受付直後の完了画面で見せる、お客さんが送った画像のサムネイル。
 * 処理済みのデータ（塗り足し・トンボ・高解像度化）は、ここからは絶対に出さない。
 * 仕上がりは、あなたが後から LINE などで手渡しで見せる運用のため。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  if (!isSafeId(orderId)) return new NextResponse('bad request', { status: 400 });

  const order = await readOrder(orderId);
  if (!order || !order.files.some((f) => f.filename === 'source.jpg')) {
    return new NextResponse('not found', { status: 404 });
  }

  try {
    const buf = await fsp.readFile(orderFilePath(orderId, 'source.jpg'));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
}
