'use client';

import { motion } from 'framer-motion';
import React from 'react';

/* ── ボタン ───────────────────────────────── */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet';
  full?: boolean;
};

export function Button({
  variant = 'primary',
  full,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const styles = {
    primary:
      'bg-ink text-white hover:bg-black active:scale-[.985] disabled:bg-surface3 disabled:text-faint',
    ghost:
      'bg-white text-ink border border-lineStrong hover:bg-surface2 active:scale-[.985] disabled:text-faint',
    quiet: 'bg-transparent text-sub hover:text-ink',
  }[variant];

  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-pill px-6 h-[54px] text-[15px] font-bold transition-all disabled:cursor-not-allowed disabled:active:scale-100 ${styles} ${
        full ? 'w-full' : ''
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ── 選択肢カード ─────────────────────────── */

export function Choice({
  selected,
  title,
  note,
  right,
  onClick,
  disabled,
}: {
  selected: boolean;
  title: React.ReactNode;
  note?: React.ReactNode;
  right?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full text-left rounded-card border px-4 py-3.5 transition-all ${
        selected
          ? 'border-ink bg-white shadow-soft'
          : 'border-line bg-white hover:border-lineStrong'
      } ${disabled ? 'opacity-45 cursor-not-allowed' : 'active:scale-[.995]'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 grid place-items-center w-[20px] h-[20px] rounded-full border-2 transition-colors ${
            selected ? 'border-ink' : 'border-lineStrong'
          }`}
        >
          <motion.span
            initial={false}
            animate={{ scale: selected ? 1 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="w-[10px] h-[10px] rounded-full bg-ink"
          />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-bold leading-snug">{title}</span>
          {note ? (
            <span className="block text-[12.5px] text-sub mt-1 leading-relaxed">{note}</span>
          ) : null}
        </span>
        {right ? <span className="shrink-0 pl-2">{right}</span> : null}
      </div>
    </button>
  );
}

/* ── 見出し ───────────────────────────────── */

export function StepHeading({
  step,
  title,
  lead,
}: {
  step?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {step ? (
        <p className="text-[11px] font-bold tracking-[.14em] text-faint num mb-2">{step}</p>
      ) : null}
      <h1 className="text-[24px] leading-[1.35] font-extrabold tracking-tight">{title}</h1>
      {lead ? <p className="mt-2.5 text-[14px] leading-relaxed text-sub">{lead}</p> : null}
    </header>
  );
}

/* ── 進捗バー ─────────────────────────────── */

export function TopProgress({ value }: { value: number }) {
  return (
    <div className="h-[3px] w-full bg-surface3 overflow-hidden">
      <motion.div
        className="h-full bg-ink"
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ type: 'spring', stiffness: 160, damping: 26 }}
      />
    </div>
  );
}

/* ── 画面の入れ替えアニメーション ─────────── */

export const screenMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

/* ── 下部固定のアクション帯 ───────────────── */

export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-white via-white to-white/0 pt-6 safe-bottom">
      {children}
    </div>
  );
}

/* ── 判定バッジ ───────────────────────────── */

export function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ideal: { label: 'きれい', cls: 'bg-okSoft text-ok' },
    ok: { label: '十分', cls: 'bg-okSoft text-ok' },
    low: { label: 'ぎりぎり', cls: 'bg-warnSoft text-warn' },
    ng: { label: '注意', cls: 'bg-ngSoft text-ng' },
  };
  const v = map[verdict] ?? map.ok;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-3 h-[26px] text-[12px] font-bold ${v.cls}`}
    >
      <span className="w-[6px] h-[6px] rounded-full bg-current" />
      {v.label}
    </span>
  );
}
