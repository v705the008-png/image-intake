import type { FitMode } from '@/lib/products';

/**
 * 「縁なし / 縁あり」の参考図。
 * 赤い破線＝仕上がりサイズ（断裁線）。2 つの図で枠の位置はそろえてある。
 *  - 縁なし: 絵柄が枠いっぱい。はみ出した部分（薄いほう）は裁ち落とされる。
 *  - 縁あり: 絵柄が全部入るかわりに、上下（または左右）に白い余白が残る。
 */

const SHEET = { x: 11, y: 8, w: 50, h: 68 }; // 仕上がりサイズの枠

/** 中に描く絵柄のサンプル。空・太陽・山 のかんたんな風景。 */
function Scene({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill="#dfe4ff" />
      <circle
        cx={x + w * 0.73}
        cy={y + h * 0.25}
        r={Math.min(w, h) * 0.14}
        fill="#2a4bff"
        opacity=".85"
      />
      <path
        d={`M${x - 2} ${y + h} L${x + w * 0.34} ${y + h * 0.42} L${x + w * 0.64} ${y + h} Z`}
        fill="#2a4bff"
        opacity=".4"
      />
      <path
        d={`M${x + w * 0.28} ${y + h} L${x + w * 0.72} ${y + h * 0.56} L${x + w + 2} ${y + h} Z`}
        fill="#2a4bff"
        opacity=".75"
      />
    </>
  );
}

const TRIM = {
  fill: 'none',
  stroke: '#ff2d55',
  strokeWidth: 1.4,
  strokeDasharray: '4 3',
} as const;

export function FitIllustration({ mode }: { mode: FitMode }) {
  const s = SHEET;
  const clip = `fit-clip-${mode}`;

  if (mode === 'cover') {
    // 絵柄は枠より一回り大きく置き、枠の外は薄く（＝切り落とされる部分）見せる。
    const art = { x: 2, y: 2, w: 68, h: 80 };
    return (
      <svg width="60" height="70" viewBox="0 0 72 84" role="img" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} />
          </clipPath>
        </defs>
        <g opacity=".22">
          <Scene {...art} />
        </g>
        <g clipPath={`url(#${clip})`}>
          <Scene {...art} />
        </g>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} {...TRIM} />
      </svg>
    );
  }

  // 縁あり: 絵柄は全部入る。比率のちがいが上下の余白（縁）になる。
  return (
    <svg width="60" height="70" viewBox="0 0 72 84" role="img" aria-hidden="true">
      <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#ffffff" />
      <Scene x={s.x} y={s.y + 15} w={s.w} h={s.h - 30} />
      <rect x={s.x} y={s.y} width={s.w} height={s.h} {...TRIM} />
    </svg>
  );
}
