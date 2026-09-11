import archiver from 'archiver';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { isSafeId, orderFilePath, readOrder } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 案件フォルダ一式（原本・入稿データ・指定内容）を ZIP でまとめて返す */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  if (!(await isAdmin())) return new NextResponse('unauthorized', { status: 401 });

  const { orderId } = await params;
  if (!isSafeId(orderId)) return new NextResponse('bad request', { status: 400 });
  const order = await readOrder(orderId);
  if (!order) return new NextResponse('not found', { status: 404 });

  const archive = archiver('zip', { zlib: { level: 1 } }); // 画像は既に圧縮済みなので低圧縮で速く
  for (const f of order.files) {
    archive.file(orderFilePath(orderId, f.filename), { name: `${orderId}/${f.filename}` });
  }
  archive.append(JSON.stringify(order, null, 2), { name: `${orderId}/order.json` });
  archive.finalize();

  return new NextResponse(archive as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${orderId}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
