import { NextResponse } from 'next/server';
import { createUpload, newOrderId, sweepTmp } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MB = Number(process.env.MAX_FILE_MB ?? 200);

export async function POST(req: Request) {
  const body = await req.json();
  const originalName = String(body.originalName ?? 'image');
  const totalBytes = Number(body.totalBytes ?? 0);
  const totalChunks = Number(body.totalChunks ?? 0);

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return NextResponse.json({ error: 'ファイルサイズが不正です' }, { status: 400 });
  }
  if (totalBytes > MAX_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `ファイルが大きすぎます（上限 ${MAX_MB}MB）` },
      { status: 413 },
    );
  }

  await sweepTmp();

  const uploadId = `up-${newOrderId()}`;
  await createUpload({
    uploadId,
    originalName,
    totalBytes,
    totalChunks,
    receivedChunks: 0,
    receivedBytes: 0,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ uploadId });
}
