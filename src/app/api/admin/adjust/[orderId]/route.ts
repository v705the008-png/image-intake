import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { aiExpandAvailable } from '@/lib/expand';
import { enqueue } from '@/lib/pipeline';
import { PRODUCTS, resolveSize, type BleedMode } from '@/lib/products';
import { isSafeId, readOrder, saveOrder } from '@/lib/storage';
import type { AdjustFit, OrderAdjust } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FITS: AdjustFit[] = ['cover', 'contain', 'expand'];
const MODES: BleedMode[] = ['mirror', 'extend', 'color'];
const HEX = /^#[0-9a-fA-F]{6}$/;

const clamp01 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};

/** 管理画面で変えた仕上げ設定を保存して、入稿データを作り直す */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { orderId } = await params;
  if (!isSafeId(orderId)) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const order = await readOrder(orderId);
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (order.meta.format === 'pdf') {
    return NextResponse.json({ error: 'PDF は自動調整の対象外です' }, { status: 400 });
  }

  const b = (await req.json().catch(() => null)) as Partial<OrderAdjust> | null;
  if (!b) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const product = PRODUCTS.find((p) => p.id === b.productId);
  if (!product) return NextResponse.json({ error: '商品の指定が不正です' }, { status: 400 });

  const adjust: OrderAdjust = {
    productId: product.id,
    sizeId: String(b.sizeId ?? ''),
    orientation: b.orientation === 'landscape' ? 'landscape' : 'portrait',
    customWidthMm: b.customWidthMm !== undefined ? Number(b.customWidthMm) : undefined,
    customHeightMm: b.customHeightMm !== undefined ? Number(b.customHeightMm) : undefined,
    fit: FITS.includes(b.fit as AdjustFit) ? (b.fit as AdjustFit) : 'cover',
    focusX: clamp01(b.focusX),
    focusY: clamp01(b.focusY),
    bleedMm:
      b.bleedMm === undefined || Number.isNaN(Number(b.bleedMm))
        ? product.defaultBleedMm
        : Math.min(30, Math.max(0, Number(b.bleedMm))),
    bleedMode: MODES.includes(b.bleedMode as BleedMode) ? (b.bleedMode as BleedMode) : 'mirror',
    bleedColor: HEX.test(String(b.bleedColor)) ? String(b.bleedColor) : '#ffffff',
    padColor: HEX.test(String(b.padColor)) ? String(b.padColor) : '#ffffff',
    updatedAt: new Date().toISOString(),
  };

  if (adjust.sizeId !== 'custom' && !product.sizes.some((s) => s.id === adjust.sizeId)) {
    return NextResponse.json({ error: 'サイズの指定が不正です' }, { status: 400 });
  }
  const size = resolveSize({
    productId: product.id,
    sizeId: adjust.sizeId!,
    orientation: adjust.orientation,
    customWidthMm: adjust.customWidthMm,
    customHeightMm: adjust.customHeightMm,
  });
  if (!size) {
    return NextResponse.json({ error: 'カスタムサイズは 10〜3000mm で指定してください' }, { status: 400 });
  }
  if (adjust.fit === 'expand' && !aiExpandAvailable()) {
    return NextResponse.json(
      { error: 'AI で描き足すには .env.local に BFL_API_KEY の設定が必要です' },
      { status: 400 },
    );
  }

  order.adjust = adjust;
  order.print = { status: 'pending', startedAt: new Date().toISOString() };
  await saveOrder(order);
  enqueue(orderId);

  return NextResponse.json({ ok: true });
}
