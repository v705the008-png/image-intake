'use client';

import { motion } from 'framer-motion';

const PHASES = [
  '画像を受け取っています',
  '解像度を確認しています',
  '塗り足しを作っています',
  '入稿データを書き出しています',
];

export function SendStep({ phase }: { phase: number }) {
  return (
    <div className="min-h-full grid place-items-center py-20">
      <div className="text-center w-full max-w-[300px]">
        <div className="relative w-[86px] h-[86px] mx-auto">
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-surface3"
            aria-hidden
          />
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-ink"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
            aria-hidden
          />
          <motion.span
            className="absolute inset-[16px] rounded-full bg-accentSoft"
            animate={{ scale: [1, 0.86, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
        </div>

        <div className="mt-8 h-[24px] relative" aria-live="polite">
          {PHASES.map((t, i) => (
            <motion.p
              key={t}
              className="absolute inset-x-0 text-[15px] font-extrabold"
              initial={false}
              animate={{ opacity: i === phase ? 1 : 0, y: i === phase ? 0 : 8 }}
              transition={{ duration: 0.3 }}
            >
              {t}
            </motion.p>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-sub leading-relaxed">
          大きな画像ほど時間がかかります。
          <br />
          このまま画面を閉じずにお待ちください。
        </p>
      </div>
    </div>
  );
}
