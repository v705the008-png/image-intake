'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdjustPanel, type Capabilities } from '@/components/admin/AdjustPanel';
import { Button } from '@/components/ui';
import { sumEstimates } from '@/lib/pricing';
import { formatBytes, formatPx } from '@/lib/print';
import {
  OPTIONS,
  getProduct,
  hasAnyOption,
  hasBleedOption,
  hasUpscaleOption,
  resolveSize,
  yen,
} from '@/lib/products';
import type { AdjustFit, Order } from '@/lib/types';

const VERDICT: Record<string, { label: string; cls: string }> = {
  ideal: { label: '十分', cls: 'bg-okSoft text-ok' },
  ok: { label: '可', cls: 'bg-okSoft text-ok' },
  low: { label: 'ぎりぎり', cls: 'bg-warnSoft text-warn' },
  ng: { label: '不足', cls: 'bg-ngSoft text-ng' },
};

const FIT_TEXT: Record<AdjustFit, string> = {
  cover: 'そのまま印刷（はみ出しは切る）',
  contain: '余白で埋める',
  expand: 'AIで描き足す',
};

const pill = 'rounded-pill px-2.5 h-[21px] inline-flex items-center text-[11px] font-bold';

/** お客さんの指定に管理画面の調整を重ねたサイズ表記 */
function sizeLabel(o: Order) {
  const a = o.adjust ?? {};
  try {
    const size = resolveSize({
      productId: a.productId ?? o.options.productId,
      sizeId: a.sizeId ?? o.options.sizeId,
      orientation: a.orientation ?? o.options.orientation,
      customWidthMm: a.customWidthMm ?? o.options.customWidthMm,
      customHeightMm: a.customHeightMm ?? o.options.customHeightMm,
    });
    return size?.label ?? (a.sizeId ?? o.options.sizeId);
  } catch {
    return a.sizeId ?? o.options.sizeId;
  }
}

function PrintStatus({ order }: { order: Order }) {
  const st = order.print?.status;
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '生成中…', cls: 'bg-accentSoft text-accent' },
    done: { label: '入稿データ完成', cls: 'bg-okSoft text-ok' },
    failed: { label: '生成失敗', cls: 'bg-ngSoft text-ng' },
    skipped: { label: '要手作業', cls: 'bg-surface3 text-sub' },
  };
  const v =
    st === 'skipped' && order.print?.reason === 'relayout'
      ? { label: '再レイアウト（手作業）', cls: 'bg-warnSoft text-warn' }
      : map[st ?? 'skipped'];
  return <span className={`${pill} ${v.cls}`}>{v.label}</span>;
}

const hasFile = (o: Order, name: string) => o.files.some((f) => f.filename === name);

/** デザイン1点ぶんの行（開くと詳細と調整パネル） */
function OrderArticle({
  o,
  label,
  isOpen,
  onToggle,
  capabilities,
  load,
  showCustomer,
}: {
  o: Order;
  label?: string;
  isOpen: boolean;
  onToggle: () => void;
  capabilities: Capabilities | null;
  load: () => void;
  showCustomer: boolean;
}) {
  const v = VERDICT[o.judgement.verdict] ?? VERDICT.ok;
  const printFile = o.files.find((f) => f.kind === 'print');
  const pdfFile = o.files.find((f) => f.kind === 'printPdf');
  const thumb = hasFile(o, 'source.jpg') ? 'source.jpg' : 'preview.jpg';
  const fit = (o.adjust?.fit ?? o.options.fit) as AdjustFit;
  const canAdjust = (hasAnyOption(o.options) || Boolean(o.adjust)) && o.meta.format !== 'pdf';
  const qtyText =
    o.options.productId === 'tapestry'
      ? ''
      : ` ・ ${o.options.quantity ?? 1}枚`;

  return (
    <article className="bg-white rounded-card border border-line overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3.5 flex items-center gap-4 hover:bg-surface2/50 transition-colors"
      >
        <span className="w-[62px] h-[62px] rounded-[10px] overflow-hidden bg-surface2 shrink-0 grid place-items-center checker">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/admin/file/${o.id}/${thumb}`}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        </span>

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2.5 flex-wrap">
            {label && <span className="text-[12px] font-extrabold text-sub">{label}</span>}
            <span className="text-[14px] font-extrabold num">{o.id}</span>
            {o.meta.format === 'pdf' && !o.meta.pdf?.ppi ? (
              <span className={`${pill} bg-surface3 text-sub`}>
                {o.meta.pdf?.imageCount === 0 ? 'PDF（ベクター）' : 'PDF'}
              </span>
            ) : (
              <span className={`${pill} ${v.cls}`}>
                {o.meta.format === 'pdf' ? 'PDF ' : ''}
                {v.label} {o.judgement.effectiveDpi}dpi
              </span>
            )}
            {o.estimate ? (
              <span className={`${pill} bg-accentSoft text-accent num`}>見積 {yen(o.estimate.subtotalYen)}（税別）</span>
            ) : (
              hasAnyOption(o.options) && (
                <span className={`${pill} bg-accentSoft text-accent`}>
                  オプション ¥{(o.optionPriceYen ?? 0).toLocaleString('ja-JP')}
                </span>
              )
            )}
            {o.adjust && <span className={`${pill} bg-surface3 text-ink`}>調整済み</span>}
            {(hasAnyOption(o.options) || o.adjust) && <PrintStatus order={o} />}
          </span>
          <span className="block text-[13px] mt-1 truncate">
            {showCustomer ? `${o.customer.name || '（名前なし）'} ・ ` : ''}
            {getProduct(o.adjust?.productId ?? o.options.productId).label} {sizeLabel(o)}
            {qtyText}
          </span>
          <span className="block text-[11.5px] text-faint num mt-0.5">
            {new Date(o.createdAt).toLocaleString('ja-JP')} ・ {formatPx(o.meta.width)} × {formatPx(o.meta.height)} px ・{' '}
            {formatBytes(o.meta.bytes)}
          </span>
        </span>

        <span className="text-faint shrink-0">{isOpen ? '−' : '+'}</span>
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-4">
          <div className="grid gap-5 md:grid-cols-[300px_1fr]">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/file/${o.id}/${hasFile(o, 'guide.jpg') ? 'guide.jpg' : thumb}`}
                alt="断裁位置ガイド"
                className="w-full rounded-[10px] border border-line bg-surface2"
              />
              <p className="text-[11px] text-faint mt-2 leading-relaxed">
                {hasFile(o, 'guide.jpg')
                  ? '赤い破線が断裁位置。外側が塗り足し。LINE でお客さんに見せるならこれ。'
                  : 'お客さんが送った画像'}
              </p>
            </div>

            <div>
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[12.5px] mb-4">
                {[
                  ['連絡先', o.customer.contact || '—'],
                  [
                    '見積もり',
                    o.estimate
                      ? `税別 ${yen(o.estimate.subtotalYen)} ／ 税込 ${yen(o.estimate.totalYen)}　` +
                        o.estimate.lines
                          .map((l) => `${l.label}${l.detail ? `［${l.detail}］` : ''} ${yen(l.yen)}`)
                          .join('　')
                      : '—（見積もり機能より前の案件）',
                  ],
                  ['元ファイル名', o.originalName],
                  ['比率の合わせかた', FIT_TEXT[fit] ?? fit],
                  [
                    'オプション',
                    hasAnyOption(o.options)
                      ? `${[hasBleedOption(o.options) && OPTIONS.bleed.label, hasUpscaleOption(o.options) && OPTIONS.upscale.label]
                          .filter(Boolean)
                          .join(' ＋ ')}  ¥${(o.optionPriceYen ?? 0).toLocaleString('ja-JP')}＋税`
                      : 'なし',
                  ],
                  [
                    '入稿データ',
                    o.print?.status === 'done'
                      ? `${o.print.canvasW} × ${o.print.canvasH} px @ ${o.print.dpi}dpi（紙面 ${o.print.pageWidthMm} × ${o.print.pageHeightMm} mm）`
                      : o.print?.status === 'pending'
                        ? '生成中…'
                        : (o.print?.error ?? '未生成'),
                  ],
                  [
                    'カラー',
                    o.print?.colour
                      ? `${o.print.colour.mode} / ${o.print.colour.profile}${o.print.colour.outputIntent ? '（出力インテント埋め込み）' : ''}`
                      : '—',
                  ],
                  [
                    '高解像度化',
                    o.print?.upscale?.used
                      ? `Upscayl ${o.print.upscale.scale}倍 / ${o.print.upscale.model}（${o.print.upscale.seconds}秒）${o.print.upscale.note ? ' ' + o.print.upscale.note : ''}`
                      : (o.print?.upscale?.note ?? '—'),
                  ],
                  ...(o.print?.expand
                    ? [
                        [
                          'AI描き足し',
                          o.print.expand.used
                            ? `${o.print.expand.provider}（${o.print.expand.seconds}秒）${o.print.expand.note ? ' ' + o.print.expand.note : ''}`
                            : (o.print.expand.note ?? '—'),
                        ],
                      ]
                    : []),
                ].map(([k, val]) => (
                  <div key={k} className="contents">
                    <dt className="text-sub">{k}</dt>
                    <dd className="font-medium break-all num">{val}</dd>
                  </div>
                ))}
              </dl>

              {o.customer.note && (
                <div className="rounded-card bg-surface2 px-3.5 py-3 mb-4">
                  <p className="text-[11px] font-bold text-sub mb-1">ご要望</p>
                  <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{o.customer.note}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/admin/zip/${o.id}`}
                  className="inline-flex items-center h-[40px] px-4 rounded-pill bg-ink text-white text-[12.5px] font-bold"
                >
                  一式をZIPで保存
                </a>
                {pdfFile && (
                  <a
                    href={`/api/admin/file/${o.id}/${pdfFile.filename}?dl=1`}
                    className="inline-flex items-center h-[40px] px-4 rounded-pill bg-accent text-white text-[12.5px] font-bold"
                  >
                    トンボ付きPDF・CMYK（{formatBytes(pdfFile.bytes)}）
                  </a>
                )}
                {printFile && (
                  <a
                    href={`/api/admin/file/${o.id}/${printFile.filename}?dl=1`}
                    className="inline-flex items-center h-[40px] px-4 rounded-pill border border-lineStrong text-[12.5px] font-bold"
                  >
                    RGBマスター（{formatBytes(printFile.bytes)}）
                  </a>
                )}
                {o.files
                  .filter((f) => f.kind === 'original')
                  .map((f) => (
                    <a
                      key={f.filename}
                      href={`/api/admin/file/${o.id}/${f.filename}?dl=1`}
                      className="inline-flex items-center h-[40px] px-4 rounded-pill border border-lineStrong text-[12.5px] font-bold"
                    >
                      原本（{formatBytes(f.bytes)}）
                    </a>
                  ))}
              </div>
            </div>
          </div>

          {canAdjust && (
            <AdjustPanel
              key={`${o.id}-${o.adjust?.updatedAt ?? 'initial'}`}
              order={o}
              capabilities={capabilities}
              onSubmitted={load}
            />
          )}
        </div>
      )}
    </article>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/orders');
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    const j = await res.json();
    setOrders(j.orders ?? []);
    setCapabilities(j.capabilities ?? null);
    setAuthed(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 裏で生成している案件があるあいだは、完了するまで自動で追いかける
  useEffect(() => {
    if (!orders.some((o) => o.print?.status === 'pending')) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [orders, load]);

  // 同じ注文でまとめて送られたデザインを、受付番号ごとに束ねる（一覧は新しい順）
  const groups = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const g = o.groupId ?? o.id;
      const list = map.get(g) ?? [];
      list.push(o);
      map.set(g, list);
    }
    return [...map.entries()].map(([gid, list]) => ({
      gid,
      list: list.sort((a, b) => (a.designIndex ?? 1) - (b.designIndex ?? 1)),
    }));
  }, [orders]);

  const login = async () => {
    setError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'ログインできませんでした');
      return;
    }
    setPassword('');
    load();
  };

  if (authed === null) {
    return <div className="min-h-[100dvh] grid place-items-center text-sub text-[13px]">読み込み中…</div>;
  }

  if (!authed) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-6">
        <div className="w-full max-w-[340px]">
          <h1 className="text-[20px] font-extrabold mb-1.5">受付管理</h1>
          <p className="text-[13px] text-sub mb-6">パスワードを入力してください。</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            className="w-full rounded-card border border-line px-4 h-[52px] text-[15px] outline-none focus:border-ink mb-3"
            placeholder="パスワード"
            autoFocus
          />
          {error && <p className="text-[12.5px] text-ng mb-3">{error}</p>}
          <Button full onClick={login}>
            ログイン
          </Button>
        </div>
      </main>
    );
  }

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  return (
    <main className="min-h-[100dvh] bg-surface2/50">
      <header className="sticky top-0 z-10 bg-white border-b border-line">
        <div className="max-w-[1100px] mx-auto px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[16px] font-extrabold">受付管理</h1>
            <span className="text-[12px] text-sub num">
              {groups.length} 件{orders.length !== groups.length ? `（${orders.length}点）` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-[12.5px] font-bold text-sub hover:text-ink px-3 py-2">
              再読み込み
            </button>
            <button
              onClick={async () => {
                await fetch('/api/admin/login', { method: 'DELETE' });
                setAuthed(false);
              }}
              className="text-[12.5px] font-bold text-sub hover:text-ink px-3 py-2"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-7">
        {orders.length === 0 && (
          <p className="text-[13.5px] text-sub py-20 text-center">まだ受け付けた画像はありません。</p>
        )}

        <div className="space-y-3">
          {groups.map(({ gid, list }) => {
            if (list.length === 1) {
              const o = list[0];
              return (
                <OrderArticle
                  key={o.id}
                  o={o}
                  isOpen={open === o.id}
                  onToggle={() => toggle(o.id)}
                  capabilities={capabilities}
                  load={load}
                  showCustomer
                />
              );
            }
            const total = sumEstimates(list.map((o) => o.estimate));
            const head = list[0];
            return (
              <section key={gid} className="rounded-card border border-ink/15 bg-white overflow-hidden">
                <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-surface2/70">
                  <span className="text-[15px] font-extrabold num">{gid}</span>
                  <span className="text-[13px] font-bold">{head.customer.name || '（名前なし）'}</span>
                  <span className="text-[12px] text-sub">
                    {getProduct(head.options.productId).label} ・ {list.length}点 ・{' '}
                    {new Date(head.createdAt).toLocaleString('ja-JP')}
                  </span>
                  <span className="ml-auto text-[13px] font-extrabold num">
                    合計 税別 {yen(total.subtotalYen)} ／ 税込 {yen(total.totalYen)}
                  </span>
                </div>
                <div className="p-2.5 space-y-2">
                  {list.map((o) => (
                    <OrderArticle
                      key={o.id}
                      o={o}
                      label={`デザイン ${o.designIndex ?? '?'}/${o.designCount ?? list.length}`}
                      isOpen={open === o.id}
                      onToggle={() => toggle(o.id)}
                      capabilities={capabilities}
                      load={load}
                      showCustomer={false}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
