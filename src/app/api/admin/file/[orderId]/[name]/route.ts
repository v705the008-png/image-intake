import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { isSafeId, orderFilePath, readOrder } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.json': 'application/json',
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string; name: string }> },
) {
  if (!(await isAdmin())) return new NextResponse('unauthorized', { status: 401 });

  const { orderId, name } = await params;
  if (!isSafeId(orderId) || !isSafeId(name)) {
    return new NextResponse('bad request', { status: 400 });
  }
  const order = await readOrder(orderId);
  if (!order) return new NextResponse('not found', { status: 404 });
  if (name !== 'order.json' && !order.files.some((f) => f.filename === name)) {
    return new NextResponse('not found', { status: 404 });
  }

  const p = orderFilePath(orderId, name);
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }

  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const download = new URL(req.url).searchParams.get('dl') === '1';
  const stream = fs.createReadStream(p) as unknown as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, no-store',
      ...(download
        ? { 'Content-Disposition': `attachment; filename="${orderId}_${name}"` }
        : {}),
    },
  });
}
