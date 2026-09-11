import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Upscayl に同梱されている CLI（upscayl-bin）を呼んで画像を拡大する。
 * Upscayl が入っていない環境では単に「使えない」を返し、呼び出し側は
 * sharp の拡大にフォールバックする。
 */

const DEFAULT_BIN = '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin';
const DEFAULT_MODELS = '/Applications/Upscayl.app/Contents/Resources/models';

export const upscaylBin = () => process.env.UPSCAYL_BIN || DEFAULT_BIN;
export const upscaylModels = () => process.env.UPSCAYL_MODELS || DEFAULT_MODELS;
export const upscaylModel = () => process.env.UPSCAYL_MODEL || 'upscayl-standard-4x';

export function upscaylAvailable() {
  if (process.env.UPSCALE_ENABLED === 'false') return false;
  try {
    fs.accessSync(upscaylBin(), fs.constants.X_OK);
    fs.accessSync(path.join(upscaylModels(), `${upscaylModel()}.param`), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** 使えるモデルの一覧（設定を変えたいときの確認用） */
export function listModels(): string[] {
  try {
    return fs
      .readdirSync(upscaylModels())
      .filter((f) => f.endsWith('.param'))
      .map((f) => f.replace(/\.param$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 必要な倍率から、Upscayl に渡す倍率（2/3/4）を決める。
 * 必要以上に大きくしても時間とディスクを食うだけなので、足りる中でいちばん小さい値を選ぶ。
 * 4倍でも足りない場合は 4倍まで上げて、残りは sharp の縮小拡大に任せる。
 */
export function pickScale(required: number): 2 | 3 | 4 | null {
  if (required <= 1.05) return null;
  if (required <= 2) return 2;
  if (required <= 3) return 3;
  return 4;
}

export type UpscaleResult = {
  ok: boolean;
  scale?: number;
  model?: string;
  seconds?: number;
  error?: string;
};

const TIMEOUT_MS = Number(process.env.UPSCALE_TIMEOUT_MS ?? 15 * 60 * 1000);

export function upscale(
  srcPath: string,
  outPath: string,
  scale: 2 | 3 | 4,
): Promise<UpscaleResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const model = upscaylModel();
    const child = spawn(
      upscaylBin(),
      [
        '-i', srcPath,
        '-o', outPath,
        '-s', String(scale),
        '-m', upscaylModels(),
        '-n', model,
        '-f', 'png',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `アップスケールが ${TIMEOUT_MS / 1000}秒 を超えたため中断しました` });
    }, TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      if (code === 0 && fs.existsSync(outPath)) {
        resolve({ ok: true, scale, model, seconds });
      } else {
        resolve({ ok: false, error: `upscayl-bin が異常終了しました (code ${code}) ${stderr.slice(-300)}` });
      }
    });
  });
}
