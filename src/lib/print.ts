import { FitMode, Product, SizePreset } from './products';

export const MM_PER_INCH = 25.4;

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / MM_PER_INCH) * dpi);
export const pxToMm = (px: number, dpi: number) => (px / dpi) * MM_PER_INCH;

export type Verdict = 'ideal' | 'ok' | 'low' | 'ng';

export type Judgement = {
  /** 指定サイズいっぱいに使ったときの実効解像度（dpi） */
  effectiveDpi: number;
  verdict: Verdict;
  /** お客さんに見せる一行 */
  headline: string;
  /** 補足 */
  detail: string;
};

/**
 * 指定の仕上がりサイズで印刷したときに、その画像が何dpi相当になるかを出す。
 * cover（全面）のときは短辺基準、contain（余白あり）のときは長辺基準になる。
 */
export function effectiveDpi(
  imgW: number,
  imgH: number,
  size: SizePreset,
  fit: FitMode,
): number {
  const targetWIn = size.widthMm / MM_PER_INCH;
  const targetHIn = size.heightMm / MM_PER_INCH;
  const dpiW = imgW / targetWIn;
  const dpiH = imgH / targetHIn;
  // cover は拡大率が大きいほう（=dpiが低いほう）に引っ張られる
  return fit === 'cover' ? Math.min(dpiW, dpiH) : Math.max(dpiW, dpiH);
}

export function judge(
  imgW: number,
  imgH: number,
  product: Product,
  size: SizePreset,
  fit: FitMode,
): Judgement {
  const dpi = effectiveDpi(imgW, imgH, size, fit);
  const r = Math.round(dpi);

  if (dpi >= product.idealDpi) {
    return {
      effectiveDpi: r,
      verdict: 'ideal',
      headline: 'このサイズなら、くっきりきれいに刷れます',
      detail: `${size.label.split('（')[0]}で ${r}dpi 相当。${product.label}に十分な画質です。`,
    };
  }
  if (dpi >= product.minDpi * 1.15) {
    return {
      effectiveDpi: r,
      verdict: 'ok',
      headline: 'このサイズなら問題なく刷れます',
      detail: `${r}dpi 相当。近づくと少しやわらかく見えますが、${product.label}としては十分です。`,
    };
  }
  if (dpi >= product.minDpi) {
    return {
      effectiveDpi: r,
      verdict: 'low',
      headline: 'ぎりぎりです。ひとまわり小さいサイズが安心です',
      detail: `${r}dpi 相当。細い線や小さい文字がにじむ可能性があります。`,
    };
  }
  return {
    effectiveDpi: r,
    verdict: 'ng',
    headline: `キレイに印刷できない可能性があります（${r}dpi相当）`,
    detail:
      'ぼやけたり、絵柄が荒くうつる可能性があります。キレイに印刷するには画像を変更するか、高画質化オプションを検討してください。',
  };
}

/**
 * 解像度の判定に使う画素数。
 * 画像はそのまま。PDF は「埋め込み画像の解像度で紙面全体を画像にしたら何画素か」に換算する
 * （紙面サイズは pt、72pt = 1inch。紙面を仕上がりサイズへ拡大すると、中の画像も同じ倍率で拡大されるため）。
 * 判定できない PDF（ベクター中心・読めなかった）は null。
 */
export function judgePixels(
  meta: { width: number; height: number; pdf?: { ppi: number | null } },
  isPdf: boolean,
): { w: number; h: number } | null {
  if (meta.width <= 0 || meta.height <= 0) return null;
  if (!isPdf) return { w: meta.width, h: meta.height };
  const ppi = meta.pdf?.ppi;
  if (!ppi) return null;
  return { w: (meta.width * ppi) / 72, h: (meta.height * ppi) / 72 };
}

/** この画像なら、その商品で最大どのサイズまでいけるか */
export function maxRecommendedSize(
  imgW: number,
  imgH: number,
  product: Product,
  fit: FitMode = 'cover',
): SizePreset | null {
  const okSizes = product.sizes.filter(
    (s) => effectiveDpi(imgW, imgH, s, fit) >= product.idealDpi,
  );
  if (okSizes.length === 0) return null;
  return okSizes.reduce((a, b) =>
    a.widthMm * a.heightMm >= b.widthMm * b.heightMm ? a : b,
  );
}

/** 画像そのものを実寸に直すと何mmか（指定dpiで） */
export function physicalSizeMm(imgW: number, imgH: number, dpi: number) {
  return {
    widthMm: Math.round(pxToMm(imgW, dpi)),
    heightMm: Math.round(pxToMm(imgH, dpi)),
  };
}

export type PrintPlan = {
  /** 塗り足しまで含めた最終ピクセル数 */
  canvasW: number;
  canvasH: number;
  /** 仕上がり（裁ち落とし後）のピクセル数 */
  trimW: number;
  trimH: number;
  /** 片側の塗り足しピクセル数 */
  bleedPx: number;
  dpi: number;
};

export function buildPrintPlan(
  size: SizePreset,
  bleedMm: number,
  dpi: number,
): PrintPlan {
  const trimW = mmToPx(size.widthMm, dpi);
  const trimH = mmToPx(size.heightMm, dpi);
  const bleedPx = mmToPx(bleedMm, dpi);
  return {
    trimW,
    trimH,
    bleedPx,
    canvasW: trimW + bleedPx * 2,
    canvasH: trimH + bleedPx * 2,
    dpi,
  };
}

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const formatPx = (n: number) => n.toLocaleString('ja-JP');
