import fsp from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString, cmyk, rgb } from 'pdf-lib';

/**
 * トンボ（角トンボ＋センタートンボ）付きの入稿用PDFを作る。
 *
 * 日本の印刷所で使う二重トンボの形に合わせてある。
 *  - 内側の線 = 仕上がり位置（ここで断裁される）
 *  - 外側の線 = 塗り足しの端
 * 線はレジストレーション（CMYK各100%）で引く。
 *
 * 画像も CMYK の JPEG を埋め込むので、PDF 全体が CMYK で統一される
 * （RGB 画像と CMYK の線が混在すると Acrobat / Illustrator で警告が出るため）。
 * 使った ICC は出力インテントとして PDF に書き込み、仕上がり枠・塗り足し枠も設定する。
 */

const MM_PER_INCH = 25.4;
const mm = (v: number) => (v / MM_PER_INCH) * 72;

/** トンボの線の長さ（mm）。日本の印刷所の慣習でおおむね10mm。 */
const MARK_LEN_MM = 10;
/** 線幅（pt）。約0.1mm。 */
const MARK_WEIGHT_PT = 0.3;

const REGISTRATION = cmyk(1, 1, 1, 1);
/** RGB 入稿のときのトンボの色。CMYK を混ぜると Acrobat で「色空間の混在」警告が出るため */
const RGB_BLACK = rgb(0, 0, 0);

export type CropMarkArgs = {
  /** 塗り足しまで含めた CMYK の JPEG。PDF にはこのバイト列をそのまま埋め込む。 */
  jpegPath: string;
  outPath: string;
  /** 仕上がりサイズ（mm） */
  trimWmm: number;
  trimHmm: number;
  /** 片側の塗り足し（mm） */
  bleedMm: number;
  /** 変換に使った CMYK の ICC。あれば出力インテントとして埋め込む */
  iccPath?: string | null;
  /** 出力条件の名前（例: Japan Color 2001 Coated） */
  outputCondition?: string;
  /** false ならトンボを付けず、紙面＝仕上がりサイズの PDF にする（高画質化のみの案件用） */
  marks?: boolean;
  /** 埋め込む画像の色。RGB なら線も RGB にして、色空間の混在を避ける */
  colorMode?: 'RGB' | 'CMYK';
};

export type CropMarkResult = {
  bytes: number;
  pageWidthMm: number;
  pageHeightMm: number;
  markLengthMm: number;
  outputIntent: boolean;
};

export async function buildCropMarkPdf(args: CropMarkArgs): Promise<CropMarkResult> {
  const { jpegPath, outPath, trimWmm, trimHmm, bleedMm, iccPath, outputCondition, marks = true, colorMode = 'CMYK' } = args;
  const markColor = colorMode === 'RGB' ? RGB_BLACK : REGISTRATION;
  const L = marks ? MARK_LEN_MM : 0;
  // 塗り足しの外側にトンボを置くぶんの余白
  const pad = bleedMm + L;

  const pageWmm = trimWmm + pad * 2;
  const pageHmm = trimHmm + pad * 2;

  const doc = await PDFDocument.create();
  doc.setTitle(`入稿データ（${marks ? 'トンボ付き / ' : ''}${colorMode}）`);
  doc.setProducer('image-intake');
  const page = doc.addPage([mm(pageWmm), mm(pageHmm)]);

  // 仕上がり枠と塗り足し枠。Acrobat や印刷所のプリフライトがこれを読む
  page.setTrimBox(mm(pad), mm(pad), mm(trimWmm), mm(trimHmm));
  page.setBleedBox(mm(L), mm(L), mm(trimWmm + bleedMm * 2), mm(trimHmm + bleedMm * 2));

  // 画像は塗り足しの矩形いっぱいに置く
  const jpeg = await doc.embedJpg(await fsp.readFile(jpegPath));
  page.drawImage(jpeg, {
    x: mm(L),
    y: mm(L),
    width: mm(trimWmm + bleedMm * 2),
    height: mm(trimHmm + bleedMm * 2),
  });

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({
      start: { x: mm(x1), y: mm(y1) },
      end: { x: mm(x2), y: mm(y2) },
      thickness: MARK_WEIGHT_PT,
      color: markColor,
    });

  if (marks) {
    // ── 角トンボ（4隅） ──────────────────────────
    // sx / sy は「外側はどちらか」を表す（-1 = 左/下、+1 = 右/上）
    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const trimX = sx < 0 ? pad : pad + trimWmm;
      const trimY = sy < 0 ? pad : pad + trimHmm;
      const bleedX = trimX + sx * bleedMm;
      const bleedY = trimY + sy * bleedMm;

      // 縦の断裁位置を示す2本（塗り足しの外へ伸ばす）
      line(trimX, bleedY, trimX, bleedY + sy * L);
      line(bleedX, bleedY, bleedX, bleedY + sy * L);
      // 横の断裁位置を示す2本
      line(bleedX, trimY, bleedX + sx * L, trimY);
      line(bleedX, bleedY, bleedX + sx * L, bleedY);
    }

    // ── センタートンボ（各辺の中央） ───────────────
    const cx = pad + trimWmm / 2;
    const cy = pad + trimHmm / 2;
    const tick = L * 0.35;

    for (const sy of [1, -1] as const) {
      const base = sy > 0 ? pad + trimHmm + bleedMm : pad - bleedMm;
      line(cx, base, cx, base + sy * L);
      line(cx - tick, base + sy * (L / 2), cx + tick, base + sy * (L / 2));
    }
    for (const sx of [1, -1] as const) {
      const base = sx > 0 ? pad + trimWmm + bleedMm : pad - bleedMm;
      line(base, cy, base + sx * L, cy);
      line(base + sx * (L / 2), cy - tick, base + sx * (L / 2), cy + tick);
    }
  }

  // ── 出力インテント（どの印刷条件の CMYK かを PDF に明記） ──
  let outputIntent = false;
  if (iccPath) {
    const icc = await fsp.readFile(iccPath);
    const iccRef = doc.context.register(doc.context.flateStream(icc, { N: colorMode === 'RGB' ? 3 : 4 }));
    const name = outputCondition ?? colorMode;
    const intent = doc.context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFX',
      OutputConditionIdentifier: PDFString.of(name),
      Info: PDFString.of(name),
      RegistryName: PDFString.of('http://www.color.org'),
      DestOutputProfile: iccRef,
    });
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
    outputIntent = true;
  }

  const bytes = await doc.save();
  await fsp.writeFile(outPath, bytes);

  return {
    bytes: bytes.length,
    pageWidthMm: Math.round(pageWmm * 10) / 10,
    pageHeightMm: Math.round(pageHmm * 10) / 10,
    markLengthMm: L,
    outputIntent,
  };
}
