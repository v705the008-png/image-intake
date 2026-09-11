import path from 'node:path';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { readImageMeta } from '@/lib/bleed';
import { renderPdfThumb } from '@/lib/pdfThumb';
import { enqueue } from '@/lib/pipeline';
import {
  MAX_DESIGNS,
  clampQuantity,
  estimate,
  sumEstimates,
  validFinish,
  validShape,
} from '@/lib/pricing';
import { judge, judgePixels } from '@/lib/print';
import {
  applyOrientation,
  getProduct,
  hasAnyOption,
  optionTotalYen,
  type Product,
  type SizePreset,
} from '@/lib/products';
import {
  blobPath,
  initOrderDir,
  isSafeId,
  moveIntoOrder,
  moveUploadThumb,
  newOrderId,
  orderDir,
  readUpload,
  saveOrder,
  type UploadMeta,
} from '@/lib/storage';
import type { CustomerInfo, ImageMeta, Order, OrderFile, OrderOptions } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function safeExt(name: string) {
  const e = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return e && e.length <= 6 ? e : '.img';
}

function resolveSize(options: OrderOptions): SizePreset {
  const product = getProduct(options.productId);
  if (options.sizeId === 'custom') {
    const w = Number(options.customWidthMm);
    const h = Number(options.customHeightMm);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 10 || h < 10 || w > 3000 || h > 3000) {
      throw new Error('カスタムサイズは 10mm 〜 3000mm の範囲で指定してください');
    }
    return { id: 'custom', label: `${w} × ${h} mm`, widthMm: w, heightMm: h };
  }
  const s = product.sizes.find((x) => x.id === options.sizeId);
  if (!s) throw new Error('サイズの指定が不正です');
  return applyOrientation(s, options.orientation === 'landscape' ? 'landscape' : 'portrait');
}

type Prepared = {
  uploadId: string;
  upload: UploadMeta;
  options: OrderOptions;
  product: Product;
  size: SizePreset;
  meta: ImageMeta;
};

/** 1点ぶんの入力を検証・正規化する。ここではまだ何も保存しない */
async function prepare(
  raw: { uploadId?: unknown; options?: Partial<OrderOptions> },
  productId: unknown,
  label: string,
): Promise<Prepared> {
  const uploadId = String(raw.uploadId ?? '');
  if (!isSafeId(uploadId)) throw new InputError(`${label}不正なアップロードIDです`);
  const upload = await readUpload(uploadId);
  if (!upload) throw new InputError(`${label}アップロードが見つかりません`, 404);
  if (upload.receivedBytes !== upload.totalBytes) throw new InputError(`${label}送信が完了していません`);

  // 商品は注文全体でそろえる（1点目の商品に合わせる）
  const options = { ...(raw.options ?? {}), productId } as OrderOptions;
  let product: Product;
  let size: SizePreset;
  try {
    product = getProduct(options.productId);
    size = resolveSize(options);
  } catch (e) {
    throw new InputError(`${label}${e instanceof Error ? e.message : '指定が不正です'}`);
  }

  options.orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait';
  options.fit = options.fit === 'contain' ? 'contain' : 'cover';
  options.bleedOption = Boolean(options.bleedOption);
  options.upscaleOption = Boolean(options.upscaleOption);
  delete options.paidOption;
  options.bleedMm = Number.isFinite(Number(options.bleedMm)) ? Number(options.bleedMm) : product.defaultBleedMm;
  options.bleedMode = options.bleedMode ?? 'mirror';
  options.bleedColor = options.bleedColor ?? '#ffffff';
  options.padColor = options.padColor ?? '#ffffff';

  // 枚数と仕上げ方（金額はブラウザの値を信用せず、あとで計算し直す）。タペストリーは1デザイン1枚
  options.quantity = product.id === 'tapestry' ? 1 : clampQuantity(options.quantity);
  if (product.id === 'sticker') {
    options.stickerFinish = validFinish(options.stickerFinish);
    options.stickerShape = validShape(options.stickerShape);
  } else {
    delete options.stickerFinish;
    delete options.stickerShape;
  }
  delete (options as { stickersPerSheet?: unknown }).stickersPerSheet;

  // 送信完了の時点で読み取った情報があれば使う（大きな PDF を二度読まない）
  let meta: ImageMeta;
  try {
    meta = upload.image ?? (await readImageMeta(blobPath(uploadId), upload.totalBytes));
  } catch {
    throw new InputError(`${label}ファイルを読み取れませんでした`, 422);
  }
  // PDF はベクターなので高画質化の対象外
  // 高画質化は、画像と「画像が入った PDF」だけ（ベクター中心・中身を読めなかった PDF は対象外）
  if (meta.format === 'pdf' && !meta.pdf?.ppi) options.upscaleOption = false;

  return { uploadId, upload, options, product, size, meta };
}

/** 検証済みの1点を案件として保存し、必要なら裏で入稿データの生成を始める */
async function createOrder(
  p: Prepared,
  ctx: { orderId: string; groupId: string; index: number; count: number; customer: CustomerInfo },
) {
  const { orderId } = ctx;
  await initOrderDir(orderId);

  // 原本は無加工のまま案件フォルダへ
  const originalFilename = `original${safeExt(p.upload.originalName)}`;
  await moveIntoOrder(p.uploadId, orderId, originalFilename);
  const dir = orderDir(orderId);
  const originalPath = path.join(dir, originalFilename);

  const files: OrderFile[] = [
    { filename: originalFilename, bytes: p.upload.totalBytes, kind: 'original', label: '原本（無加工）' },
  ];

  const isPdf = p.meta.format === 'pdf';
  // PDF は埋め込み画像の解像度から換算した画素数で判定する（ベクター中心・読めない PDF は判定なし）
  const px = judgePixels(p.meta, isPdf);
  const j = px ? judge(px.w, px.h, p.product, p.size, p.options.fit) : null;

  const order: Order = {
    id: orderId,
    groupId: ctx.groupId,
    designIndex: ctx.index,
    designCount: ctx.count,
    createdAt: new Date().toISOString(),
    originalName: p.upload.originalName,
    meta: p.meta,
    options: { ...p.options, sizeId: p.size.id === 'custom' ? 'custom' : p.size.id },
    customer: ctx.customer,
    files,
    optionPriceYen: optionTotalYen(p.options),
    estimate: estimate(p.options) ?? undefined,
    judgement: j
      ? { effectiveDpi: j.effectiveDpi, verdict: j.verdict, headline: j.headline }
      : { effectiveDpi: 0, verdict: 'pdf', headline: 'PDF（解像度はお預かり後に確認）' },
  };

  // 塗り足し・トンボ・アップスケールは時間がかかるので裏に回す。お客さんには受付番号をすぐ返す。
  const wantsProcessing = hasAnyOption(p.options);
  order.print =
    wantsProcessing && !isPdf
      ? { status: 'pending' }
      : { status: 'skipped', error: isPdf && wantsProcessing ? 'PDFのため手作業で対応' : 'オプション未申込' };

  // 一覧とお客さんの確認画面で中身が分かるよう、原本のサムネイルだけは先に作る（上書きしない）
  // PDF は送信完了時に作った1ページ目のプレビューを移し、無ければここで作る
  const sourcePath = path.join(dir, 'source.jpg');
  try {
    const bytes = isPdf
      ? ((await moveUploadThumb(p.uploadId, sourcePath)) ?? (await renderPdfThumb(originalPath, sourcePath))?.bytes ?? null)
      : (
          await sharp(originalPath, { limitInputPixels: false })
            .rotate()
            .resize({ width: 1400, height: 1400, fit: 'inside' })
            .jpeg({ quality: 82 })
            .toFile(sourcePath)
        ).size;
    if (bytes !== null) {
      files.push({ filename: 'source.jpg', bytes, kind: 'source', label: isPdf ? 'PDF 1ページ目のプレビュー' : '原本サムネイル' });
    }
  } catch {
    /* サムネイルが作れなくても受付自体は成立させる */
  }

  await saveOrder(order);
  if (wantsProcessing && !isPdf) enqueue(orderId);

  return {
    orderId,
    judgement: j,
    bleedOption: p.options.bleedOption,
    upscaleOption: p.options.upscaleOption,
    isPdf,
    previewUrl: files.some((f) => f.kind === 'source') ? `/api/preview/${orderId}` : null,
    estimate: order.estimate ?? null,
  };
}

export async function POST(req: Request) {
  let body: {
    designs?: { uploadId?: string; options?: Partial<OrderOptions> }[];
    uploadId?: string;
    options?: Partial<OrderOptions>;
    customer?: CustomerInfo;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  // 複数デザイン（designs）が基本。1点だけの旧形式（uploadId + options）も受け付ける
  const raw = Array.isArray(body.designs)
    ? body.designs
    : body.uploadId
      ? [{ uploadId: body.uploadId, options: body.options }]
      : [];
  if (raw.length === 0) return NextResponse.json({ error: '画像が選ばれていません' }, { status: 400 });
  if (raw.length > MAX_DESIGNS) {
    return NextResponse.json({ error: `一度にお預かりできるのは${MAX_DESIGNS}点までです` }, { status: 400 });
  }

  const customer: CustomerInfo = {
    name: String(body.customer?.name ?? '').slice(0, 100),
    contact: String(body.customer?.contact ?? '').slice(0, 200),
    note: String(body.customer?.note ?? '').slice(0, 2000),
  };

  // まず全点を検証してから保存する（途中の1点がおかしくても、半端な注文を残さない）
  const productId = raw[0]?.options?.productId;
  const prepared: Prepared[] = [];
  try {
    for (let i = 0; i < raw.length; i++) {
      prepared.push(await prepare(raw[i], productId, raw.length > 1 ? `デザイン${i + 1}：` : ''));
    }
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (new Set(prepared.map((p) => p.uploadId)).size !== prepared.length) {
    return NextResponse.json({ error: '同じ画像が重複しています' }, { status: 400 });
  }

  const groupId = newOrderId();
  const designs = [];
  for (let i = 0; i < prepared.length; i++) {
    designs.push(
      await createOrder(prepared[i], {
        // 1点だけなら受付番号そのまま、複数なら「受付番号-1」「-2」…
        orderId: prepared.length === 1 ? groupId : `${groupId}-${i + 1}`,
        groupId,
        index: i + 1,
        count: prepared.length,
        customer,
      }),
    );
  }

  return NextResponse.json({
    groupId,
    designs,
    total: sumEstimates(designs.map((d) => d.estimate)),
  });
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}
