import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * 入稿データの色。
 *
 * 自社の大判インクジェット（Epson SC-S80650 など）は、オレンジやレッドのインクも積んでいて
 * オフセット印刷より色域がずっと広い。そこへ Japan Color（オフセット用）の CMYK を渡すと、
 * プリンターが出せるはずの鮮やかな青や紫まで削られてしまう。
 * そのため既定は **sRGB のまま**渡し、色の変換は RIP（Epson Edge Print など）に任せる。
 *
 * オフセット印刷に外注するときだけ CMYK に変換する。そのときは little-cms の jpgicc で
 * 「彩度優先＋黒点補正」を使う（sharp は知覚的固定で、黒点補正も効かないため少し鈍る）。
 */

const DEFAULT_CMYK_ICC =
  '/Library/Application Support/Adobe/Color/Profiles/Recommended/JapanColor2001Coated.icc';
const DEFAULT_SRGB_ICC = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
const JPGICC_BIN = process.env.JPGICC_BIN || '/opt/homebrew/bin/jpgicc';

function readable(p: string) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function cmykProfilePath(): string | null {
  const p = process.env.CMYK_ICC_PROFILE || DEFAULT_CMYK_ICC;
  return readable(p) ? p : null;
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

export function srgbProfilePath(): string | null {
  const p = process.env.SRGB_ICC_PROFILE || DEFAULT_SRGB_ICC;
  return readable(p) ? p : null;
}

export type ColourResult = {
  outPath: string;
  bytes: number;
  mode: 'RGB' | 'CMYK';
  profile: string;
  /** PDF に出力インテントとして埋め込む ICC。見つからなければ null */
  iccPath: string | null;
  /** どうやって変換したか（管理画面の記録用） */
  note?: string;
};

/** 色を変換せず、sRGB のまま PDF 用の JPEG にする（大判インクジェット向け・既定） */
export async function toRgbJpeg(srcPath: string, outPath: string): Promise<ColourResult> {
  const icc = srgbProfilePath();
  const info = await sharp(srcPath, { limitInputPixels: false })
    .toColourspace('srgb')
    .withIccProfile(icc ?? 'srgb')
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(outPath);

  const m = await sharp(outPath).metadata();
  if (m.channels !== 3 || m.space !== 'srgb') {
    throw new Error(`RGB の書き出しに失敗しました（${m.space} / ${m.channels}ch）`);
  }
  return { outPath, bytes: info.size, mode: 'RGB', profile: 'sRGB', iccPath: icc, note: '色は変換していません' };
}

/** オフセット印刷向けに CMYK へ変換する */
export async function toCmykJpeg(srcPath: string, outPath: string): Promise<ColourResult> {
  const icc = cmykProfilePath();

  // little-cms があれば「彩度優先＋黒点補正」で変換（鮮やかさの残りが sharp より良い）
  if (icc && readable(JPGICC_BIN)) {
    const tmp = path.join(os.tmpdir(), `ii-rgb-${process.pid}-${Date.now()}.jpg`);
    try {
      await sharp(srcPath, { limitInputPixels: false })
        .toColourspace('srgb')
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toFile(tmp);
      await new Promise<void>((resolve, reject) => {
        execFile(
          JPGICC_BIN,
          ['-q95', '-e', '-t2', '-b', `-o${icc}`, tmp, outPath],
          { timeout: 15 * 60 * 1000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      const m = await sharp(outPath).metadata();
      if (m.channels === 4 && m.space === 'cmyk') {
        return {
          outPath,
          bytes: (await fsp.stat(outPath)).size,
          mode: 'CMYK',
          profile: cmykProfileName(),
          iccPath: icc,
          note: '彩度優先＋黒点補正（little-cms）',
        };
      }
    } catch {
      /* 失敗したら下の sharp による変換にフォールバックする */
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  const info = await sharp(srcPath, { limitInputPixels: false })
    .withIccProfile(icc ?? 'cmyk')
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(outPath);
  const m = await sharp(outPath).metadata();
  if (m.channels !== 4 || m.space !== 'cmyk') {
    throw new Error(`CMYK への変換に失敗しました（${m.space} / ${m.channels}ch）`);
  }
  return {
    outPath,
    bytes: info.size,
    mode: 'CMYK',
    profile: cmykProfileName(),
    iccPath: icc,
    note: '知覚的（sharp）',
  };
}
