import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * 印刷用の CMYK 変換。
 *
 * Adobe のアプリと一緒に入る Japan Color 2001 Coated（日本のオフセット印刷の標準）を使う。
 * sharp（libvips + lcms2）の ICC 変換はレンダリングインテントが「知覚的」固定で、
 * 彩度の高い AI 画像でも色をクリップさせず、階調を保ったまま CMYK の色域に収める。
 */

const DEFAULT_ICC =
  '/Library/Application Support/Adobe/Color/Profiles/Recommended/JapanColor2001Coated.icc';

export function cmykProfilePath(): string | null {
  const p = process.env.CMYK_ICC_PROFILE || DEFAULT_ICC;
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return p;
  } catch {
    return null;
  }
}

/** 「JapanColor2001Coated.icc」→「Japan Color 2001 Coated」 */
export function cmykProfileName(): string {
  const p = cmykProfilePath();
  if (!p) return 'CMYK（sharp 内蔵の汎用プロファイル）';
  return path
    .basename(p, path.extname(p))
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Z])/g, '$1 $2');
}

export type CmykResult = {
  outPath: string;
  bytes: number;
  profile: string;
  /** 使った ICC のパス。見つからず内蔵プロファイルで変換したときは null */
  iccPath: string | null;
};

/** RGB の入稿ラスターを、PDF に埋め込む CMYK JPEG に変換する */
export async function toCmykJpeg(srcPath: string, outPath: string): Promise<CmykResult> {
  const icc = cmykProfilePath();
  const info = await sharp(srcPath, { limitInputPixels: false })
    .withIccProfile(icc ?? 'cmyk')
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(outPath);

  const m = await sharp(outPath).metadata();
  if (m.channels !== 4 || m.space !== 'cmyk') {
    throw new Error(`CMYK への変換に失敗しました（${m.space} / ${m.channels}ch）`);
  }
  return { outPath, bytes: info.size, profile: cmykProfileName(), iccPath: icc };
}
