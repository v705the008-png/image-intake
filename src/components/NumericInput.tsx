'use client';

import { useEffect, useState } from 'react';

/**
 * 整数の入力欄。
 * type="number" で入力のたびに範囲へ丸めると、消した瞬間に 0 や 1 が入り「01」「15」のようになってしまう。
 * 入力中は空欄も許して文字のまま持ち、範囲内の数字になったときだけ反映、フォーカスが外れたら範囲に収める。
 * 全角数字（１２３）も半角に直す。
 */
export function NumericInput({
  value,
  min,
  max,
  onChange,
  className,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // ＋／− ボタンなど外から値が変わったら、入力中でなければ表示を合わせる
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={text}
      aria-label={ariaLabel}
      className={className}
      onFocus={(e) => {
        setFocused(true);
        // タップしてそのまま打てば置き換わるよう、全体を選択しておく
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => {
        const t = e.target.value
          .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
          .replace(/[^0-9]/g, '')
          .replace(/^0+(?=\d)/, '');
        setText(t);
        const n = Number(t);
        if (t !== '' && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        const n = Number(text);
        const next = text === '' || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, n));
        setText(String(next));
        if (next !== value) onChange(next);
      }}
    />
  );
}
