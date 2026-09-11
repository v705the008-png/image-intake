'use client';

import { motion } from 'framer-motion';
import type { Estimate, EstimateTotal as Total } from '@/lib/pricing';
import { IlloDone } from '../Illustrations';
import { Button, VerdictBadge } from '../ui';
import { EstimateSummary, EstimateTotal } from './EstimateSummary';

export type DoneDesign = {
  orderId: string;
  judgement: {
    verdict: string;
    headline: string;
    detail: string;
    effectiveDpi: number;
  } | null;
  bleedOption: boolean;
  upscaleOption: boolean;
  isPdf: boolean;
  previewUrl: string | null;
  /** サーバー側で計算し直した見積もり */
  estimate: Estimate | null;
};

export type DoneResult = {
  /** お客さんに伝える受付番号（複数デザインをまとめた番号） */
  groupId: string;
  designs: DoneDesign[];
  total: Total;
};

const isRescued = (d: DoneDesign) =>
  Boolean(d.judgement && d.upscaleOption && (d.judgement.verdict === 'ng' || d.judgement.verdict === 'low'));

export function DoneStep({ result, onRestart }: { result: DoneResult; onRestart: () => void }) {
  const single = result.designs.length === 1 ? result.designs[0] : null;
  const hasOption = result.designs.some((d) => d.bleedOption || d.upscaleOption);

  return (
    <div className="flex flex-col min-h-full pt-4">
      <div className="h-[150px] mx-auto w-full max-w-[240px]">
        <IlloDone />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="text-center"
      >
        <h1 className="text-[26px] font-extrabold tracking-tight">お預かりしました</h1>
        <p className="mt-2.5 text-[13.5px] text-sub leading-relaxed">
          圧縮されていない元のデータのまま届いています。
          <br />
          内容を確認して、あらためてご連絡します。
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65, duration: 0.4 }}
        className="mt-8 rounded-hero border border-line bg-white shadow-soft overflow-hidden"
      >
        <div className="px-5 py-5 text-center border-b border-line">
          <p className="text-[11px] font-bold tracking-[.14em] text-faint">受付番号</p>
          <p className="mt-1.5 text-[26px] font-extrabold num tracking-tight">{result.groupId}</p>
          <p className="mt-2 text-[11.5px] text-faint">お問い合わせのときはこの番号をお伝えください</p>
        </div>

        {single ? (
          <>
            {single.previewUrl && (
              <>
                <div className="checker aspect-[4/3] grid place-items-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={single.previewUrl} alt="お預かりした画像" className="max-w-full max-h-full object-contain" />
                </div>
                <p className="px-5 py-2.5 text-[11px] text-faint text-center border-t border-line">お預かりした画像</p>
              </>
            )}
            <div className="px-5 py-4 border-t border-line">
              {single.judgement ? (
                isRescued(single) ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-pill px-3 h-[26px] text-[12px] font-bold bg-okSoft text-ok">
                      <span className="w-[6px] h-[6px] rounded-full bg-current" />
                      高画質化
                    </span>
                    <p className="mt-2.5 text-[14px] font-extrabold leading-snug">
                      高画質化して、キレイに印刷できるように仕上げます
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">
                      いまの画像は{single.judgement.effectiveDpi}dpi相当です。仕上がりサイズに合わせて解像度を引き上げます。
                    </p>
                  </>
                ) : (
                  <>
                    <VerdictBadge verdict={single.judgement.verdict} />
                    <p className="mt-2.5 text-[14px] font-extrabold leading-snug">{single.judgement.headline}</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-sub">{single.judgement.detail}</p>
                  </>
                )
              ) : (
                <p className="text-[13px] font-bold leading-snug">PDFをそのままお預かりしました。</p>
              )}
              {single.estimate && (
                <EstimateSummary est={single.estimate} className="mt-4 pt-4 border-t border-line" />
              )}
            </div>
          </>
        ) : (
          <div className="px-4 py-4">
            <div className="grid grid-cols-2 gap-2.5">
              {result.designs.map((d, i) => {
                const warn = d.judgement && !isRescued(d) && (d.judgement.verdict === 'ng' || d.judgement.verdict === 'low');
                return (
                  <div key={d.orderId} className="rounded-card border border-line overflow-hidden">
                    <div className="checker aspect-square grid place-items-center overflow-hidden">
                      {d.previewUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={d.previewUrl} alt={`デザイン${i + 1}`} className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-[12px] font-extrabold text-accent">PDF</span>
                      )}
                    </div>
                    <div className="px-2.5 py-2 flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-bold">デザイン {i + 1}</span>
                      {isRescued(d) ? (
                        <span className="text-[10.5px] font-bold text-ok">高画質化</span>
                      ) : warn ? (
                        <span className="text-[10.5px] font-bold text-ng">注意</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {result.designs.some((d) => d.judgement && !isRescued(d) && d.judgement.verdict === 'ng') && (
              <p className="mt-3 text-[11.5px] text-sub leading-relaxed">
                「注意」のデザインは、キレイに印刷できない可能性があります。ご連絡のときにご相談させてください。
              </p>
            )}
            <EstimateTotal total={result.total} count={result.designs.length} className="mt-4 pt-4 border-t border-line" />
          </div>
        )}

        {hasOption && (
          <p className="px-5 pb-4 text-[11.5px] leading-relaxed text-faint">
            仕上げたデータは、あらためてご連絡のうえお見せします。この画面は閉じていただいて大丈夫です。
          </p>
        )}
      </motion.div>

      <div className="flex-1 min-h-[28px]" />

      <div className="safe-bottom pb-2">
        <Button full variant="ghost" onClick={onRestart}>
          ほかの画像も送る
        </Button>
      </div>
    </div>
  );
}
