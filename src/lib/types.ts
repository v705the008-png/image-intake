import type { Estimate } from './pricing';
import type { BleedMode, FitMode, Orientation, ProductId, StickerFinish, StickerShape } from './products';

export type ImageMeta = {
  width: number;
  height: number;
  format: string;
  bytes: number;
  hasAlpha: boolean;
  /** 元ファイルに埋め込まれていた解像度（あれば） */
  density?: number;
  /** PDF のときのページ数 */
  pageCount?: number;
  /** PDF のとき：1ページ目に埋め込まれた画像の解像度（自動で読めたときだけ） */
  pdf?: PdfRaster;
};

export type PdfRaster = {
  /** ページに描かれている画像の数（0 ならベクターだけの PDF） */
  imageCount: number;
  /**
   * 紙面の 15% 以上を占める画像のうち、いちばん低い解像度（PDF の紙面サイズで印刷したときの ppi）。
   * 大きな画像が無い（文字や図形が中心の）PDF は null
   */
  ppi: number | null;
  /** その大きな画像が紙面を占める割合（0〜1） */
  coverage: number;
};

export type OrderOptions = {
  productId: ProductId;
  sizeId: string;
  /** 縦向き / 横向き（プリセットは縦向きで定義してある） */
  orientation: Orientation;
  /** カスタムサイズを使う場合 */
  customWidthMm?: number;
  customHeightMm?: number;
  fit: FitMode;
  /** 有料オプション「塗り足し・トンボ作成」 */
  bleedOption: boolean;
  /** 有料オプション「高画質化」 */
  upscaleOption: boolean;
  /** 旧形式（2つのオプションがセットだった頃）。古い案件の読み込み専用 */
  paidOption?: boolean;
  /** 枚数（ステッカーは枚数。1シートに何枚並べるかはこちらで決める） */
  quantity: number;
  /** ステッカーの仕上がり（1シートに複数枚 / 1枚ずつカット） */
  stickerFinish?: StickerFinish;
  /** ステッカーの形状（四角形 / 丸型 / 自由カット） */
  stickerShape?: StickerShape;
  /** 以下は運用側の既定値。お客さんの画面には出さない。 */
  bleedMm: number;
  bleedMode: BleedMode;
  bleedColor: string;
  padColor: string;
};

/** 管理側で使える比率の合わせかた。expand = AI で描き足す（お客さんの画面には出さない） */
export type AdjustFit = FitMode | 'expand';

/**
 * 受付後に管理画面で変えた仕上げ設定。
 * お客さんの指定（options）は書き換えずに残し、生成時にこちらを上書きで重ねる。
 */
export type OrderAdjust = {
  productId?: ProductId;
  sizeId?: string;
  orientation?: Orientation;
  customWidthMm?: number;
  customHeightMm?: number;
  fit?: AdjustFit;
  /** トリミングで残す位置（0=左/上, 0.5=中央, 1=右/下） */
  focusX?: number;
  focusY?: number;
  bleedMm?: number;
  bleedMode?: BleedMode;
  bleedColor?: string;
  padColor?: string;
  updatedAt?: string;
};

export type CustomerInfo = {
  name: string;
  contact: string;
  note: string;
};

export type OrderFile = {
  /** 保存されたファイル名 */
  filename: string;
  bytes: number;
  /** source = 原本のサムネイル（処理しても上書きしない） */
  kind: 'original' | 'source' | 'print' | 'printPdf' | 'preview';
  label: string;
};

export type Order = {
  id: string;
  /** 同じ注文でまとめて送られたデザインの受付番号（お客さんに見せる番号）。1点だけなら id と同じ */
  groupId?: string;
  /** 注文の中で何点目か（1始まり）と、注文の点数 */
  designIndex?: number;
  designCount?: number;
  createdAt: string;
  originalName: string;
  meta: ImageMeta;
  options: OrderOptions;
  customer: CustomerInfo;
  files: OrderFile[];
  /** 判定結果のスナップショット（受付時点） */
  judgement: {
    effectiveDpi: number;
    verdict: string;
    headline: string;
  };
  /** 申し込まれた有料オプションの金額（税別・円）。未申込は 0。 */
  optionPriceYen: number;
  /** 受付時点の見積もり（サーバーで計算。印刷費＋オプション、税別と税込） */
  estimate?: Estimate;
  /** 管理画面での仕上げ調整 */
  adjust?: OrderAdjust;
  /** 入稿データ生成の状態。受付は先に済ませ、生成は裏で動かす。 */
  print?: {
    /** pending=処理待ち/処理中, done=完了, failed=失敗, skipped=対象外 */
    status: 'pending' | 'done' | 'failed' | 'skipped';
    /** skipped の理由。relayout = 比率の差が大きく、自動では処理せず手作業の再レイアウトに回した */
    reason?: 'no-option' | 'pdf' | 'relayout';
    /** 仕上がりサイズのうち原本の絵柄が占める割合（relayout の判定に使った値） */
    coverage?: number;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    canvasW?: number;
    canvasH?: number;
    trimW?: number;
    trimH?: number;
    bleedPx?: number;
    dpi?: number;
    /** 実際に使った比率の合わせかた */
    fit?: AdjustFit;
    /** トンボ付きPDFの紙面サイズ（mm） */
    pageWidthMm?: number;
    pageHeightMm?: number;
    /** Upscayl による拡大の記録 */
    upscale?: {
      used: boolean;
      scale?: number;
      model?: string;
      seconds?: number;
      note?: string;
    };
    /** AI による描き足しの記録 */
    expand?: {
      used: boolean;
      provider?: string;
      seconds?: number;
      workW?: number;
      workH?: number;
      note?: string;
    };
    /** トンボ付きPDFのカラー */
    colour?: {
      mode: 'CMYK' | 'RGB';
      profile: string;
      outputIntent: boolean;
    };
  };
};
