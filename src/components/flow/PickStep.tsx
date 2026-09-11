'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { MAX_DESIGNS } from '@/lib/pricing';
import { formatBytes, formatPx } from '@/lib/print';
import type { OrderOptions, PdfRaster } from '@/lib/types';
import { Button, StepHeading, StickyBar } from '../ui';

export type PickedFile = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  /** PDF の1ページ目をサーバーで画像にしたもの（送信完了後に入る） */
  thumbUrl?: string;
  /** PDF に埋め込まれた画像の解像度（送信完了後、自動で読めたときだけ入る） */
  pdf?: PdfRaster;
};

/** PDF の紙面サイズ（pt）を mm で表す */
const ptToMm = (pt: number) => Math.round((pt * 25.4) / 72);

/** 高画質化を申し込めるデザインか（画像と、画像が入った PDF。ベクターの PDF は対象外） */
export const canUpscaleDesign = (p: PickedFile) => !isPdfFile(p.file) || Boolean(p.pdf?.ppi);

/** PDF の中身の一言（原寸での解像度など） */
function pdfNote(p: PickedFile) {
  if (!p.pdf) return '';
  if (p.pdf.ppi) return `・原寸 ${p.pdf.ppi}dpi`;
  return p.pdf.imageCount === 0 ? '・画像なし（ベクター）' : '・文字や図形が中心';
}

/** 注文に含まれる1点のデザイン（アップロードの進み具合と、そのデザインの設定） */
export type DesignDraft = {
  key: string;
  picked: PickedFile;
  progress: number;
  error: string | null;
  /** 通信が途切れて、送り直している最中 */
  retrying?: boolean;
  options: OrderOptions;
};

/** これより大きいファイルは送り終わるまで時間がかかるので、画面を閉じないよう案内する */
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export const isPdfFile = (f: File) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** よくある「小さい画像を送ってしまう」パターンを、送る前に気づいてもらう */
function suspicions(p: PickedFile) {
  const out: string[] = [];
  // PDF はベクターなので画素数の多さは関係ない
  if (isPdfFile(p.file) || p.width === 0) return out;
  const long = Math.max(p.width, p.height);
  const bytesPerPx = p.file.size / (p.width * p.height);
  const name = p.file.name.toLowerCase();

  // LINE は送信時に長辺 1280px 前後まで縮める。この帯に入る画像はまず LINE 経由。
  if (long >= 1150 && long <= 1320) {
    out.push(
      `長辺が ${formatPx(long)}px です。LINEは送信時に画像を1280px前後まで縮めるため、一度LINEを通った画像である可能性が高いです。元のファイルをお探しください。`,
    );
  } else if (long <= 1600) {
    out.push(`長辺が ${formatPx(long)}px しかありません。大きく印刷するには小さすぎる可能性があります。`);
  }
  if (bytesPerPx < 0.12 && long > 1600) {
    out.push('ファイルの容量に対して画素数が多く、強く圧縮された画像のようです。元のファイルがあればそちらをお使いください。');
  }
  if (/screenshot|screen_shot|スクリーンショット/.test(name)) {
    out.push('スクリーンショットのようです。画面の大きさまで縮んでいるので、元の画像をお探しください。');
  }
  if (/^line_|^image_\d{8}/.test(name)) {
    out.push('LINEで受け取った画像のようです。すでに圧縮されている可能性があります。');
  }
  return out;
}

const ACCEPT =
  'image/png,image/jpeg,image/webp,image/tiff,image/heic,image/heif,application/pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.heic,.pdf';

export function PickStep({
  designs,
  error,
  onAdd,
  onRemove,
  onRetry,
  onNext,
}: {
  designs: DesignDraft[];
  error: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  /** 送信に失敗したデザインを、もう一度送る */
  onRetry: (key: string) => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [inApp, setInApp] = useState(false);

  // LINE や Instagram のアプリ内ブラウザは、端末によって写真を選べないことがある。
  useEffect(() => {
    const ua = navigator.userAgent;
    setInApp(/\bLine\//i.test(ua) || /FBAN|FBAV|Instagram/i.test(ua));
  }, []);

  const openPicker = () => inputRef.current?.click();
  const hasErrors = designs.some((d) => d.error);

  return (
    <div className="flex flex-col min-h-full">
      <StepHeading
        step="STEP 1 / 3"
        title="画像を選んでください"
        lead="複数まとめて選べます。加工していない元のファイルを選ぶのがいちばんきれいに仕上がります。"
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = '';
        }}
      />

      {inApp && designs.length === 0 && (
        <div className="mb-4 rounded-card border border-line bg-surface2 px-4 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-sub">
            アプリの中のブラウザで開いています。写真が選べない場合は、画面の
            <span className="font-bold text-ink">「⋯」メニュー</span>
            から
            <span className="font-bold text-ink">Safari / Chrome で開く</span>
            を選んでください。
          </p>
        </div>
      )}

      {designs.length === 0 ? (
        <div>
          <button
            type="button"
            onClick={openPicker}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length) onAdd(files);
            }}
            className={`w-full rounded-hero border-2 border-dashed transition-colors ${
              dragOver ? 'border-accent bg-accentSoft' : 'border-lineStrong bg-surface2/60'
            } py-14 px-6 grid place-items-center gap-4`}
          >
            <motion.svg
              width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <rect x="8" y="14" width="48" height="38" rx="5" stroke="#111113" strokeWidth="2.4" />
              <path d="M13 45 L26 29 L34 38 L42 30 L51 45 Z" stroke="#2a4bff" strokeWidth="2.4" strokeLinejoin="round" />
              <circle cx="42" cy="24" r="4" stroke="#2a4bff" strokeWidth="2.4" />
            </motion.svg>
            <span className="text-[16px] font-extrabold">タップして画像を選ぶ</span>
            <span className="text-[12.5px] text-sub -mt-2 text-center leading-relaxed">
              複数まとめて選べます（最大{MAX_DESIGNS}点）
              <br />
              JPEG / PNG / WebP / TIFF / PDF・1点200MBまで
            </span>
          </button>

          <div className="mt-6 rounded-card bg-surface2 px-4 py-4">
            <p className="text-[12px] font-extrabold tracking-wide mb-2.5">きれいに刷るためのコツ</p>
            <ul className="space-y-2 text-[12.5px] leading-relaxed text-sub">
              {[
                'AIで作った直後に保存したファイルが、いちばん大きくてきれいです。',
                'スクリーンショットや、SNSから保存し直した画像は小さくなっています。',
                'LINEで受け取った画像を、そのままここへ送るのは避けてください。',
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-[7px] w-[4px] h-[4px] rounded-full bg-lineStrong shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {designs.map((d, i) => {
              const notes = suspicions(d.picked);
              const pdf = isPdfFile(d.picked.file);
              const uploading = !d.error && d.progress < 1;
              const status = d.error
                ? '送信できませんでした'
                : d.progress >= 1
                  ? 'アップロード完了'
                  : `アップロード中 ${Math.round(d.progress * 100)}%${d.retrying ? '（通信を再試行しています）' : ''}`;
              return (
                <motion.div
                  key={d.key}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-card border border-line bg-white overflow-hidden"
                >
                  <div className="flex items-center gap-3 p-3">
                    <span className="relative w-[64px] h-[64px] rounded-[10px] overflow-hidden checker shrink-0 grid place-items-center">
                      {pdf && !d.picked.thumbUrl ? (
                        <span className="text-[11px] font-extrabold text-accent">PDF</span>
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={pdf ? d.picked.thumbUrl : d.picked.previewUrl}
                          alt={`デザイン${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                      {pdf && d.picked.thumbUrl && (
                        <span className="absolute bottom-1 right-1 rounded-[4px] bg-ink/80 px-1 text-[9px] leading-[14px] font-extrabold text-white">
                          PDF
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold text-faint">デザイン {i + 1}</span>
                      <span className="block text-[13px] font-bold truncate">{d.picked.file.name}</span>
                      <span className="block text-[11.5px] text-sub num mt-0.5">
                        {pdf
                          ? d.picked.width > 0
                            ? `PDF・${ptToMm(d.picked.width)} × ${ptToMm(d.picked.height)} mm${pdfNote(d.picked)}`
                            : 'PDF（プレビューは送信後に表示されます）'
                          : d.picked.width > 0
                            ? `${formatPx(d.picked.width)} × ${formatPx(d.picked.height)} px`
                            : 'サイズ確認中'}
                        {' ・ '}
                        {formatBytes(d.picked.file.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(d.key)}
                      aria-label={`デザイン${i + 1}を取り消す`}
                      className="shrink-0 text-[12px] font-bold text-sub hover:text-ink px-2 py-1"
                    >
                      取り消す
                    </button>
                  </div>
                  <div className="h-[3px] bg-surface3">
                    <motion.div
                      className={`h-full ${d.error ? 'bg-ng' : 'bg-accent'}`}
                      initial={false}
                      animate={{ width: `${(d.error ? 1 : d.progress) * 100}%` }}
                      transition={{ ease: 'linear', duration: 0.2 }}
                    />
                  </div>
                  <p className="px-3 py-1.5 text-right text-[11px] text-faint num">{status}</p>
                  {uploading && d.picked.file.size > LARGE_FILE_BYTES && (
                    <p className="px-3 pb-2 -mt-0.5 text-[11px] text-faint leading-relaxed">
                      大きなファイルです。送り終わるまで、この画面を閉じずにお待ちください。
                    </p>
                  )}

                  {d.error && (
                    <div className="mx-3 mb-3 rounded-[10px] bg-ngSoft px-3 py-2.5">
                      <p className="text-ng text-[12px] leading-relaxed">{d.error}</p>
                      <button
                        type="button"
                        onClick={() => onRetry(d.key)}
                        className="mt-2 h-[34px] px-4 rounded-pill bg-ink text-white text-[12px] font-bold"
                      >
                        もう一度送る
                      </button>
                    </div>
                  )}
                  {notes.length > 0 && (
                    <div className="mx-3 mb-3 rounded-[10px] border border-ng/30 bg-ngSoft px-3 py-2.5">
                      <p className="text-[12px] font-extrabold text-ng mb-1.5">確認してください</p>
                      <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink/75">
                        {notes.map((n) => (
                          <li key={n} className="flex gap-2">
                            <span className="mt-[7px] w-[4px] h-[4px] rounded-full bg-ng shrink-0" />
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {designs.length < MAX_DESIGNS && (
            <button
              type="button"
              onClick={openPicker}
              className="w-full h-[52px] rounded-card border-2 border-dashed border-lineStrong text-[13.5px] font-extrabold text-sub hover:text-ink hover:border-ink transition-colors"
            >
              ＋ 画像を追加する
            </button>
          )}
          <p className="text-[11px] text-faint text-center">
            {designs.length}点 ・ 最大{MAX_DESIGNS}点まで
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-card bg-ngSoft text-ng px-4 py-3 text-[13px] leading-relaxed">{error}</p>
      )}

      <div className="flex-1" />

      <StickyBar>
        <Button full disabled={designs.length === 0 || hasErrors} onClick={onNext}>
          {designs.length > 1 ? `${designs.length}点で次へ` : '次へ'}
        </Button>
      </StickyBar>
    </div>
  );
}
