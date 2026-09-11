'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  MAX_QUANTITY,
  QUANTITY_PRESETS,
  STICKER_FINISHES,
  STICKER_SHAPES,
  clampQuantity,
  estimate,
  sumEstimates,
  validFinish,
  validShape,
} from '@/lib/pricing';
import { effectiveDpi, judge, judgePixels } from '@/lib/print';
import {
  FIT_MODES,
  OPTIONS,
  PRODUCTS,
  applyOrientation,
  getProduct,
  isSquare,
  resolveSize,
  yen,
  type OptionId,
  type ProductId,
  type SizePreset,
} from '@/lib/products';
import type { OrderOptions } from '@/lib/types';
import { Button, Choice, StepHeading, StickyBar, VerdictBadge } from '../ui';
import { DesignThumb, designSummary } from './DesignThumb';
import { EstimateSummary, EstimateTotal } from './EstimateSummary';
import { NumericInput } from '../NumericInput';
import { canUpscaleDesign, isPdfFile, type DesignDraft, type PickedFile } from './PickStep';

function dotFor(dpi: number, ideal: number, min: number) {
  if (dpi >= ideal) return 'bg-ok';
  if (dpi >= min * 1.15) return 'bg-ok';
  if (dpi >= min) return 'bg-warn';
  return 'bg-ng';
}

/** 仕上がり枠に対して絵柄がどう入るかを、その場で見せる */
function FitPreview({
  picked,
  size,
  fit,
  bleedOption,
}: {
  picked: PickedFile;
  size: SizePreset;
  fit: 'cover' | 'contain';
  bleedOption: boolean;
}) {
  const ratio = size.widthMm / size.heightMm;
  const MAX_H = 150;
  const MAX_W = 200;
  let h = MAX_H;
  let w = h * ratio;
  if (w > MAX_W) {
    w = MAX_W;
    h = w / ratio;
  }

  const imgRatio = picked.height > 0 ? picked.width / picked.height : ratio;
  const mismatch = Math.max(imgRatio, ratio) / Math.min(imgRatio, ratio) > 1.015;
  // 「そのまま印刷」＋塗り足しオプション = 切らずに中央へ置き、足りない辺を描き足す
  const fillIn = fit === 'cover' && bleedOption;
  const iw = imgRatio >= ratio ? w : h * imgRatio;
  const ih = imgRatio >= ratio ? w / imgRatio : h;

  const caption =
    fit === 'contain'
      ? '絵柄は切れません。上下または左右に余白が入ります。'
      : !fillIn
        ? '赤い枠が仕上がりです。枠からはみ出た部分は切り落とされます。'
        : mismatch
          ? '足りない部分は、絵柄をつなげて描き足して仕上げます（イメージ）。'
          : 'ふちまで絵柄が届くよう、塗り足しを付けて仕上げます。';

  return (
    <div className="py-1">
      <p className="text-[12px] font-extrabold text-center mb-3">仕上がりイメージ</p>
      <div className="grid place-items-center">
        <div
          className="relative overflow-hidden rounded-[3px] ring-1 ring-lineStrong bg-surface2"
          style={{ width: w, height: h }}
        >
          {fillIn ? (
            <>
              {/* 空白部分は、同じ絵柄をぼかして広げたもので埋めて「つながる」印象を見せる */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={picked.thumbUrl ?? picked.previewUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover scale-125"
                style={{ filter: 'blur(9px) saturate(1.05)' }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={picked.thumbUrl ?? picked.previewUrl}
                alt=""
                className="absolute object-cover"
                style={{ width: iw, height: ih, left: (w - iw) / 2, top: (h - ih) / 2 }}
              />
            </>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={picked.thumbUrl ?? picked.previewUrl}
              alt=""
              className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
            />
          )}
          <span className="absolute inset-0 ring-[1.5px] ring-inset ring-[#ff2d55]/70 pointer-events-none" />
        </div>
      </div>
      <p className="mt-3 text-[11.5px] num text-center text-sub">{size.label}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-sub text-center max-w-[280px] mx-auto">
        {caption}
      </p>
    </div>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative shrink-0 mt-0.5 w-[52px] h-[31px] rounded-pill transition-colors ${
        on ? 'bg-ink' : 'bg-surface3'
      }`}
    >
      <motion.span
        className="absolute top-[3px] left-[3px] w-[25px] h-[25px] rounded-full bg-white shadow-soft"
        initial={false}
        animate={{ x: on ? 21 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
      />
    </button>
  );
}

function OptionCard({
  id,
  on,
  recommended,
  extra,
  onToggle,
}: {
  id: OptionId;
  on: boolean;
  recommended?: boolean;
  extra?: string;
  onToggle: () => void;
}) {
  const opt = OPTIONS[id];
  return (
    <div
      className={`rounded-hero border transition-colors ${
        on ? 'border-ink bg-white shadow-soft' : 'border-line bg-white'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[15px] font-extrabold">{opt.label}</span>
            <span className="text-[13px] font-extrabold num text-accent">{yen(opt.priceYen)}</span>
            <span className="text-[11px] text-faint">（税別）</span>
            {recommended && !on && (
              <span className="rounded-pill bg-accentSoft text-accent px-2 h-[19px] inline-flex items-center text-[10.5px] font-bold self-center">
                おすすめ
              </span>
            )}
          </span>
          <span className="block text-[12.5px] text-sub mt-1.5 leading-relaxed">
            {opt.description}
            {extra ? ` ${extra}` : ''}
          </span>
        </span>
        <Switch on={on} label={opt.label} onToggle={onToggle} />
      </div>
    </div>
  );
}

/** 選択肢の名前と、加算額（無料なら「無料」） */
function PriceTitle({ label, perPieceYen }: { label: string; perPieceYen: number }) {
  return (
    <span className="flex items-baseline gap-2 flex-wrap">
      {label}
      {perPieceYen > 0 ? (
        <span className="text-[11.5px] font-bold text-accent num">＋{yen(perPieceYen)}/枚</span>
      ) : (
        <span className="text-[11.5px] font-bold text-ok">無料</span>
      )}
    </span>
  );
}

/** 枚数の入力（−／＋ とよく使う数のショートカット） */
function QuantityField({
  value,
  unit,
  presets,
  onChange,
}: {
  value: number;
  unit: string;
  presets: number[];
  onChange: (n: number) => void;
}) {
  const step = 'w-[46px] h-full text-[20px] font-bold text-sub hover:bg-surface2 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-pill border border-line bg-white h-[46px] overflow-hidden">
          <button
            type="button"
            aria-label="1つ減らす"
            className={step}
            disabled={value <= 1}
            onClick={() => onChange(clampQuantity(value - 1))}
          >
            −
          </button>
          <NumericInput
            value={value}
            min={1}
            max={MAX_QUANTITY}
            onChange={onChange}
            className="w-[72px] text-center bg-transparent outline-none text-[16px] font-extrabold num"
            ariaLabel={`数（${unit}）`}
          />
          <button
            type="button"
            aria-label="1つ増やす"
            className={step}
            disabled={value >= MAX_QUANTITY}
            onClick={() => onChange(clampQuantity(value + 1))}
          >
            ＋
          </button>
        </div>
        <span className="text-[13px] font-bold text-sub">{unit}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={`h-[30px] px-3 rounded-pill border text-[12px] font-bold num transition-colors ${
              value === n ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:border-lineStrong'
            }`}
          >
            {n}
            {unit}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 1点のデザインの設定（サイズ・枚数・入れかた・オプション・見積もり） */
function DesignSettings({
  draft,
  multiple,
  set,
}: {
  draft: DesignDraft;
  multiple: boolean;
  set: (patch: Partial<OrderOptions>) => void;
}) {
  const { picked, options } = draft;
  const product = getProduct(options.productId);
  const isPdf = isPdfFile(picked.file);
  const bleedOn = Boolean(options.bleedOption);
  // 判定に使う画素数（PDF は埋め込み画像の解像度から換算。ベクター中心・未確認の PDF は null）
  const px = judgePixels(picked, isPdf);
  // 高画質化は画像と、画像が入った PDF だけ（ベクターの PDF は対象外）
  const canUpscale = canUpscaleDesign(picked);
  const upscaleOn = Boolean(options.upscaleOption) && canUpscale;
  const isSticker = product.id === 'sticker';
  const finish = validFinish(options.stickerFinish);
  const shape = validShape(options.stickerShape);

  const sizes = useMemo(
    () =>
      product.sizes.map((raw) => {
        const s = applyOrientation(raw, options.orientation);
        return {
          id: raw.id,
          size: s,
          square: isSquare(raw),
          dpi: px ? Math.round(effectiveDpi(px.w, px.h, s, options.fit)) : 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product, px?.w, px?.h, options.fit, options.orientation],
  );

  const custom = options.sizeId === 'custom';
  const currentSize: SizePreset | null = custom
    ? {
        id: 'custom',
        label: `${options.customWidthMm ?? 0} × ${options.customHeightMm ?? 0} mm`,
        widthMm: Number(options.customWidthMm) || 0,
        heightMm: Number(options.customHeightMm) || 0,
      }
    : (sizes.find((s) => s.id === options.sizeId)?.size ?? null);

  const showOrientation = sizes.some((s) => !s.square);
  const valid = currentSize !== null && currentSize.widthMm >= 10 && currentSize.heightMm >= 10;

  const j = valid && px ? judge(px.w, px.h, product, currentSize!, options.fit) : null;

  // PDF で解像度の判定が出せないときの案内（ベクター・文字中心・未確認・確認前）
  const pdfInfo =
    isPdf && !j
      ? picked.width === 0
        ? { tone: 'neutral', title: 'PDFの中身を確認しています', detail: 'アップロードが終わると、PDFに入っている画像の解像度をここに表示します。' }
        : picked.pdf?.imageCount === 0
          ? { tone: 'ok', title: 'ベクターデータのPDFです', detail: '画像が入っていない（文字や図形だけの）データなので、どのサイズでもキレイに印刷できます。' }
          : picked.pdf
            ? { tone: 'ok', title: '文字や図形が中心のPDFです', detail: '大きく引き伸ばす画像は入っていません。小さな画像の画質は、お預かりしたあとにこちらで確認します。' }
            : { tone: 'neutral', title: 'PDFの解像度は、お預かりしたあとに確認します', detail: '自動で中身を確認できない形式でした。お預かりしたあと、こちらで画質を確認してご連絡します。' }
      : null;
  const lowRes = j !== null && (j.verdict === 'ng' || j.verdict === 'low');
  // 高画質化を申し込めば、解像度の注意は「仕上げます」の案内に切り替わる
  const rescued = lowRes && upscaleOn;
  const est = estimate({ ...options, upscaleOption: upscaleOn });

  return (
    <div>
      {showOrientation && (
        <div className="flex items-center justify-between mb-4 mt-2">
          <p className="text-[12px] font-extrabold tracking-wide">向き</p>
          <div className="flex rounded-pill bg-surface3 p-[3px]">
            {(
              [
                ['portrait', '縦長'],
                ['landscape', '横長'],
              ] as const
            ).map(([o, label]) => {
              const on = options.orientation === o;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => set({ orientation: o })}
                  aria-pressed={on}
                  className={`relative px-4 h-[34px] rounded-pill text-[12.5px] font-bold transition-colors ${
                    on ? 'bg-ink text-white' : 'text-sub hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[12px] font-extrabold tracking-wide mb-3">仕上がりサイズ</p>
      <div className="space-y-2.5">
        {sizes.map(({ id, size, dpi }) => {
          const dot = dotFor(dpi, product.idealDpi, product.minDpi);
          // 高画質化を申し込むと、足りないサイズも「高画質化で対応」として緑になる
          const boosted = upscaleOn && dot !== 'bg-ok';
          return (
            <Choice
              key={id}
              selected={options.sizeId === id}
              onClick={() => set({ sizeId: id })}
              title={size.label}
              right={
                !px ? undefined : (
                  <span className="flex items-center gap-2">
                    {boosted && <span className="text-[10.5px] font-bold text-ok">※高画質化</span>}
                    <span className="text-[11.5px] text-sub num">{dpi}dpi</span>
                    <span className={`w-[8px] h-[8px] rounded-full ${boosted ? 'bg-ok' : dot}`} />
                  </span>
                )
              }
            />
          );
        })}
        <Choice
          selected={custom}
          onClick={() =>
            set({
              sizeId: 'custom',
              customWidthMm: options.customWidthMm ?? 300,
              customHeightMm: options.customHeightMm ?? 450,
            })
          }
          title="サイズを自分で決める"
          note={custom ? undefined : 'ミリ単位で指定できます'}
        />
        {custom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-3 pl-4 pt-1"
          >
            {(['customWidthMm', 'customHeightMm'] as const).map((k, i) => (
              <label key={k} className="flex-1">
                <span className="block text-[11px] text-sub mb-1.5">{i === 0 ? '横' : '縦'}</span>
                <span className="flex items-center rounded-card border border-line bg-white px-3 h-[46px]">
                  <NumericInput
                    value={Number(options[k] ?? (i === 0 ? 300 : 450))}
                    min={10}
                    max={3000}
                    onChange={(n) => set({ [k]: n } as Partial<OrderOptions>)}
                    className="w-full bg-transparent outline-none text-[15px] font-bold num"
                    ariaLabel={i === 0 ? '横（mm）' : '縦（mm）'}
                  />
                  <span className="text-[12px] text-sub pl-1">mm</span>
                </span>
              </label>
            ))}
          </motion.div>
        )}
      </div>

      {isSticker && (
        <>
          <p className="text-[12px] font-extrabold tracking-wide mt-8 mb-3">仕上がり</p>
          <div className="space-y-2.5">
            {STICKER_FINISHES.map((f) => (
              <Choice
                key={f.id}
                selected={finish === f.id}
                onClick={() => set({ stickerFinish: f.id })}
                title={<PriceTitle label={f.label} perPieceYen={f.perPieceYen} />}
                note={f.note}
              />
            ))}
          </div>

          <p className="text-[12px] font-extrabold tracking-wide mt-8 mb-3">形状</p>
          <div className="space-y-2.5">
            {STICKER_SHAPES.map((s) => (
              <Choice
                key={s.id}
                selected={shape === s.id}
                onClick={() => set({ stickerShape: s.id })}
                title={<PriceTitle label={s.label} perPieceYen={s.perPieceYen} />}
                note={s.note}
              />
            ))}
          </div>
        </>
      )}

      {/* タペストリーは 1デザイン＝1枚なので枚数は選ばない */}
      {product.id !== 'tapestry' && (
        <>
          <p className="text-[12px] font-extrabold tracking-wide mt-8 mb-3">枚数</p>
          <QuantityField
            value={clampQuantity(options.quantity)}
            unit="枚"
            presets={QUANTITY_PRESETS[product.id]}
            onChange={(n) => set({ quantity: n })}
          />
        </>
      )}

      <p className="text-[12px] font-extrabold tracking-wide mt-8 mb-3">絵柄の入れかた</p>
      <div className="space-y-2.5">
        {FIT_MODES.map((f) => (
          <Choice
            key={f.id}
            selected={options.fit === f.id}
            onClick={() => set({ fit: f.id })}
            title={f.label}
            note={bleedOn ? f.noteWithBleed : f.note}
          />
        ))}
      </div>

      {/* PDF は送信完了後に1ページ目の画像が届いたら、同じように仕上がりイメージを出す */}
      {valid && (!isPdf || (picked.thumbUrl && picked.width > 0)) && (
        <div className="mt-6 rounded-hero border border-line bg-white p-4 shadow-soft">
          <FitPreview picked={picked} size={currentSize!} fit={options.fit} bleedOption={bleedOn} />
        </div>
      )}

      {pdfInfo && (
        <div
          className={`mt-4 rounded-card px-4 py-4 border ${
            pdfInfo.tone === 'ok' ? 'border-ok/20 bg-okSoft' : 'border-line bg-surface2'
          }`}
        >
          <p className="text-[15px] font-extrabold leading-snug">{pdfInfo.title}</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">{pdfInfo.detail}</p>
        </div>
      )}

      {j && (
        <div
          className={`mt-4 rounded-card px-4 py-4 border ${
            rescued
              ? 'border-ok/20 bg-okSoft'
              : j.verdict === 'ng'
                ? 'border-ng/30 bg-ngSoft'
                : j.verdict === 'low'
                  ? 'border-warn/25 bg-warnSoft'
                  : 'border-ok/20 bg-okSoft'
          }`}
        >
          {rescued ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-pill px-3 h-[26px] text-[12px] font-bold bg-white/70 text-ok">
                <span className="w-[6px] h-[6px] rounded-full bg-current" />
                高画質化
              </span>
              <p className="mt-2.5 text-[15px] font-extrabold leading-snug">
                高画質化して、キレイに印刷できるように仕上げます
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">
                いまの画像は{j.effectiveDpi}dpi相当です。お預かりしたあと、仕上がりサイズに合わせて解像度を引き上げます。
              </p>
            </>
          ) : (
            <>
              <VerdictBadge verdict={j.verdict} />
              <p className="mt-2.5 text-[15px] font-extrabold leading-snug">{j.headline}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">{j.detail}</p>
            </>
          )}
        </div>
      )}

      <p className="text-[12px] font-extrabold tracking-wide mt-8 mb-3">オプション</p>
      <div className="space-y-2.5">
        <OptionCard
          id="bleed"
          on={bleedOn}
          recommended={options.fit === 'cover'}
          onToggle={() => set({ bleedOption: !bleedOn })}
        />
        {canUpscale && (
          <OptionCard
            id="upscale"
            on={upscaleOn}
            recommended={lowRes}
            extra={lowRes && !upscaleOn ? 'いまの画像はこのサイズでは解像度が足りていないので、おすすめです。' : undefined}
            onToggle={() => set({ upscaleOption: !upscaleOn })}
          />
        )}
      </div>
      <p className="mt-3 px-1 text-[11.5px] text-faint leading-relaxed">
        お預かりしたあと、仕上がりをあらためてご連絡のうえお見せします。
      </p>

      {est && (
        <EstimateSummary
          est={est}
          title={multiple ? 'このデザインの見積もり（概算）' : 'お見積もり（概算）'}
          className="mt-8 rounded-hero border border-line bg-surface2/70 px-4 py-4"
        />
      )}
    </div>
  );
}

export function SpecStep({
  productId,
  designs,
  setProduct,
  setOptions,
  copyToAll,
  onNext,
}: {
  productId: ProductId;
  designs: DesignDraft[];
  setProduct: (id: ProductId) => void;
  setOptions: (key: string, patch: Partial<OrderOptions>) => void;
  copyToAll: (key: string) => void;
  onNext: () => void;
}) {
  const product = getProduct(productId);
  const multiple = designs.length > 1;
  const [open, setOpen] = useState<string | null>(designs[0]?.key ?? null);

  const ests = designs.map((d) =>
    estimate({ ...d.options, upscaleOption: d.options.upscaleOption && canUpscaleDesign(d.picked) }),
  );
  const total = sumEstimates(ests);
  const allValid = designs.length > 0 && designs.every((d) => resolveSize(d.options) !== null);

  return (
    <div className="flex flex-col min-h-full">
      <StepHeading
        step="STEP 2 / 3"
        title="何にしますか？"
        lead={
          multiple
            ? `${designs.length}点それぞれに、仕上がりサイズやオプションを選べます。`
            : '選ぶと、その大きさで刷ったときの画質をその場で判定します。'
        }
      />

      <div className="grid grid-cols-3 gap-2.5 mb-7">
        {PRODUCTS.map((p) => {
          const on = p.id === productId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setProduct(p.id)}
              aria-pressed={on}
              className={`rounded-card border py-4 px-2 transition-all ${
                on ? 'border-ink bg-ink text-white shadow-soft' : 'border-line bg-white hover:border-lineStrong'
              }`}
            >
              <span className="block text-[13.5px] font-extrabold">{p.label}</span>
            </button>
          );
        })}
      </div>
      <p className="-mt-5 mb-7 text-[12.5px] leading-relaxed text-sub">
        {product.note}
        {product.id === 'tapestry' ? ' 1デザインにつき1枚でお作りします。' : ''}
      </p>

      <div className={multiple ? 'space-y-3' : ''}>
        {designs.map((d, i) => {
          const isOpen = !multiple || open === d.key;
          const setThis = (patch: Partial<OrderOptions>) => setOptions(d.key, patch);
          if (!multiple) return <DesignSettings key={d.key} draft={d} multiple={false} set={setThis} />;
          return (
            <section key={d.key} className="rounded-hero border border-line bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : d.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-surface2/60 transition-colors"
              >
                <DesignThumb picked={d.picked} size={48} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold text-faint">デザイン {i + 1}</span>
                  <span className="block text-[12.5px] font-bold leading-snug num">{designSummary(d.options)}</span>
                </span>
                {ests[i] && (
                  <span className="text-[13px] font-extrabold num shrink-0">{yen(ests[i]!.subtotalYen)}</span>
                )}
                <svg
                  width="16" height="16" viewBox="0 0 16 16" aria-hidden
                  className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M3.5 6 L8 10.5 L12.5 6" stroke="#6b6b75" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden border-t border-line"
                  >
                    <div className="px-4 pt-3 pb-5">
                      <DesignSettings draft={d} multiple set={setThis} />
                      <button
                        type="button"
                        onClick={() => copyToAll(d.key)}
                        className="mt-5 w-full h-[44px] rounded-pill border border-lineStrong text-[12.5px] font-bold hover:bg-surface2 transition-colors"
                      >
                        この設定を、ほかの{designs.length - 1}点にもコピーする
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })}
      </div>

      {multiple && (
        <EstimateTotal
          total={total}
          count={designs.length}
          className="mt-6 rounded-hero border border-ink/70 bg-white px-4 py-4 shadow-soft"
        />
      )}

      <div className="flex-1 min-h-[24px]" />

      <StickyBar>
        <Button full disabled={!allValid} onClick={onNext}>
          次へ
        </Button>
      </StickyBar>
    </div>
  );
}
