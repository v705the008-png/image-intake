import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { enqueue } from '@/lib/pipeline';
import { isSafeId, readOrder } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 入稿データの生成をやり直す（失敗した案件や、途中でサーバーが落ちた案件の救済） */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { orderId } = await params;
  if (!isSafeId(orderId)) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const order = await readOrder(orderId);
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 });

  enqueue(orderId);
  return NextResponse.json({ ok: true });
}
