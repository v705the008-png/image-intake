// 取り扱い商品と仕上がりサイズの定義。
// ここを書き換えるだけで、お客さん側の選択肢も入稿データの生成も追従します。

export type ProductId = 'tapestry' | 'poster' | 'sticker';

/** 入稿データの色（rgb = 変換しない / cmyk = オフセット印刷用に変換） */
export type ColorMode = 'rgb' | 'cmyk';

/** ステッカーの仕上がり（1シートに複数枚 / 1枚ずつカット）。金額と説明は pricing.ts */
export type StickerFinish = 'sheet' | 'single';
/** ステッカーの形状（四角形 / 丸型 / 自由カット）。金額と説明は pricing.ts */
export type StickerShape = 'rect' | 'round' | 'free';

export type SizePreset = {
  id: string;
  label: string;
  /** 仕上がりサイズ（mm）。裁ち落とし後の寸法。 */
  widthMm: number;
  heightMm: number;
};

export type Product = {
  id: ProductId;
  label: string;
  /** 一言説明（お客さん向け） */
  note: string;
  /** 入稿データを作るときの解像度（dpi）。大判ほど低くてよい。 */
  outputDpi: number;
  /** これ以上あれば「きれい」と言える実効解像度（dpi） */
  idealDpi: number;
  /** これを下回ると印刷に耐えない（dpi） */
  minDpi: number;
  /** 標準の塗り足し幅（mm） */
  defaultBleedMm: number;
  /** 最初に選ばれているサイズ */
  defaultSizeId: string;
  /**
   * 入稿データの色。
   * 'rgb' = sRGB のまま渡す（自社の Epson SC-S80650 など大判インクジェット。RIP 側で変換するので色域を活かせる）
   * 'cmyk' = オフセット印刷向けに CMYK へ変換する
   * 環境変数 PRINT_COLOR_MODE で上書きできる
   */
  colorMode: ColorMode;
  sizes: SizePreset[];
};

export const PRODUCTS: Product[] = [
  {
    id: 'tapestry',
    label: 'タペストリー',
    note: '布に印刷。少し離れて見るので、100〜150dpi あればきれいに出ます。',
    outputDpi: 150,
    idealDpi: 150,
    minDpi: 100,
    defaultBleedMm: 10,
    defaultSizeId: 'tap-1000x2100',
    colorMode: 'rgb',
    sizes: [
      { id: 'tap-1000x2100', label: '1000 × 2100 mm', widthMm: 1000, heightMm: 2100 },
      { id: 'tap-1000x2300', label: '1000 × 2300 mm', widthMm: 1000, heightMm: 2300 },
      { id: 'tap-1000x2400', label: '1000 × 2400 mm', widthMm: 1000, heightMm: 2400 },
    ],
  },
  {
    id: 'poster',
    label: 'ポスター',
    note: '紙に印刷。壁に貼って見る想定の解像度で判定します。',
    outputDpi: 300,
    idealDpi: 200,
    minDpi: 120,
    defaultBleedMm: 3,
    defaultSizeId: 'a1',
    colorMode: 'rgb',
    sizes: [
      { id: 'a3', label: 'A3（297 × 420 mm）', widthMm: 297, heightMm: 420 },
      { id: 'a2', label: 'A2（420 × 594 mm）', widthMm: 420, heightMm: 594 },
      { id: 'a1', label: 'A1（594 × 841 mm）', widthMm: 594, heightMm: 841 },
    ],
  },
  {
    id: 'sticker',
    label: 'ステッカー',
    note: '手に取って近くで見るので、いちばん高い解像度が必要です。',
    outputDpi: 350,
    idealDpi: 300,
    minDpi: 200,
    defaultBleedMm: 3,
    defaultSizeId: 'st-100',
    colorMode: 'rgb',
    sizes: [
      { id: 'st-50', label: '50 × 50 mm', widthMm: 50, heightMm: 50 },
      { id: 'st-70', label: '70 × 70 mm', widthMm: 70, heightMm: 70 },
      { id: 'st-100', label: '100 × 100 mm', widthMm: 100, heightMm: 100 },
      { id: 'st-90x50', label: '90 × 50 mm（名刺サイズ）', widthMm: 90, heightMm: 50 },
      { id: 'st-150x100', label: '150 × 100 mm', widthMm: 150, heightMm: 100 },
    ],
  },
];

export function getProduct(id: ProductId): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown product: ${id}`);
  return p;
}

/** 有料オプション（税別・円）。価格や説明はここだけ変えれば、画面・合計・管理画面に反映される */
export type OptionId = 'bleed' | 'upscale';

export const OPTIONS: Record<OptionId, { label: string; priceYen: number; description: string }> = {
  bleed: {
    label: '塗り足し・トンボ作成',
    priceYen: 2500,
    description:
      'ふちまで絵柄が届くよう塗り足しを入れ、トンボ（断裁位置の目印）を付けた印刷用データに仕上げます。仕上がりサイズと比率が合わない場合も、絵柄は切らずに足りない部分を描き足します。',
  },
  upscale: {
    label: '高画質化',
    priceYen: 2500,
    description: '仕上がりサイズに合わせて解像度を引き上げ、ぼやけや絵柄の荒れを抑えます。',
  },
};

type OptionFlags = { bleedOption?: boolean; upscaleOption?: boolean; paidOption?: boolean };
/** 旧形式（paidOption = 2つがセットだった頃）の案件も同じ判定で読めるようにしている */
export const hasBleedOption = (o: OptionFlags) => Boolean(o.bleedOption ?? o.paidOption);
export const hasUpscaleOption = (o: OptionFlags) => Boolean(o.upscaleOption ?? o.paidOption);
export const hasAnyOption = (o: OptionFlags) => hasBleedOption(o) || hasUpscaleOption(o);
export const optionTotalYen = (o: OptionFlags) =>
  (hasBleedOption(o) ? OPTIONS.bleed.priceYen : 0) + (hasUpscaleOption(o) ? OPTIONS.upscale.priceYen : 0);
export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/** 実際に使う色モード（環境変数が優先） */
export function colorModeFor(product: Product): ColorMode {
  const env = (process.env.PRINT_COLOR_MODE ?? '').trim().toLowerCase();
  if (env === 'rgb' || env === 'cmyk') return env;
  return product.colorMode;
}

/**
 * 仕上がりサイズの中で、原本の絵柄（切らずに収めたとき）が占める割合。比率が同じなら 1。
 * 例: 2:3 の画像 → 1000×2100mm は 0.71、→ 1000×2400mm は 0.63。
 */
export function artCoverage(imgW: number, imgH: number, trimWmm: number, trimHmm: number) {
  const a = imgW / imgH;
  const b = trimWmm / trimHmm;
  return Math.min(a / b, b / a);
}

/**
 * AI で描き足して仕上げてよい下限（微調整の範囲）。これ未満は「大きな再レイアウト」とみなし、
 * 自動では処理せず原本のまま手作業に回す。基準はたこ焼きのタペストリー（0.71）が自動で通ること。
 */
export const AI_EXPAND_MIN_COVERAGE = 0.7;

/** 塗り足しの埋め方 */
export type BleedMode = 'mirror' | 'extend' | 'color';

/** 絵柄を仕上がり比率に合わせる方法 */
export type FitMode = 'cover' | 'contain';

export const FIT_MODES: { id: FitMode; label: string; note: string; noteWithBleed: string }[] = [
  {
    id: 'cover',
    label: '縁なし',
    note: 'ふちまで絵柄が入ります。比率が違うぶんは、上下または左右がすこし切れます。裁断後にふちがわずかに白く残ることがあるので、「塗り足し・トンボ作成」オプションもご検討ください。',
    noteWithBleed: 'ふちまで絵柄が入ります。比率が違うぶんは、上下または左右がすこし切れます。「塗り足し・トンボ作成」オプションで、ふちまでキレイに仕上げます。',
  },
  {
    id: 'contain',
    label: '縁あり',
    note: '絵柄が一切切れません。かわりに上下または左右に白い余白（縁）が入ります。',
    noteWithBleed: '絵柄が一切切れません。上下または左右の余白（縁）ごと、塗り足しを付けて仕上げます。',
  },
];

export type Orientation = 'portrait' | 'landscape';

/**
 * プリセットは縦向きで定義してある。横向きが選ばれたら縦横を入れ替える。
 * 正方形のサイズは向きの概念がないのでそのまま返す。
 */
export function applyOrientation(size: SizePreset, o: Orientation): SizePreset {
  if (size.widthMm === size.heightMm) return size;
  const wantLandscape = o === 'landscape';
  const isLandscape = size.widthMm > size.heightMm;
  if (wantLandscape === isLandscape) return size;
  return {
    ...size,
    widthMm: size.heightMm,
    heightMm: size.widthMm,
    // 「A2（420 × 594 mm）」でも「1000 × 2100 mm」でも数字を入れ替える
    label: size.label.replace(
      /(\d+)(\s*×\s*)(\d+)(\s*mm)/,
      (_m, a: string, mid: string, b: string, tail: string) => `${b}${mid}${a}${tail}`,
    ),
  };
}

export const isSquare = (size: SizePreset) => size.widthMm === size.heightMm;

/**
 * 商品・サイズ指定から実際の仕上がりサイズを求める（受付・管理画面・生成で共通）。
 * 不正な指定は null を返す。
 */
export function resolveSize(o: {
  productId: ProductId;
  sizeId: string;
  orientation?: Orientation;
  customWidthMm?: number;
  customHeightMm?: number;
}): SizePreset | null {
  const product = getProduct(o.productId);
  if (o.sizeId === 'custom') {
    const w = Number(o.customWidthMm);
    const h = Number(o.customHeightMm);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 10 || h < 10 || w > 3000 || h > 3000) {
      return null;
    }
    return { id: 'custom', label: `${w} × ${h} mm`, widthMm: w, heightMm: h };
  }
  const preset = product.sizes.find((s) => s.id === o.sizeId);
  return preset ? applyOrientation(preset, o.orientation ?? 'portrait') : null;
}
