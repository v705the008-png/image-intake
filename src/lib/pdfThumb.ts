import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * PDF の1ページ目を、プレビュー用の JPEG にする。
 *
 * macOS 標準の sips（Quartz の PDF 描画）を使う。Illustrator の PDF も崩れずに描け、5MB 程度なら約1秒。
 * sips が無い環境（Mac 以外）や描けなかった PDF は null を返し、呼び出し側は「PDF」の表示のままにする。
 */
export async function renderPdfThumb(
  pdfPath: string,
  outJpg: string,
  maxPx = 1400,
): Promise<{ bytes: number; width: number; height: number } | null> {
  if (process.platform !== 'darwin') return null;

  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPng = path.join(os.tmpdir(), `ii-pdf-${stamp}.png`);
  // sips は拡張子で形式を判断するので、.pdf 以外の名前（アップロード途中の .bin）は .pdf の別名を作って渡す
  const needsLink = path.extname(pdfPath).toLowerCase() !== '.pdf';
  const input = needsLink ? path.join(os.tmpdir(), `ii-pdf-${stamp}.pdf`) : pdfPath;

  try {
    if (needsLink) await fsp.symlink(pdfPath, input);
    await new Promise<void>((resolve, reject) => {
      execFile('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', tmpPng], { timeout: 60_000 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    const info = await sharp(tmpPng, { limitInputPixels: false })
      .flatten({ background: '#ffffff' }) // 透明な部分は紙の白で見せる
      .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(outJpg);
    return { bytes: info.size, width: info.width, height: info.height };
  } catch {
    await fsp.rm(outJpg, { force: true }).catch(() => undefined);
    return null;
  } finally {
    await fsp.rm(tmpPng, { force: true }).catch(() => undefined);
    if (needsLink) await fsp.rm(input, { force: true }).catch(() => undefined);
  }
}
