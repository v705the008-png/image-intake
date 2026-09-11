'use client';

import { useEffect, useRef, useState } from 'react';
import type { BleedMode, FitMode } from '@/lib/products';

/**
 * 【現在このコンポーネントは画面に出していません】
 * お客さんには「預けたあと、こちらで仕上げる」体験にしたいため、
 * 塗り足しの即時プレビューは意図的に外してあります。
 * 見せる方針に戻したくなったら SpecStep のオプションカードに差し込めば復活します。
 *
 * 実際に出来上がる入稿データを、その場でブラウザ上に再現して見せる。
 * サーバー側（sharp）の処理と同じ手順を canvas で描いているので、
 * 「鏡ばりにすると絵が二重になる」といったことを送る前に目で確かめられる。
 */
const MAX_SIDE = 240;
/** 表示上いちばん細くてもこれだけは見えるようにする幅（px） */
const MIN_VISIBLE_BLEED = 12;

/**
 * 画面上の塗り足し幅を決める。
 * 実寸どおりだと 3mm / 594mm＝1px 未満になって何も見えないので、
 * 細すぎるときは見える太さまで広げ、その旨を呼び出し側から明示する。
 */
export function previewBleed(trimRatio: number, bleedRatio: number) {
  const trimW = trimRatio >= 1 ? MAX_SIDE : MAX_SIDE * trimRatio;
  const trimH = trimRatio >= 1 ? MAX_SIDE / trimRatio : MAX_SIDE;
  const raw = Math.min(trimW, trimH) * bleedRatio;
  if (bleedRatio <= 0) return { trimW, trimH, bleed: 0, exaggerated: false };
  return {
    trimW,
    trimH,
    bleed: Math.max(MIN_VISIBLE_BLEED, Math.round(raw)),
    exaggerated: raw < MIN_VISIBLE_BLEED,
  };
}

export function BleedPreview({
  src,
  trimRatio,
  bleedRatio,
  fit,
  mode,
  color,
}: {
  src: string;
  /** 仕上がりの 横/縦 比 */
  trimRatio: number;
  /** 塗り足しが仕上がり短辺に対して占める割合 */
  bleedRatio: number;
  fit: FitMode;
  mode: BleedMode;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = src;
    return () => {
      el.onload = null;
    };
  }, [src]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !img) return;

    const p = previewBleed(trimRatio, bleedRatio);
    const bleed = p.bleed;
    const trimW = Math.round(p.trimW);
    const trimH = Math.round(p.trimH);
    const cw = Math.round(p.trimW + bleed * 2);
    const ch = Math.round(p.trimH + bleed * 2);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cw * dpr;
    cv.height = ch * dpr;
    cv.style.width = `${cw}px`;
    cv.style.height = `${ch}px`;

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    if (fit === 'cover') {
      // 塗り足しまで含めた紙面いっぱいを絵柄で埋める
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s;
      const dh = ih * s;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    } else {
      // 仕上がり枠の内側に絵柄を収め、まわりを埋める
      const s = Math.min(trimW / iw, trimH / ih);
      const dw = iw * s;
      const dh = ih * s;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      if (mode === 'color') {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, cw, ch);
      } else if (mode === 'extend') {
        // いちばん外側の 1px を外へ引き伸ばす
        ctx.drawImage(img, 0, 0, 1, ih, 0, dy, dx, dh);
        ctx.drawImage(img, iw - 1, 0, 1, ih, dx + dw, dy, cw - dx - dw, dh);
        ctx.drawImage(img, 0, 0, iw, 1, dx, 0, dw, dy);
        ctx.drawImage(img, 0, ih - 1, iw, 1, dx, dy + dh, dw, ch - dy - dh);
        ctx.drawImage(img, 0, 0, 1, 1, 0, 0, dx, dy);
        ctx.drawImage(img, iw - 1, 0, 1, 1, dx + dw, 0, cw - dx - dw, dy);
        ctx.drawImage(img, 0, ih - 1, 1, 1, 0, dy + dh, dx, ch - dy - dh);
        ctx.drawImage(img, iw - 1, ih - 1, 1, 1, dx + dw, dy + dh, cw - dx - dw, ch - dy - dh);
      } else {
        // 鏡ばり：上下左右と四隅に、反転した複製を並べる。
        // 反転の基準線に原点を置いてから scale(-1) するので、複製は必ず原画の外側に出る。
        const put = (fx: number, fy: number, ox: number, oy: number) => {
          ctx.save();
          ctx.translate(ox, oy);
          ctx.scale(fx, fy);
          ctx.drawImage(img, 0, 0, dw, dh);
          ctx.restore();
        };
        const l = dx;
        const r = dx + dw * 2;
        const t = dy;
        const b = dy + dh * 2;
        put(-1, 1, l, dy); // 左
        put(-1, 1, r, dy); // 右
        put(1, -1, dx, t); // 上
        put(1, -1, dx, b); // 下
        put(-1, -1, l, t); // 左上
        put(-1, -1, r, t); // 右上
        put(-1, -1, l, b); // 左下
        put(-1, -1, r, b); // 右下
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    // 断裁位置
    if (bleed > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff2d55';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(bleed + 0.5, bleed + 0.5, cw - bleed * 2 - 1, ch - bleed * 2 - 1);
      ctx.restore();
    }
  }, [img, trimRatio, bleedRatio, fit, mode, color]);

  return (
    <div className="grid place-items-center">
      <canvas
        ref={ref}
        className="rounded-[3px] ring-1 ring-line"
        aria-label="出来上がる入稿データのプレビュー"
      />
    </div>
  );
}
