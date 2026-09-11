import fsp from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { inspectPdfRaster } from './pdfInspect';
import type { PrintPlan } from './print';
import type { BleedMode, FitMode } from './products';
import type { ImageMeta } from './types';

sharp.cache(false);
// 大判の入稿データを扱うので、既定のピクセル数上限を外す
const LIMIT = { limitInputPixels: false as const };

const PT_PER_INCH = 72;

/** pdf-lib で開けない PDF 用：ファイルの中から最初の MediaBox（紙面の大きさ）を探す */
async function scanMediaBox(filePath: string): Promise<{ width: number; height: number } | null> {
  const re = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/;
  const fh = await fsp.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const STEP = 8 * 1024 * 1024;
    let pos = 0;
    let carry = '';
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(STEP, size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      const text = carry + buf.subarray(0, bytesRead).toString('latin1');
      const m = re.exec(text);
      if (m) {
        const [x0, y0, x1, y1] = m.slice(1).map(Number);
        if ([x0, y0, x1, y1].every(Number.isFinite)) return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
      }
      carry = text.slice(-256); // 区切りをまたいだ一致も拾う
      pos += bytesRead;
    }
    return null;
  } finally {
    await fh.close();
  }
}

/** PDF は sharp で読めないので、1ページ目の紙面サイズだけ取り出す */
async function readPdfMeta(filePath: string, bytes: number): Promise<ImageMeta> {
  // PDF はベクターなので画素数の概念がない。72pt=1inch を 1px として扱い、実寸（mm）が正しく出るようにしておく。
  const base = { format: 'pdf', bytes, hasAlpha: false, density: PT_PER_INCH };
  try {
    const buf = await fsp.readFile(filePath);
    const doc = await PDFDocument.load(new Uint8Array(buf), {
      updateMetadata: false,
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    const { width, height } = doc.getPage(0).getSize(); // pt
    return {
      ...base,
      width: Math.round(width),
      height: Math.round(height),
      pageCount: doc.getPageCount(),
      // 埋め込み画像の解像度（読めなければ undefined のまま。こちらで確認する）
      pdf: inspectPdfRaster(doc),
    };
  } catch {
    // パスワード付きや独自の書き出しで pdf-lib が開けない PDF でも、受付は止めない（PDF は手作業で確認する）。
    // 紙面サイズは本文から探し、見つからなければ 0 のまま預かる。
    const box = await scanMediaBox(filePath);
    return { ...base, width: box ? Math.round(box.width) : 0, height: box ? Math.round(box.height) : 0 };
  }
}

export async function readImageMeta(filePath: string, bytes: number): Promise<ImageMeta> {
  const head = await fsp.open(filePath, 'r');
  try {
    // 仕様上、%PDF- の前に最大 1024 バイトのゴミが付いていてもよいので、先頭 1KB を見る
    const sig = Buffer.alloc(1024);
    const { bytesRead } = await head.read(sig, 0, sig.length, 0);
    if (sig.subarray(0, bytesRead).toString('latin1').includes('%PDF-')) {
      return await readPdfMeta(filePath, bytes);
    }
  } finally {
    await head.close();
  }

  const m = await sharp(filePath, LIMIT).metadata();
  if (!m.width || !m.height) throw new Error('画像のサイズを読み取れませんでした');
  // EXIF で 90/270 度回転が指定されている写真は、実際に見える向きの縦横に直す
  const rotated = (m.orientation ?? 1) >= 5;
  return {
    width: rotated ? m.height : m.width,
    height: rotated ? m.width : m.height,
    format: m.format ?? 'unknown',
    bytes,
    hasAlpha: Boolean(m.hasAlpha),
    density: m.density,
  };
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

const clamp01 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};

const SHARP_EXTEND: Record<BleedMode, 'mirror' | 'copy' | 'background'> = {
  mirror: 'mirror',
  extend: 'copy',
  color: 'background',
};

export type Placement = { left: number; top: number; width: number; height: number };

/** 仕上がり枠の内側に絵柄を収めたときの位置（塗り足しまで含めたキャンバス座標） */
export function containPlacement(imgW: number, imgH: number, plan: PrintPlan): Placement {
  const s = Math.min(plan.trimW / imgW, plan.trimH / imgH);
  const width = Math.max(1, Math.round(imgW * s));
  const height = Math.max(1, Math.round(imgH * s));
  return {
    width,
    height,
    left: Math.floor((plan.canvasW - width) / 2),
    top: Math.floor((plan.canvasH - height) / 2),
  };
}

async function orientedSize(filePath: string) {
  const m = await sharp(filePath, LIMIT).metadata();
  const rotated = (m.orientation ?? 1) >= 5;
  const w = (rotated ? m.height : m.width) ?? 1;
  const h = (rotated ? m.width : m.height) ?? 1;
  return { w, h };
}

export type BuildPrintArgs = {
  srcPath: string;
  outDir: string;
  plan: PrintPlan;
  fit: FitMode;
  bleedMode: BleedMode;
  bleedColor: string;
  padColor: string;
  /** トリミングで残す位置（0=左/上, 0.5=中央, 1=右/下）。cover のときだけ効く */
  focusX?: number;
  focusY?: number;
};

export type BuildPrintResult = {
  printFilename: string;
  printBytes: number;
  previewFilename: string;
  previewBytes: number;
  guideFilename: string;
  guideBytes: number;
};

function outputTarget(outDir: string, plan: PrintPlan) {
  const { canvasW, canvasH, trimW, trimH, bleedPx, dpi } = plan;
  // 5000万画素を超えるものは PNG だとファイルが巨大になるので JPEG（高品質）に切り替える
  const huge = canvasW * canvasH > 50_000_000;
  const printFilename = `print_${trimW}x${trimH}px_${dpi}dpi_bleed${bleedPx}px.${huge ? 'jpg' : 'png'}`;
  return { huge, printFilename, printPath: path.join(outDir, printFilename) };
}

async function writeOutput(pipeline: sharp.Sharp, huge: boolean, dpi: number, printPath: string) {
  const out = huge
    ? pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    : pipeline.png({ compressionLevel: 6 });
  return out.withMetadata({ density: dpi }).toFile(printPath);
}

/** あなたの確認用（LINE でお客さんに見せる用）のプレビューと、断裁位置ガイド */
async function writePreviewAndGuide(printPath: string, outDir: string, plan: PrintPlan) {
  const previewFilename = 'preview.jpg';
  const previewInfo = await sharp(printPath, LIMIT)
    .resize({ width: 1400, height: 1400, fit: 'inside' })
    .jpeg({ quality: 82 })
    .toFile(path.join(outDir, previewFilename));

  const guideFilename = 'guide.jpg';
  const gW = previewInfo.width;
  const gH = previewInfo.height;
  const bx = Math.round(plan.bleedPx * (gW / plan.canvasW));
  const stroke = Math.max(1, Math.round(gW / 500));
  const guideSvg = Buffer.from(
    `<svg width="${gW}" height="${gH}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${bx}" y="${bx}" width="${gW - bx * 2}" height="${gH - bx * 2}"
             fill="none" stroke="#ff2d55" stroke-width="${stroke}" stroke-dasharray="${stroke * 6} ${stroke * 4}"/>
     </svg>`,
  );
  const guideInfo = await sharp(path.join(outDir, previewFilename), LIMIT)
    .composite([{ input: guideSvg, top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toFile(path.join(outDir, guideFilename));

  return {
    previewFilename,
    previewBytes: previewInfo.size,
    guideFilename,
    guideBytes: guideInfo.size,
  };
}

/**
 * 入稿用データを作る。
 *
 * - トリミング（cover）: 塗り足しまで含めた紙面を絵柄で埋める。focusX/Y で残す位置を選べる。
 *   塗り足しにも本物の絵柄が入るので、断裁が多少ずれても白フチが出ない。
 * - 余白で埋める（contain）: 絵柄を切らずに置き、まわりを鏡ばり／端色延長／指定色で埋める。
 *
 * 原本のファイルには一切手を加えない。ここで作るのは常に別ファイル。
 */
export async function buildPrintFile(args: BuildPrintArgs): Promise<BuildPrintResult> {
  const { srcPath, outDir, plan, fit, bleedMode, bleedColor, padColor } = args;
  const { canvasW, canvasH, dpi } = plan;
  const { huge, printFilename, printPath } = outputTarget(outDir, plan);
  const { w, h } = await orientedSize(srcPath);

  let pipeline: sharp.Sharp;
  let upscaleFactor: number;

  if (fit === 'cover') {
    const s = Math.max(canvasW / w, canvasH / h);
    const sw = Math.max(canvasW, Math.round(w * s));
    const sh = Math.max(canvasH, Math.round(h * s));
    upscaleFactor = s;
    pipeline = sharp(srcPath, LIMIT)
      .rotate() // EXIF の向きを反映
      .resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' })
      .extract({
        left: Math.round((sw - canvasW) * clamp01(args.focusX)),
        top: Math.round((sh - canvasH) * clamp01(args.focusY)),
        width: canvasW,
        height: canvasH,
      });
  } else {
    const place = containPlacement(w, h, plan);
    upscaleFactor = place.width / w;
    const inner = await sharp(srcPath, LIMIT)
      .rotate()
      .resize(place.width, place.height, { fit: 'fill', kernel: 'lanczos3' })
      .toBuffer();
    pipeline = sharp(inner, LIMIT).extend({
      left: place.left,
      top: place.top,
      right: canvasW - place.width - place.left,
      bottom: canvasH - place.height - place.top,
      extendWith: SHARP_EXTEND[bleedMode],
      background: hexToRgb(bleedMode === 'color' ? bleedColor : padColor),
    });
  }

  // 元画像より大きく引き伸ばすときは、lanczos3 の後に軽くシャープをかけてぼけを防ぐ
  if (upscaleFactor > 1.2) {
    pipeline = pipeline.sharpen({ sigma: Math.min(1.4, 0.6 + (upscaleFactor - 1) * 0.25) });
  }

  // 透過が残っていると印刷で意図しない抜けになるので、指定色で下地を敷く
  pipeline = pipeline.flatten({ background: hexToRgb(padColor) });

  const info = await writeOutput(pipeline, huge, dpi, printPath);
  const pv = await writePreviewAndGuide(printPath, outDir, plan);
  return { printFilename, printBytes: info.size, ...pv };
}

/**
 * AI で描き足した背景の上に、原本を高解像度のまま貼り戻して入稿データを作る。
 * 境目が見えないよう、原本のふちをわずかにぼかして馴染ませる。
 */
export async function buildExpandedPrintFile(args: {
  /** AI が描き足した画像（最終キャンバスと同じ比率） */
  bgPath: string;
  /** 原本（高解像度化済み） */
  fgPath: string;
  outDir: string;
  plan: PrintPlan;
  place: Placement;
  padColor: string;
}): Promise<BuildPrintResult> {
  const { bgPath, fgPath, outDir, plan, place, padColor } = args;
  const { canvasW, canvasH, dpi } = plan;
  const { huge, printFilename, printPath } = outputTarget(outDir, plan);

  const bg = await sharp(bgPath, LIMIT)
    .rotate()
    .resize(canvasW, canvasH, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .toBuffer();

  const W = place.width;
  const H = place.height;
  const fg = await sharp(fgPath, LIMIT)
    .rotate()
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer();

  // ふちのぼかし幅は原本の短辺の 0.6%。巨大な画像でぼかしを直接かけると重いので、
  // 1/8 の大きさでマスクを作ってから拡大する（拡大でさらに滑らかになる）。
  const feather = Math.max(2, Math.round(Math.min(W, H) * 0.006));
  const mw = Math.max(8, Math.round(W / 8));
  const mh = Math.max(8, Math.round(H / 8));
  const mf = Math.max(1, feather / 8);
  const maskSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mw}" height="${mh}">
       <defs><filter id="f" x="-10%" y="-10%" width="120%" height="120%">
         <feGaussianBlur stdDeviation="${mf / 2}"/></filter></defs>
       <rect width="${mw}" height="${mh}" fill="#000"/>
       <rect x="${mf}" y="${mf}" width="${mw - mf * 2}" height="${mh - mf * 2}" fill="#fff" filter="url(#f)"/>
     </svg>`,
  );
  const mask = await sharp(maskSvg)
    .resize(W, H, { fit: 'fill', kernel: 'cubic' })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const fgRgba = await sharp(fg, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(mask, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();

  const pipeline = sharp(bg, LIMIT)
    .composite([{ input: fgRgba, left: place.left, top: place.top }])
    .flatten({ background: hexToRgb(padColor) });

  const info = await writeOutput(pipeline, huge, dpi, printPath);
  const pv = await writePreviewAndGuide(printPath, outDir, plan);
  return { printFilename, printBytes: info.size, ...pv };
}
