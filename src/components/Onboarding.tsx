'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { IlloBleed, IlloPick, IlloWelcome } from './Illustrations';
import { Button, TopProgress } from './ui';

const SLIDES = [
  {
    illo: IlloWelcome,
    title: '画像をそのまま\nお預かりします',
    body: 'タペストリー・ポスター・ステッカーに印刷するための画像を、このページから送ってください。3分ほどで終わります。',
  },
  {
    illo: IlloPick,
    title: '生成した画像などを\nそのままアップロードできます',
    body: 'LINEで保存した画像は小さくなってしまいます。生成された元ファイルが理想です。',
  },
  {
    illo: IlloBleed,
    title: 'ふちまでキレイに印刷するには\n仕上がりサイズよりも\n少し大きめの絵柄が必要です',
    body: '「塗り足し」といいます。必要なら塗り足し作業をこちらで行ないます（有料オプション）。',
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const slide = SLIDES[i];
  const Illo = slide.illo;
  const last = i === SLIDES.length - 1;

  const go = (next: number) => {
    if (next < 0 || next >= SLIDES.length) return;
    setDir(next > i ? 1 : -1);
    setI(next);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      <TopProgress value={(i + 1) / SLIDES.length} />

      <div className="flex items-center justify-between px-5 h-[52px] safe-top">
        <button
          type="button"
          onClick={() => go(i - 1)}
          className={`w-9 h-9 -ml-2 grid place-items-center rounded-full transition-opacity ${
            i === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100 hover:bg-surface2'
          }`}
          aria-label="前へ"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M12.5 4 L6.5 10 L12.5 16" stroke="#111113" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[13px] font-bold text-sub hover:text-ink px-2 py-1"
        >
          スキップ
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center px-7 pb-2">
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.16}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60) go(i + 1);
            else if (info.offset.x > 60) go(i - 1);
          }}
          className="cursor-grab active:cursor-grabbing"
        >
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={i}
              custom={dir}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -28 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="h-[230px] sm:h-[260px] mx-auto max-w-[380px] select-none pointer-events-none">
                <Illo />
              </div>

              <h2 className="mt-7 text-[23px] leading-[1.45] font-extrabold tracking-tight text-center whitespace-pre-line">
                {slide.title}
              </h2>
              <p className="mt-4 text-[14px] leading-[1.85] text-sub text-center max-w-[400px] mx-auto">
                {slide.body}
              </p>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="px-7 pb-2">
        <div className="flex items-center justify-center gap-2 mb-7">
          {SLIDES.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-label={`${n + 1}ページ目へ`}
              className="py-2"
            >
              <motion.span
                className="block h-[6px] rounded-full bg-ink"
                initial={false}
                animate={{ width: n === i ? 22 : 6, opacity: n === i ? 1 : 0.2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            </button>
          ))}
        </div>

        <div className="max-w-[440px] mx-auto safe-bottom">
          <Button full onClick={() => (last ? onDone() : go(i + 1))}>
            {last ? '画像を送る' : '次へ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
