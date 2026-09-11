import fsp from 'node:fs/promises';
import sharp from 'sharp';
import type { Placement } from './bleed';

/**
 * AI で比率に合わせて絵柄を描き足す（Black Forest Labs の FLUX Outpainting）。
 *
 * 注意: この処理ではお客さんの画像を BFL のサーバーへ送信する。
 *
 * BFL の出力は最大 4MP なので、印刷サイズには足りない。そこで
 *  1. 最終キャンバスと同じ比率の 4MP 以内の画面で「外側」を描き足してもらい
 *  2. それを拡大して背景にし
 *  3. 中央には原本（高解像度化済み）をそのまま貼り戻す
 * という手順にしている（呼び出し側 pipeline.ts / bleed.ts の buildExpandedPrintFile）。
 * AI が作るのは足りない部分だけで、原本の絵柄の画質は落ちない。
 */

const API_BASE = () => (process.env.BFL_API_BASE || 'https://api.bfl.ai').replace(/\/$/, '');

export const aiExpandAvailable = () => Boolean(process.env.BFL_API_KEY?.trim());

/** API の上限は 4,194,304 画素。丸めの余裕を持たせる */
const MAX_PIXELS = 4_000_000;
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = Number(process.env.BFL_TIMEOUT_MS ?? 5 * 60 * 1000);

export type AiExpandResult = {
  ok: boolean;
  outPath: string;
  workW: number;
  workH: number;
  seconds?: number;
  error?: string;
};

export async function aiExpand(args: {
  srcPath: string;
  outPath: string;
  /** 塗り足しまで含めた最終キャンバス（px） */
  finalW: number;
  finalH: number;
  /** 最終キャンバス上で原本を置く位置 */
  place: Placement;
}): Promise<AiExpandResult> {
  const { srcPath, outPath, finalW, finalH, place } = args;
  const started = Date.now();

  // 最終キャンバスと同じ比率のまま 4MP 以内に縮めた作業用の画面
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (finalW * finalH)));
  const workW = Math.max(64, Math.floor((finalW * k) / 16) * 16);
  const workH = Math.max(64, Math.floor((finalH * k) / 16) * 16);
  const kx = workW / finalW;
  const ky = workH / finalH;
  const refW = Math.max(64, Math.min(workW, Math.round(place.width * kx)));
  const refH = Math.max(64, Math.min(workH, Math.round(place.height * ky)));
  const offX = Math.max(0, Math.min(workW - refW, Math.round(place.left * kx)));
  const offY = Math.max(0, Math.min(workH - refH, Math.round(place.top * ky)));

  const fail = (error: string): AiExpandResult => ({ ok: false, outPath, workW, workH, error });

  try {
    const ref = await sharp(srcPath, { limitInputPixels: false })
      .rotate()
      .resize(refW, refH, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .png()
      .toBuffer();

    const key = process.env.BFL_API_KEY!.trim();
    const res = await fetch(`${API_BASE()}/v1/flux-tools/outpainting-v1`, {
      method: 'POST',
      headers: { 'x-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        input_image: ref.toString('base64'),
        width: workW,
        height: workH,
        reference_offset_x: offX,
        reference_offset_y: offY,
        mode: 'high',
        output_format: 'png',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { polling_url?: string };
    if (!res.ok) {
      return fail(`BFL への送信に失敗しました (${res.status}) ${JSON.stringify(body).slice(0, 300)}`);
    }
    // 返ってきた polling_url をそのまま使う（地域別エンドポイントの都合で組み立て直してはいけない）
    const pollingUrl = body.polling_url;
    if (!pollingUrl) return fail(`BFL の応答に polling_url がありません: ${JSON.stringify(body).slice(0, 300)}`);

    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pr = await fetch(pollingUrl, { headers: { 'x-key': key, accept: 'application/json' } });
      const pj = (await pr.json().catch(() => ({}))) as {
        status?: string;
        result?: { sample?: string };
      };
      const status = String(pj.status ?? '');

      if (status === 'Ready') {
        const sample = pj.result?.sample;
        if (!sample) return fail('生成結果の URL がありません');
        // 署名付き URL は 10 分で失効するので、すぐに取得する
        const img = await fetch(sample);
        if (!img.ok) return fail(`生成結果のダウンロードに失敗しました (${img.status})`);
        await fsp.writeFile(outPath, Buffer.from(await img.arrayBuffer()));
        const m = await sharp(outPath).metadata();
        if (!m.width || !m.height) return fail('生成結果を画像として読めませんでした');
        return {
          ok: true,
          outPath,
          workW: m.width,
          workH: m.height,
          seconds: Math.round((Date.now() - started) / 100) / 10,
        };
      }
      if (/moderated|error|failed|not found/i.test(status)) {
        return fail(`BFL 側で処理できませんでした（${status}）`);
      }
    }
    return fail('BFL の生成がタイムアウトしました');
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
