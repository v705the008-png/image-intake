'use client';

import { useRef, useState } from 'react';
import { judge } from '@/lib/print';
import {
  AI_EXPAND_MIN_COVERAGE,
  PRODUCTS,
  applyOrientation,
  artCoverage,
  getProduct,
  hasBleedOption,
  isSquare,
  resolveSize,
  type BleedMode,
} from '@/lib/products';
import type { AdjustFit, Order, OrderAdjust } from '@/lib/types';
import { NumericInput } from '../NumericInput';

export type Capabilities = {
  upscayl: boolean;
  aiExpand: boolean;
  cmykProfile: string;
  cmykProfileFound: boolean;
};

type State = Required<
  Pick<
    OrderAdjust,
    | 'productId'
    | 'sizeId'
    | 'orientation'
    | 'fit'
    | 'focusX'
    | 'focusY'
    | 'bleedMm'
    | 'bleedMode'
    | 'bleedColor'
    | 'padColor'
  >
> & { customWidthMm: number; customHeightMm: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** お客さんが選んだサイズで、原本の絵柄が仕上がりの何割を占めるか */
function orderedCoverage(o: Order) {
  try {
    const z = resolveSize(o.options);
    return z ? artCoverage(o.meta.width, o.meta.height, z.widthMm, z.heightMm) : 1;
  } catch {
    return 1;
  }
}

function initialState(o: Order): State {
  const a = o.adjust ?? {};
  const productId = a.productId ?? o.options.productId;
  const p = getProduct(productId);
  return {
    productId,
    sizeId: a.sizeId ?? o.options.sizeId,
    orientation: a.orientation ?? o.options.orientation ?? 'portrait',
    customWidthMm: a.customWidthMm ?? o.options.customWidthMm ?? 300,
    customHeightMm: a.customHeightMm ?? o.options.customHeightMm ?? 450,
    // 塗り足しオプション付きの「そのまま印刷」は、受付時の生成と同じく「AIで描き足す」を初期値にする。
    // ここを「トリミング」にしたまま作り直すと、せっかく描き足した絵柄がまた切り取られてしまう。
    // ただし比率の差が大きい案件（再レイアウト扱い）は、うっかり AI に送らないよう「余白で埋める」にしておく。
    fit:
      a.fit ??
      (hasBleedOption(o.options) && o.options.fit === 'cover'
        ? orderedCoverage(o) < AI_EXPAND_MIN_COVERAGE
          ? 'contain'
          : 'expand'
        : (o.options.fit ?? 'cover')),
    focusX: a.focusX ?? 0.5,
    focusY: a.focusY ?? 0.5,
    bleedMm: a.bleedMm ?? o.options.bleedMm ?? p.defaultBleedMm,
    bleedMode: a.bleedMode ?? o.options.bleedMode ?? 'mirror',
    bleedColor: a.bleedColor ?? o.options.bleedColor ?? '#ffffff',
    padColor: a.padColor ?? o.options.padColor ?? '#ffffff',
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-sub mb-1.5">{label}</p>
      {children}
    </div>
  );
}

const seg = (on: boolean) =>
  `h-[32px] px-3 rounded-pill text-[12px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
    on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-lineStrong'
  }`;

const FIT_LABELS: [AdjustFit, string][] = [
  ['cover', 'トリミング'],
  ['contain', '余白で埋める'],
  ['expand', 'AIで描き足す'],
];

const MODE_LABELS: [BleedMode, string][] = [
  ['mirror', '鏡ばり'],
  ['extend', '端を伸ばす'],
  ['color', '指定色'],
];

/**
 * 受付後の仕上げ調整（有料オプションの範囲）。
 * お客さんの指定はそのまま残し、入稿データだけを作り直す。
 */
export function AdjustPanel({
  order,
  capabilities,
  onSubmitted,
}: {
  order: Order;
  capabilities: Capabilities | null;
  onSubmitted: () => void;
}) {
  const [s, setS] = useState<State>(() => initialState(order));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const product = getProduct(s.productId);
  const size = resolveSize(s);
  const preset = product.sizes.find((z) => z.id === s.sizeId);
  const showOrientation = s.sizeId !== 'custom' && preset !== undefined && !isSquare(preset);
  const pending = order.print?.status === 'pending';
  const aiOk = Boolean(capabilities?.aiExpand);

  const j = size
    ? judge(order.meta.width, order.meta.height, product, size, s.fit === 'cover' ? 'cover' : 'contain')
    : null;

  // プレビュー枠（仕上がりの比率）と、その中で原本が占める範囲
  const imgRatio = order.meta.width / order.meta.height;
  const trimRatio = size ? size.widthMm / size.heightMm : 1;
  const MAX = 230;
  const pw = trimRatio >= 1 ? MAX : MAX * trimRatio;
  const ph = trimRatio >= 1 ? MAX / trimRatio : MAX;
  const ibw = imgRatio >= trimRatio ? pw : ph * imgRatio;
  const ibh = imgRatio >= trimRatio ? pw / imgRatio : ph;
  const coverage = size ? artCoverage(order.meta.width, order.meta.height, size.widthMm, size.heightMm) : 1;
  const tooFar = coverage < AI_EXPAND_MIN_COVERAGE;

  // 調整のプレビューには必ず「処理前」の画像を使う。
  // source.jpg が無い古い案件（この機能より前に受け付けたもの）は、原本そのものを表示する。
  // preview.jpg は処理後の画像で上書きされているので使わない。
  const original = order.files.find((f) => f.kind === 'original');
  const srcName = order.files.some((f) => f.filename === 'source.jpg')
    ? 'source.jpg'
    : (original?.filename ?? 'source.jpg');
  const src = `/api/admin/file/${order.id}/${srcName}`;

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/adjust/${order.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? '作り直しを開始できませんでした');
      return;
    }
    onSubmitted();
  };

  const caption =
    s.fit === 'cover'
      ? 'プレビューをクリックするか、下の9マスで残す位置を選べます。赤枠が仕上がり。'
      : s.fit === 'contain'
        ? s.bleedMode === 'color'
          ? '絵柄を切らずに収め、まわりを指定色で埋めます。'
          : 'ストライプの部分が、鏡ばり／端の色で埋まります。'
        : 'ストライプの部分を、AI が絵柄の続きとして描き足します。中央は原本のまま。';

  return (
    <section className="mt-5 rounded-card border border-line bg-surface2/40 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-[13.5px] font-extrabold">仕上げの調整</h3>
        <span className="text-[11px] text-faint">お客さんの指定は残したまま、入稿データだけ作り直します</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
        {/* ── プレビュー ── */}
        <div>
          <div className="grid place-items-center rounded-[10px] bg-white border border-line p-3 min-h-[256px]">
            {size ? (
              <div
                ref={boxRef}
                className={`relative overflow-hidden ${s.fit === 'cover' ? 'cursor-crosshair' : ''}`}
                style={{
                  width: pw,
                  height: ph,
                  background: s.fit === 'contain' && s.bleedMode === 'color' ? s.bleedColor : undefined,
                }}
                onClick={(e) => {
                  if (s.fit !== 'cover' || !boxRef.current) return;
                  const r = boxRef.current.getBoundingClientRect();
                  set({
                    focusX: clamp01((e.clientX - r.left) / r.width),
                    focusY: clamp01((e.clientY - r.top) / r.height),
                  });
                }}
              >
                {s.fit === 'cover' ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={src}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ objectPosition: `${s.focusX * 100}% ${s.focusY * 100}%` }}
                  />
                ) : (
                  <>
                    {!(s.fit === 'contain' && s.bleedMode === 'color') && (
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundImage:
                            s.fit === 'expand'
                              ? 'repeating-linear-gradient(45deg, #eef1ff 0 8px, #ffffff 8px 16px)'
                              : 'repeating-linear-gradient(45deg, #efeff1 0 8px, #ffffff 8px 16px)',
                        }}
                      />
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      className="absolute object-cover pointer-events-none"
                      style={{ width: ibw, height: ibh, left: (pw - ibw) / 2, top: (ph - ibh) / 2 }}
                    />
                  </>
                )}
                <span className="absolute inset-0 ring-[1.5px] ring-inset ring-[#ff2d55]/80 pointer-events-none" />
              </div>
            ) : (
              <p className="text-[12px] text-sub">サイズを正しく指定してください</p>
            )}
          </div>
          <p className="text-[11px] text-faint mt-2 leading-relaxed">{caption}</p>
        </div>

        {/* ── 設定 ── */}
        <div className="space-y-4 text-[12.5px]">
          <Field label="商品">
            <div className="flex flex-wrap gap-1.5">
              {PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={seg(p.id === s.productId)}
                  onClick={() => set({ productId: p.id, sizeId: p.defaultSizeId, bleedMm: p.defaultBleedMm })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="仕上がりサイズ">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={s.sizeId}
                onChange={(e) => set({ sizeId: e.target.value })}
                className="h-[32px] rounded-[8px] border border-line bg-white px-2 text-[12.5px]"
              >
                {product.sizes.map((z) => (
                  <option key={z.id} value={z.id}>
                    {applyOrientation(z, s.orientation).label}
                  </option>
                ))}
                <option value="custom">カスタム（mm指定）</option>
              </select>
              {showOrientation &&
                (
                  [
                    ['portrait', '縦'],
                    ['landscape', '横'],
                  ] as const
                ).map(([o, label]) => (
                  <button
                    key={o}
                    type="button"
                    className={seg(s.orientation === o)}
                    onClick={() => set({ orientation: o })}
                  >
                    {label}
                  </button>
                ))}
              {s.sizeId === 'custom' && (
                <span className="flex items-center gap-1.5">
                  {(['customWidthMm', 'customHeightMm'] as const).map((k, i) => (
                    <span key={k} className="flex items-center gap-1">
                      {i === 1 && <span className="text-faint">×</span>}
                      <NumericInput
                        value={s[k]}
                        min={10}
                        max={3000}
                        onChange={(n) => set({ [k]: n } as Partial<State>)}
                        className="w-[76px] h-[32px] rounded-[8px] border border-line bg-white px-2 num"
                        ariaLabel={i === 0 ? '横（mm）' : '縦（mm）'}
                      />
                    </span>
                  ))}
                  <span className="text-sub">mm</span>
                </span>
              )}
            </div>
            {j && (
              <p className="mt-1.5 text-[11.5px] text-sub num">
                この条件で原本は {j.effectiveDpi}dpi 相当
                {s.fit === 'expand' ? '（描き足し部分は含まず）' : ''}
                {capabilities?.upscayl ? ' → Upscayl で引き上げてから書き出します' : ''}
              </p>
            )}
          </Field>

          <Field label="比率の合わせかた">
            <div className="flex flex-wrap items-center gap-1.5">
              {FIT_LABELS.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  className={seg(s.fit === f)}
                  disabled={f === 'expand' && !aiOk}
                  title={f === 'expand' && !aiOk ? 'BFL_API_KEY が未設定です' : undefined}
                  onClick={() => set({ fit: f })}
                >
                  {label}
                </button>
              ))}
              {coverage < 0.98 && (
                <span className={`text-[11px] num pl-1 ${tooFar ? 'text-warn font-bold' : 'text-faint'}`}>
                  原本の絵柄は仕上がりの {Math.round(coverage * 100)}%
                </span>
              )}
            </div>
            {s.fit === 'expand' && tooFar && (
              <p className="mt-1.5 text-[11px] text-warn leading-relaxed">
                比率の差が大きく、AI の描き足しでは不自然になりやすい範囲です（目安：
                {Math.round(AI_EXPAND_MIN_COVERAGE * 100)}%以上）。大きな再レイアウトは手作業での対応がおすすめです。
              </p>
            )}
            {!aiOk && (
              <p className="mt-1.5 text-[11px] text-faint">
                「AIで描き足す」は .env.local に BFL_API_KEY を設定すると使えます。
              </p>
            )}
          </Field>

          {s.fit === 'cover' && (
            <Field label="残す位置">
              <div className="flex items-center gap-4">
                <div className="grid grid-cols-3 gap-1 shrink-0">
                  {[0, 0.5, 1].flatMap((y) =>
                    [0, 0.5, 1].map((x) => (
                      <button
                        key={`${x}-${y}`}
                        type="button"
                        aria-label={`横${x * 100}% 縦${y * 100}%`}
                        onClick={() => set({ focusX: x, focusY: y })}
                        className={`w-[22px] h-[22px] rounded-[5px] border transition-colors ${
                          s.focusX === x && s.focusY === y
                            ? 'bg-ink border-ink'
                            : 'bg-white border-line hover:border-lineStrong'
                        }`}
                      />
                    )),
                  )}
                </div>
                <div className="flex-1 space-y-2 min-w-[140px]">
                  {(
                    [
                      ['focusX', '横'],
                      ['focusY', '縦'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2">
                      <span className="w-5 text-sub">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(s[k] * 100)}
                        onChange={(e) => set({ [k]: Number(e.target.value) / 100 } as Partial<State>)}
                        className="flex-1 accent-[#111113]"
                      />
                      <span className="w-9 text-right text-faint num">{Math.round(s[k] * 100)}%</span>
                    </label>
                  ))}
                </div>
              </div>
            </Field>
          )}

          {s.fit === 'contain' && (
            <Field label="余白の埋めかた">
              <div className="flex flex-wrap items-center gap-1.5">
                {MODE_LABELS.map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    className={seg(s.bleedMode === m)}
                    onClick={() => set({ bleedMode: m })}
                  >
                    {label}
                  </button>
                ))}
                {s.bleedMode === 'color' && (
                  <input
                    type="color"
                    value={s.bleedColor}
                    onChange={(e) => set({ bleedColor: e.target.value, padColor: e.target.value })}
                    className="w-[40px] h-[32px] rounded-[8px] cursor-pointer"
                    aria-label="余白の色"
                  />
                )}
              </div>
            </Field>
          )}

          <Field label="塗り足し">
            <div className="flex flex-wrap items-center gap-1.5">
              {[3, 5, 10].map((v) => (
                <button key={v} type="button" className={seg(s.bleedMm === v)} onClick={() => set({ bleedMm: v })}>
                  {v}mm
                </button>
              ))}
              <NumericInput
                value={s.bleedMm}
                min={0}
                max={30}
                onChange={(n) => set({ bleedMm: n })}
                className="w-[64px] h-[32px] rounded-[8px] border border-line bg-white px-2 num"
                ariaLabel="塗り足し（mm）"
              />
              <span className="text-sub">mm</span>
            </div>
          </Field>

          <div className="pt-1 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              disabled={!size || saving || pending}
              onClick={submit}
              className="h-[40px] px-5 rounded-pill bg-ink text-white text-[12.5px] font-bold disabled:bg-surface3 disabled:text-faint"
            >
              {pending ? '生成中…' : saving ? '送信中…' : 'この設定で作り直す'}
            </button>
            {s.fit === 'expand' && aiOk && (
              <span className="text-[11px] text-faint">画像を BFL（外部AI）へ送信します・1回ごとに従量課金</span>
            )}
          </div>
          {error && <p className="text-[12px] text-ng">{error}</p>}
          {capabilities && (
            <p className="text-[11px] text-faint">
              出力: RGBマスター ＋ トンボ付きPDF（CMYK / {capabilities.cmykProfile}
              {capabilities.cmykProfileFound ? '' : ' ※ICC未検出'}）
              {capabilities.upscayl ? ' ・ Upscayl 有効' : ' ・ Upscayl 未検出'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
