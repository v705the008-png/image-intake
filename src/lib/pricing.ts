import {
  OPTIONS,
  getProduct,
  hasBleedOption,
  hasUpscaleOption,
  resolveSize,
  yen,
  type Orientation,
  type ProductId,
  type StickerFinish,
  type StickerShape,
} from './products';

/**
 * 印刷費の概算。
 *
 * 金額はすべて税別（本体）で持ち、消費税は最後に 10% を別で乗せる（税込で丸めない）。
 * ここの数字を書き換えれば、お客さんの画面・確認画面・完了画面・管理画面の見積もりがすべて追従する。
 *
 * 確定値  : タペストリー 1000×2400mm ¥15,000（ほかのサイズは面積で比例） ／ A1 ポスター（PP加工）¥3,500
 * 仮置き  : A2・A3 ポスター、ポスターの自由サイズ、タペストリーの下限、ステッカー一式（相場の中央値〜やや上で設定）
 */

export const TAX_RATE = 0.1;
export const MAX_QUANTITY = 1000;
/** 1回の注文でお預かりできるデザインの数 */
export const MAX_DESIGNS = 20;

/** ポスター1枚あたりの印刷費（税別）。サイズ ID ごと。向き（縦横）では変わらない */
const UNIT_PRICE_BY_SIZE: Record<string, number> = {
  a1: 3500, // PP加工込み（確定）
  a2: 2500, // 仮
  a3: 1800, // 仮
};

/** ポスターの自由サイズは、A1 との面積比で概算する */
const POSTER_CUSTOM = { areaMm2: 594 * 841, yen: 3500, minYen: 1800 };

// ── タペストリー ─────────────────────────────

/**
 * タペストリーの印刷費は面積で決める。
 * 大判プリント専門店の相場（ターポリン・上下袋＋ハトメ）の「面積に対する伸び方」を使い、
 * 1000×2400mm がちょうど ¥15,000 になるよう全体を同じ倍率で合わせてある（確定値はこの1点）。
 * 参考点のあいだは直線でつなぎ、外側は端の傾きのまま伸ばす。
 */
const TAPESTRY_REFERENCE: { areaM2: number; yen: number }[] = [
  { areaM2: 1.0 * 2.1, yen: 8920 / 1.1 }, // 100×210cm ¥8,920（税込）
  { areaM2: 1.0 * 2.4, yen: 10140 / 1.1 }, // 100×240cm ¥10,140（税込）
  { areaM2: 1.8 * 2.6, yen: 19140 / 1.1 }, // 180×260cm ¥19,140（税込）
];
const TAPESTRY_ANCHOR = { widthMm: 1000, heightMm: 2400, yen: 15000 };
/** 小さいサイズでも生地・縫製・ハトメの手間はかかるので、下限を設ける（仮） */
const TAPESTRY_MIN_YEN = 5000;

function interpolate(points: { areaM2: number; yen: number }[], area: number) {
  let k = points.findIndex((_, idx) => idx < points.length - 1 && area <= points[idx + 1].areaM2);
  if (k < 0) k = points.length - 2;
  const a = points[k];
  const b = points[k + 1];
  return a.yen + ((b.yen - a.yen) * (area - a.areaM2)) / (b.areaM2 - a.areaM2);
}

/** タペストリー1枚の印刷費（税別・100円単位） */
export function tapestryPriceYen(widthMm: number, heightMm: number) {
  const areaOf = (w: number, h: number) => (w * h) / 1_000_000;
  const scale = TAPESTRY_ANCHOR.yen / interpolate(TAPESTRY_REFERENCE, areaOf(TAPESTRY_ANCHOR.widthMm, TAPESTRY_ANCHOR.heightMm));
  const yenRaw = interpolate(TAPESTRY_REFERENCE, areaOf(widthMm, heightMm)) * scale;
  return Math.max(TAPESTRY_MIN_YEN, Math.round(yenRaw / 100) * 100);
}

// ── ステッカー ───────────────────────────────

/** 100mm角を基準にした1枚あたりの単価。枚数が多いほど安い（上から順に判定） */
const STICKER_TIERS: { minQty: number; yen: number }[] = [
  { minQty: 300, yen: 85 },
  { minQty: 100, yen: 120 },
  { minQty: 50, yen: 160 },
  { minQty: 30, yen: 220 },
  { minQty: 10, yen: 300 },
  { minQty: 1, yen: 450 },
];

/** 少量でもカット設定などの手間は同じなので、ステッカー印刷費には最低料金を設ける */
const STICKER_MIN_YEN = 2000;

type StickerChoice<T> = {
  id: T;
  label: string;
  note: string;
  /** ステッカー1枚あたりの加算（税別）。0 は無料 */
  perPieceYen: number;
};

/** 仕上がり。1シートに何枚並べるかは、サイズや形に合わせてこちらで決める（お客さんには選ばせない） */
export const STICKER_FINISHES: StickerChoice<StickerFinish>[] = [
  {
    id: 'sheet',
    label: '1シートに複数枚',
    note: '1枚の台紙にまとめて並べてお作りします。1シートに入る数は、サイズや形に合わせてこちらで調整します。',
    perPieceYen: 0,
  },
  {
    id: 'single',
    label: '1枚ずつカット',
    note: '1枚ずつ切り離した状態でお届けします。',
    perPieceYen: 30,
  },
];

/** 形状 */
export const STICKER_SHAPES: StickerChoice<StickerShape>[] = [
  { id: 'rect', label: '四角形', note: '仕上がりサイズの四角形で切ります。', perPieceYen: 0 },
  { id: 'round', label: '丸型', note: '仕上がりサイズに収まる丸（楕円）で切ります。', perPieceYen: 0 },
  { id: 'free', label: '自由カット', note: '絵柄のふちに沿った形で切ります。', perPieceYen: 30 },
];
export const QUANTITY_PRESETS: Record<ProductId, number[]> = {
  sticker: [10, 30, 50, 100, 300],
  poster: [1, 2, 5, 10],
  tapestry: [1, 2, 3],
};

export const clampQuantity = (q: unknown) => {
  const n = Math.floor(Number(q));
  return Number.isFinite(n) ? Math.min(MAX_QUANTITY, Math.max(1, n)) : 1;
};
/** 旧形式の値（ハーフカット→シート、台紙カット→1枚ずつ）も読めるようにしておく */
export const validFinish = (f: unknown): StickerFinish => (f === 'single' || f === 'diecut' ? 'single' : 'sheet');
export const validShape = (s: unknown): StickerShape =>
  STICKER_SHAPES.some((x) => x.id === s) ? (s as StickerShape) : 'rect';

/** 面積による係数（100mm角 = 1） */
function stickerSizeFactor(areaMm2: number) {
  const a = areaMm2 / 10000;
  if (a <= 0.25) return 0.6;
  if (a <= 0.5) return 0.8;
  if (a <= 1) return 1;
  if (a <= 2.25) return 1.5;
  return Math.round(a * 0.7 * 10) / 10;
}

const stickerTierYen = (qty: number) =>
  (STICKER_TIERS.find((t) => qty >= t.minQty) ?? STICKER_TIERS[STICKER_TIERS.length - 1]).yen;
const round10 = (n: number) => Math.round(n / 10) * 10;

// ── 見積もり ───────────────────────────────

export type EstimateInput = {
  productId: ProductId;
  sizeId: string;
  orientation?: Orientation;
  customWidthMm?: number;
  customHeightMm?: number;
  quantity?: number;
  stickerFinish?: StickerFinish;
  stickerShape?: StickerShape;
  bleedOption?: boolean;
  upscaleOption?: boolean;
  paidOption?: boolean;
};

export type EstimateLine = { label: string; detail?: string; yen: number };

export type Estimate = {
  lines: EstimateLine[];
  subtotalYen: number;
  taxYen: number;
  totalYen: number;
  notes: string[];
};

/** 仕上がりサイズが決まっていなければ null */
export function estimate(input: EstimateInput): Estimate | null {
  const size = resolveSize(input);
  if (!size) return null;
  const product = getProduct(input.productId);
  // タペストリーは 1デザイン＝1枚
  const qty = product.id === 'tapestry' ? 1 : clampQuantity(input.quantity);
  const lines: EstimateLine[] = [];
  const notes: string[] = [];

  if (product.id === 'sticker') {
    const finish = STICKER_FINISHES.find((f) => f.id === validFinish(input.stickerFinish)) ?? STICKER_FINISHES[0];
    const shape = STICKER_SHAPES.find((s) => s.id === validShape(input.stickerShape)) ?? STICKER_SHAPES[0];
    // 単価の段階はステッカーの枚数で決める。1シートに何枚並ぶかはこちらで決めるので金額には影響させない
    const unit = round10(stickerTierYen(qty) * stickerSizeFactor(size.widthMm * size.heightMm));
    let printYen = unit * qty;
    if (printYen < STICKER_MIN_YEN) {
      printYen = STICKER_MIN_YEN;
      notes.push(`ステッカーの印刷費は最低料金 ${yen(STICKER_MIN_YEN)} からです`);
    }
    lines.push({
      label: `ステッカー印刷（${shape.label}・${finish.label}）`,
      detail: `${size.label}・${qty}枚（${yen(unit)}/枚）`,
      yen: printYen,
    });
    // 有料の加工（1枚ずつカット・自由カット）は、何にいくらかかるか分かるよう行を分ける
    for (const extra of [finish, shape]) {
      if (extra.perPieceYen > 0) {
        lines.push({ label: extra.label, detail: `${yen(extra.perPieceYen)} × ${qty}枚`, yen: extra.perPieceYen * qty });
      }
    }
    if (Math.max(size.widthMm, size.heightMm) > 150) {
      notes.push('150mmを超えるステッカーは、素材や加工によって金額が変わる場合があります');
    }
  } else {
    let unit: number;
    if (product.id === 'tapestry') {
      unit = tapestryPriceYen(size.widthMm, size.heightMm);
      if (input.sizeId === 'custom') notes.push('自由サイズの印刷費は、面積からの概算です');
    } else {
      unit = UNIT_PRICE_BY_SIZE[input.sizeId];
      if (input.sizeId === 'custom' || unit === undefined) {
        unit = Math.max(
          POSTER_CUSTOM.minYen,
          Math.round((POSTER_CUSTOM.yen * size.widthMm * size.heightMm) / POSTER_CUSTOM.areaMm2 / 100) * 100,
        );
        notes.push('自由サイズの印刷費は、面積からの概算です');
      }
    }
    const label = product.id === 'poster' ? 'ポスター印刷（PP加工）' : 'タペストリー印刷';
    lines.push({ label, detail: `${size.label}・${qty}枚（${yen(unit)}/枚）`, yen: unit * qty });
  }

  if (hasBleedOption(input)) lines.push({ label: OPTIONS.bleed.label, yen: OPTIONS.bleed.priceYen });
  if (hasUpscaleOption(input)) lines.push({ label: OPTIONS.upscale.label, yen: OPTIONS.upscale.priceYen });

  const subtotalYen = lines.reduce((s, l) => s + l.yen, 0);
  const taxYen = Math.floor(subtotalYen * TAX_RATE);
  return { lines, subtotalYen, taxYen, totalYen: subtotalYen + taxYen, notes };
}

export type EstimateTotal = { subtotalYen: number; taxYen: number; totalYen: number };

/** 複数デザインの見積もりをまとめる。消費税は合計の小計に対して1回だけ計算する（端数の積み上がりを防ぐ） */
export function sumEstimates(list: (Estimate | null | undefined)[]): EstimateTotal {
  const subtotalYen = list.reduce((s, e) => s + (e?.subtotalYen ?? 0), 0);
  const taxYen = Math.floor(subtotalYen * TAX_RATE);
  return { subtotalYen, taxYen, totalYen: subtotalYen + taxYen };
}
