import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildExpandedPrintFile, buildPrintFile, containPlacement } from './bleed';
import { toCmykJpeg } from './colour';
import { buildCropMarkPdf } from './cropmarks';
import { aiExpand, aiExpandAvailable } from './expand';
import { buildPrintPlan } from './print';
import {
  AI_EXPAND_MIN_COVERAGE,
  artCoverage,
  getProduct,
  hasBleedOption,
  hasUpscaleOption,
  resolveSize,
  type FitMode,
} from './products';
import { orderDir, readOrder, saveOrder } from './storage';
import type { AdjustFit, Order, OrderFile, OrderOptions } from './types';
import { pickScale, upscale, upscaylAvailable } from './upscale';

/**
 * 受付のあとに裏で走る処理。
 * 大判の4倍アップスケールや AI の描き足しは分単位かかるので、お客さんを待たせないよう
 * 受付（原本の保管）とは切り離してある。
 */

export type EffectiveOptions = Omit<OrderOptions, 'fit'> & {
  fit: AdjustFit;
  focusX: number;
  focusY: number;
};

const clamp01 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};

/** お客さんの指定に、管理画面での調整を重ねた「実際に使う設定」 */
export function effectiveOptions(order: Order): EffectiveOptions {
  const a = order.adjust ?? {};
  const merged = { ...order.options } as EffectiveOptions;
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined && k !== 'updatedAt') (merged as Record<string, unknown>)[k] = v;
  }
  merged.focusX = clamp01(a.focusX);
  merged.focusY = clamp01(a.focusY);
  return merged;
}

type UpscaleInfo = NonNullable<Order['print']>['upscale'];
type ExpandInfo = NonNullable<Order['print']>['expand'];

async function upscaleIfNeeded(src: string, required: number, out: string) {
  const scale = pickScale(required);
  if (!scale) {
    return { path: src, info: { used: false, note: '元画像が十分大きいため拡大していません' } as UpscaleInfo };
  }
  if (!upscaylAvailable()) {
    return {
      path: src,
      info: { used: false, note: 'Upscayl が見つからないため、sharp の拡大のみで書き出しました' } as UpscaleInfo,
    };
  }
  const r = await upscale(src, out, scale);
  if (!r.ok) {
    return {
      path: src,
      info: { used: false, note: `拡大に失敗したため通常の拡大で書き出しました: ${r.error ?? ''}` } as UpscaleInfo,
    };
  }
  return {
    path: out,
    info: {
      used: true,
      scale: r.scale,
      model: r.model,
      seconds: r.seconds,
      note:
        required > scale
          ? `必要倍率 ${required.toFixed(1)}倍に対し ${scale}倍まで拡大（残りは通常の拡大）`
          : undefined,
    } as UpscaleInfo,
  };
}

/** 同じ案件を二重に処理しないための番人。処理中に作り直しを頼まれたら、終わってからもう一度回す。 */
const running = new Set<string>();
const rerun = new Set<string>();

export function enqueue(orderId: string) {
  if (running.has(orderId)) {
    rerun.add(orderId);
    return;
  }
  running.add(orderId);
  // 意図的に await しない。呼び出し元のレスポンスを待たせないため。
  processOrder(orderId)
    .catch((e) => console.error(`[pipeline] ${orderId}`, e))
    .finally(() => {
      running.delete(orderId);
      if (rerun.delete(orderId)) enqueue(orderId);
    });
}

export async function processOrder(orderId: string): Promise<void> {
  const order = await readOrder(orderId);
  if (!order) return;

  const bleedOpt = hasBleedOption(order.options);
  const upscaleOpt = hasUpscaleOption(order.options);
  if (!bleedOpt && !upscaleOpt && !order.adjust) {
    order.print = { status: 'skipped', reason: 'no-option', error: 'オプション未申込' };
    await saveOrder(order);
    return;
  }
  if (order.meta.format === 'pdf') {
    order.print = { status: 'skipped', reason: 'pdf', error: 'PDFのため自動生成は行いません' };
    await saveOrder(order);
    return;
  }

  // 比率が大きく変わる案件は、AI で描き足しても商用品質にならない（チラシ→細長いタペストリー等）。
  // 自動では何もせず原本のまま預かり、手作業の再レイアウトに回す。AI で広げるのは微調整の範囲だけ。
  // 管理画面で調整した案件は、あなたの判断を優先してそのまま処理する。
  if (!order.adjust && order.options.fit === 'cover') {
    let size0: ReturnType<typeof resolveSize> = null;
    try {
      size0 = resolveSize(order.options);
    } catch {
      // サイズ指定が不正な案件は、下の本処理でエラーとして記録する
    }
    if (size0) {
      const coverage = artCoverage(order.meta.width, order.meta.height, size0.widthMm, size0.heightMm);
      if (coverage < AI_EXPAND_MIN_COVERAGE) {
        order.print = {
          status: 'skipped',
          reason: 'relayout',
          coverage: Math.round(coverage * 1000) / 1000,
          error: `比率の差が大きいため自動処理していません（原本の絵柄は仕上がりの${Math.round(coverage * 100)}%）。再レイアウトで対応してください`,
        };
        await saveOrder(order);
        return;
      }
    }
  }

  const startedAt = new Date().toISOString();
  order.print = { status: 'pending', startedAt };
  await saveOrder(order);

  const dir = orderDir(orderId);
  const original = order.files.find((f) => f.kind === 'original');
  if (!original) {
    order.print = { status: 'failed', error: '原本が見つかりません' };
    await saveOrder(order);
    return;
  }
  const originalPath = path.join(dir, original.filename);

  const tmp: string[] = [];
  const tmpPath = (name: string) => {
    const p = path.join(os.tmpdir(), `ii-${orderId}-${name}`);
    tmp.push(p);
    return p;
  };

  try {
    const eff = effectiveOptions(order);
    // 「そのまま印刷」＋塗り足しオプションは、切り取らずに中央へ置いて足りない辺を描き足す
    if (!order.adjust?.fit && bleedOpt && eff.fit === 'cover') eff.fit = 'expand';
    // 管理画面で調整した案件は、あなたの指定をそのまま尊重する（オプションの有無で削らない）
    const designerAdjusted = Boolean(order.adjust);
    const withMarks = bleedOpt || designerAdjusted;
    const product = getProduct(eff.productId);
    const size = resolveSize(eff);
    if (!size) throw new Error('サイズの指定が不正です');
    const bleedMm = !withMarks
      ? 0
      : eff.bleedMm === undefined || eff.bleedMm === null || Number.isNaN(Number(eff.bleedMm))
        ? product.defaultBleedMm
        : Number(eff.bleedMm);
    const plan = buildPrintPlan(size, bleedMm, product.outputDpi);
    const { width: w, height: h } = order.meta;
    const place = containPlacement(w, h, plan);

    // Upscayl は jpg/png/webp しか読めず、EXIF の向きも無視する。先に正立の PNG にそろえる。
    const srcMeta = await sharp(originalPath, { limitInputPixels: false }).metadata();
    let baseSrc = originalPath;
    if (!['jpeg', 'png', 'webp'].includes(srcMeta.format ?? '') || (srcMeta.orientation ?? 1) > 1) {
      baseSrc = tmpPath('src.png');
      await sharp(originalPath, { limitInputPixels: false }).rotate().png().toFile(baseSrc);
    }

    const wantExpand = eff.fit === 'expand';
    const layoutFit: FitMode = eff.fit === 'cover' ? 'cover' : 'contain';

    // ── 1. 原本の高解像度化（Upscayl） ─────────────
    const required =
      layoutFit === 'cover'
        ? Math.max(plan.canvasW / w, plan.canvasH / h)
        : Math.max(place.width / w, place.height / h);
    const up =
      upscaleOpt || designerAdjusted
        ? await upscaleIfNeeded(baseSrc, required, tmpPath('up.png'))
        : { path: baseSrc, info: { used: false, note: '高画質化オプションなし（通常の拡大のみ）' } as UpscaleInfo };

    // ── 2. 塗り足し付きのラスター（RGB マスター） ────
    let built: Awaited<ReturnType<typeof buildPrintFile>> | null = null;
    let expandInfo: ExpandInfo | undefined;

    if (wantExpand && aiExpandAvailable()) {
      const ai = await aiExpand({
        srcPath: baseSrc,
        outPath: tmpPath('ai.png'),
        finalW: plan.canvasW,
        finalH: plan.canvasH,
        place,
      });
      if (ai.ok) {
        // AI の出力は 4MP までなので、背景として使う前に Upscayl で持ち上げる
        const aiUp = await upscaleIfNeeded(ai.outPath, plan.canvasW / ai.workW, tmpPath('ai-up.png'));
        built = await buildExpandedPrintFile({
          bgPath: aiUp.path,
          fgPath: up.path,
          outDir: dir,
          plan,
          place,
          padColor: eff.padColor || '#ffffff',
        });
        expandInfo = {
          used: true,
          provider: 'FLUX Outpainting（Black Forest Labs）',
          seconds: ai.seconds,
          workW: ai.workW,
          workH: ai.workH,
          note: aiUp.info?.used
            ? `描き足し部分を Upscayl ${aiUp.info.scale}倍で拡大、中央は原本を貼り戻し`
            : aiUp.info?.note,
        };
      } else {
        expandInfo = { used: false, note: `AI の描き足しに失敗したため、鏡ばりの余白で書き出しました: ${ai.error}` };
      }
    } else if (wantExpand) {
      expandInfo = {
        used: false,
        note: 'AI 描き足しの API キーが未設定のため、絵柄を切らずに鏡ばりの余白で書き出しました（要手作業）',
      };
    }

    if (!built) {
      built = await buildPrintFile({
        srcPath: up.path,
        outDir: dir,
        plan,
        fit: layoutFit,
        focusX: eff.focusX,
        focusY: eff.focusY,
        bleedMode: wantExpand ? 'mirror' : eff.bleedMode || 'mirror',
        bleedColor: eff.bleedColor || '#ffffff',
        padColor: eff.padColor || '#ffffff',
      });
    }

    // ── 3. CMYK に変換してトンボ付きPDF ────────────
    const printPath = path.join(dir, built.printFilename);
    const colour = await toCmykJpeg(printPath, tmpPath('cmyk.jpg'));
    const pdfName = withMarks
      ? `print_${size.widthMm}x${size.heightMm}mm_bleed${bleedMm}mm_トンボ付き_CMYK.pdf`
      : `print_${size.widthMm}x${size.heightMm}mm_CMYK.pdf`;
    const marks = await buildCropMarkPdf({
      marks: withMarks,
      jpegPath: colour.outPath,
      outPath: path.join(dir, pdfName),
      trimWmm: size.widthMm,
      trimHmm: size.heightMm,
      bleedMm,
      iccPath: colour.iccPath,
      outputCondition: colour.profile,
    });

    // ── 4. 案件情報を更新 ─────────────────────────
    // 処理中に管理画面で調整が保存されている可能性があるので、最新を読み直してから書く。
    // 処理中に案件が削除されていたら、フォルダを作り直さずに終わる。
    const latest = await readOrder(orderId);
    if (!latest) return;

    // サイズを変えるとファイル名が変わるので、前回の生成物は消しておく
    for (const f of latest.files) {
      if ((f.kind === 'print' || f.kind === 'printPdf') && ![built.printFilename, pdfName].includes(f.filename)) {
        await fsp.rm(path.join(dir, f.filename), { force: true });
      }
    }

    const files: OrderFile[] = latest.files.filter((f) => f.kind === 'original' || f.kind === 'source');
    files.push(
      {
        filename: built.printFilename,
        bytes: built.printBytes,
        kind: 'print',
        label: `RGBマスター（${size.label} / 塗り足し${bleedMm}mm）`,
      },
      {
        filename: pdfName,
        bytes: marks.bytes,
        kind: 'printPdf',
        label: `${withMarks ? 'トンボ付きPDF' : 'PDF（トンボなし）'}・CMYK（${colour.profile} / 紙面 ${marks.pageWidthMm} × ${marks.pageHeightMm} mm）`,
      },
      { filename: built.previewFilename, bytes: built.previewBytes, kind: 'preview', label: 'プレビュー' },
      { filename: built.guideFilename, bytes: built.guideBytes, kind: 'preview', label: '断裁位置ガイド' },
    );
    latest.files = files;
    latest.print = {
      status: 'done',
      startedAt,
      finishedAt: new Date().toISOString(),
      ...plan,
      fit: eff.fit,
      pageWidthMm: marks.pageWidthMm,
      pageHeightMm: marks.pageHeightMm,
      upscale: up.info,
      expand: expandInfo,
      colour: { mode: 'CMYK', profile: colour.profile, outputIntent: marks.outputIntent },
    };
    await saveOrder(latest);
  } catch (e) {
    const fresh = await readOrder(orderId);
    if (!fresh) return; // 処理中に削除された案件は保存し直さない
    fresh.print = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    await saveOrder(fresh);
  } finally {
    await Promise.all(tmp.map((p) => fsp.rm(p, { force: true })));
  }
}
