'use client';

import type { Estimate, EstimateTotal as Total } from '@/lib/pricing';
import { yen } from '@/lib/products';

/** 見積もりの内訳と合計。受付の各画面で同じ見た目にそろえる */
export function EstimateSummary({
  est,
  title = 'お見積もり（概算）',
  className = '',
}: {
  est: Estimate;
  title?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[12px] font-extrabold tracking-wide">{title}</p>
        <span className="text-[11px] text-faint">各項目は税別</span>
      </div>

      <dl className="space-y-2.5">
        {est.lines.map((l) => (
          <div key={l.label} className="flex items-start gap-3 text-[13px]">
            <dt className="flex-1 min-w-0">
              <span className="font-bold">{l.label}</span>
              {l.detail && <span className="block text-[11.5px] text-sub num mt-0.5">{l.detail}</span>}
            </dt>
            <dd className="font-extrabold num shrink-0">{yen(l.yen)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 pt-3 border-t border-line space-y-1 text-[12.5px] num">
        <div className="flex justify-between">
          <span className="text-sub">小計（税別）</span>
          <span className="font-bold">{yen(est.subtotalYen)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sub">消費税（10%）</span>
          <span className="font-bold">{yen(est.taxYen)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-1.5">
          <span className="font-extrabold text-[13.5px]">合計（税込）</span>
          <span className="font-extrabold text-[20px] tracking-tight">{yen(est.totalYen)}</span>
        </div>
      </div>

      {est.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {est.notes.map((n) => (
            <li key={n} className="text-[11px] text-sub leading-relaxed">
              ※ {n}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint leading-relaxed">
        表示は概算です。データを確認したうえで、正式な金額をご連絡します。
      </p>
    </div>
  );
}

/** 複数デザインをまとめた注文の合計 */
export function EstimateTotal({
  total,
  count,
  className = '',
}: {
  total: Total;
  count: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[12px] font-extrabold tracking-wide mb-3">ご注文の合計（{count}点）</p>
      <div className="space-y-1 text-[12.5px] num">
        <div className="flex justify-between">
          <span className="text-sub">小計（税別）</span>
          <span className="font-bold">{yen(total.subtotalYen)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sub">消費税（10%）</span>
          <span className="font-bold">{yen(total.taxYen)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-1.5">
          <span className="font-extrabold text-[13.5px]">合計（税込）</span>
          <span className="font-extrabold text-[22px] tracking-tight">{yen(total.totalYen)}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint leading-relaxed">
        表示は概算です。データを確認したうえで、正式な金額をご連絡します。
      </p>
    </div>
  );
}
