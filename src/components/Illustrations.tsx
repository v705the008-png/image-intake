'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * オンボーディング用の線画イラスト。
 * すべて手描きの SVG で、framer-motion では pathLength / opacity / 位置 のみを動かす。
 * （SVG の d 属性そのものをアニメーションさせると描画が止まらなくなるため使わない）
 */

const INK = '#111113';
const ACCENT = '#2a4bff';

/**
 * 端末で「視差効果を減らす」がオンのときは、線を引く演出をやめて完成形をそのまま出す。
 * 情報は同じだけ伝わり、動きだけが消える。
 */
/**
 * 「動きを減らす」設定を、マウント後にだけ反映する。
 * サーバーは端末の設定を知らないので、最初の描画で分岐するとサーバーとクライアントの
 * HTML が食い違い（hydration mismatch）、イラストが薄いまま固まってしまう。
 */
function useStaticMotion() {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return Boolean(mounted && reduced);
}

function mkDraw(reduced: boolean | null) {
  return (delay = 0, duration = 0.9) =>
    reduced
      ? {
          initial: { pathLength: 1, opacity: 1 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 0 },
        }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: {
            pathLength: { delay, duration, ease: 'easeInOut' as const },
            opacity: { delay, duration: 0.2 },
          },
        };
}

const base = {
  fill: 'none',
  stroke: INK,
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const accent = { ...base, stroke: ACCENT };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 210" className="w-full h-full" role="img" aria-hidden>
      {children}
    </svg>
  );
}

/* ── 1. ようこそ ─────────────────────────────── */
export function IlloWelcome() {
  const reduced = useStaticMotion();
  const draw = mkDraw(reduced);
  const rep = reduced ? 0 : Infinity;
  return (
    <Frame>
      {/* スマホ */}
      <motion.rect x="26" y="42" width="76" height="126" rx="12" {...base} {...draw(0.1, 0.8)} />
      <motion.line x1="52" y1="54" x2="76" y2="54" {...base} {...draw(0.5, 0.2)} />
      <motion.rect x="38" y="70" width="52" height="52" rx="4" {...accent} {...draw(0.6, 0.6)} />
      <motion.path d="M42 112 L58 92 L68 104 L78 94 L86 112 Z" {...accent} {...draw(0.9, 0.6)} />
      <motion.circle cx="76" cy="82" r="4.5" {...accent} {...draw(1.2, 0.3)} />

      {/* 受け渡しの矢印 */}
      <motion.path d="M110 118 C 140 118, 140 84, 172 84" {...base} {...draw(1.3, 0.7)} />
      <motion.path d="M164 78 L173 84 L164 90" {...base} {...draw(1.9, 0.3)} />

      {/* 大きな仕上がり（ポスター） */}
      <motion.rect x="188" y="34" width="104" height="140" rx="4" {...base} {...draw(1.5, 0.9)} />
      <motion.path d="M198 150 L226 108 L246 132 L262 112 L282 150 Z" {...accent} {...draw(2.1, 0.8)} />
      <motion.circle cx="258" cy="72" r="9" {...accent} {...draw(2.5, 0.4)} />

      {/* きらり */}
      <motion.g
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 1, 0], scale: [0.6, 1, 0.9] }}
        transition={{ delay: 3, duration: 1.6, repeat: rep, repeatDelay: 1.6 }}
        style={{ transformOrigin: '296px 32px' }}
      >
        <path d="M296 22 L296 42 M286 32 L306 32" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" />
      </motion.g>
    </Frame>
  );
}

/* ── 2. LINEだと圧縮される（いちばん伝えたいこと）───── */
export function IlloCompress() {
  const reduced = useStaticMotion();
  const draw = mkDraw(reduced);
  const rep = reduced ? 0 : Infinity;
  const loop = { duration: 4.4, repeat: rep, ease: 'easeInOut' as const };
  return (
    <Frame>
      {/* 元の画像 */}
      <motion.rect x="16" y="72" width="62" height="62" rx="4" {...base} {...draw(0.1, 0.6)} />
      <motion.path d="M22 126 L40 100 L52 114 L62 102 L72 126 Z" {...base} {...draw(0.5, 0.6)} />

      {/* 上のルート：LINE */}
      <motion.path d="M84 92 C 112 76, 128 66, 152 62" {...base} {...draw(0.9, 0.5)} />
      <motion.rect
        x="104" y="38" width="46" height="22" rx="11"
        fill="none" stroke={INK} strokeWidth="2.2"
        {...draw(1.2, 0.4)}
      />
      <motion.text
        x="127" y="53" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.3 }}
      >
        LINE
      </motion.text>

      {/* 圧縮された結果：小さく粗く */}
      <motion.rect x="176" y="44" width="34" height="34" rx="3" {...base} {...draw(1.7, 0.4)} />
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: reduced ? 1 : [0, 1, 1, 0.25, 1] }}
        transition={{ delay: reduced ? 0 : 2, ...loop }}
      >
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={180 + c * 7}
              y={48 + r * 7}
              width="6"
              height="6"
              fill={(r + c) % 2 === 0 ? '#c9c9cf' : '#e8e8ec'}
            />
          )),
        )}
      </motion.g>
      <motion.g
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 2.2, duration: 0.4 }}
      >
        <circle cx="236" cy="61" r="11" fill="none" stroke={INK} strokeWidth="2.2" />
        <path d="M231 56 L241 66 M241 56 L231 66" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <text x="256" y="66" fontSize="12" fontWeight="700" fill={INK}>
          粗い
        </text>
      </motion.g>

      {/* 下のルート：このページ */}
      <motion.path d="M84 116 C 112 132, 128 142, 152 148" {...accent} {...draw(1.0, 0.5)} />
      <motion.rect
        x="98" y="152" width="60" height="22" rx="11"
        fill="none" stroke={ACCENT} strokeWidth="2.2"
        {...draw(1.3, 0.4)}
      />
      <motion.text
        x="128" y="167" textAnchor="middle" fontSize="11" fontWeight="700" fill={ACCENT}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.3 }}
      >
        このページ
      </motion.text>

      {/* そのままの大きさ */}
      <motion.rect x="176" y="112" width="62" height="62" rx="4" {...accent} {...draw(1.8, 0.6)} />
      <motion.path d="M182 166 L200 140 L212 154 L222 142 L232 166 Z" {...accent} {...draw(2.2, 0.6)} />
      <motion.g
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 2.6, duration: 0.4 }}
      >
        <circle cx="264" cy="143" r="11" fill="none" stroke={ACCENT} strokeWidth="2.2" />
        <path d="M259 143 L263 148 L270 138" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="282" y="148" fontSize="12" fontWeight="700" fill={ACCENT}>
          原寸
        </text>
      </motion.g>
    </Frame>
  );
}

/* ── 3. 画像の選びかた ─────────────────────────── */
export function IlloPick() {
  const reduced = useStaticMotion();
  const draw = mkDraw(reduced);
  const rep = reduced ? 0 : Infinity;
  return (
    <Frame>
      <motion.rect x="96" y="18" width="128" height="174" rx="16" {...base} {...draw(0.1, 0.8)} />
      <motion.line x1="146" y1="30" x2="174" y2="30" {...base} {...draw(0.6, 0.2)} />

      {/* 写真グリッド */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const c = i % 3;
        const r = Math.floor(i / 3);
        const isPick = i === 4;
        return (
          <motion.rect
            key={i}
            x={108 + c * 36}
            y={46 + r * 36}
            width="30"
            height="30"
            rx="3"
            {...(isPick ? accent : base)}
            strokeWidth={isPick ? 2.6 : 1.6}
            {...draw(0.7 + i * 0.07, 0.35)}
          />
        );
      })}

      {/* タップ */}
      <motion.circle
        cx="159" cy="97" r="20"
        fill="none" stroke={ACCENT} strokeWidth="1.6"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: reduced ? 0.35 : [0, 0.5, 0], scale: reduced ? 1 : [0.5, 1.25, 1.5] }}
        transition={{ delay: 1.5, duration: 1.6, repeat: rep, repeatDelay: 0.9 }}
        style={{ transformOrigin: '159px 97px' }}
      />
      <motion.circle
        cx="159" cy="97" r="8" fill={ACCENT}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.5, duration: 0.35, type: 'spring', stiffness: 400, damping: 20 }}
        style={{ transformOrigin: '159px 97px' }}
      />

      {/* 読み取った解像度 */}
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.3, duration: 0.5 }}
      >
        <rect x="104" y="146" width="112" height="32" rx="8" fill="none" stroke={ACCENT} strokeWidth="2" />
        <text x="160" y="167" textAnchor="middle" fontSize="14" fontWeight="800" fill={ACCENT}>
          4096 × 4096
        </text>
      </motion.g>

      {/* まわりの気づき線 */}
      <motion.path d="M64 60 L86 72" {...base} strokeWidth="1.6" {...draw(2.6, 0.3)} />
      <motion.path d="M56 100 L82 100" {...base} strokeWidth="1.6" {...draw(2.7, 0.3)} />
      <motion.path d="M234 72 L256 60" {...base} strokeWidth="1.6" {...draw(2.8, 0.3)} />
      <motion.path d="M238 100 L264 100" {...base} strokeWidth="1.6" {...draw(2.9, 0.3)} />
    </Frame>
  );
}

/* ── 4. 塗り足しとは ───────────────────────────── */
export function IlloBleed() {
  const reduced = useStaticMotion();
  const draw = mkDraw(reduced);
  const rep = reduced ? 0 : Infinity;
  return (
    <Frame>
      {/* 塗り足しまで含めた紙面 */}
      <motion.rect x="72" y="24" width="176" height="162" rx="2" {...base} {...draw(0.1, 0.8)} />
      {/* 塗り足し部分のハッチング */}
      <defs>
        <clipPath id="bleed-clip">
          <rect x="72" y="24" width="176" height="162" rx="2" />
        </clipPath>
      </defs>
      <motion.g
        clipPath="url(#bleed-clip)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.6 }}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <line
            key={i}
            x1={72 + i * 9}
            y1={24}
            x2={72 + i * 9 - 20}
            y2={186}
            stroke={ACCENT}
            strokeWidth="1"
            opacity="0.3"
          />
        ))}
      </motion.g>
      {/* 仕上がり線を白で抜いて、塗り足しだけ見せる */}
      <motion.rect
        x="90" y="42" width="140" height="126"
        fill="#fff"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.6 }}
      />
      {/* 絵柄 */}
      <motion.path d="M98 160 L134 108 L156 134 L180 104 L222 160 Z" {...base} {...draw(0.7, 0.9)} />
      <motion.circle cx="196" cy="72" r="12" {...base} {...draw(1.1, 0.4)} />

      {/* 断裁線 */}
      <motion.rect
        x="90" y="42" width="140" height="126"
        fill="none" stroke="#ff2d55" strokeWidth="2" strokeDasharray="7 5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 1.7, duration: 0.9, ease: 'easeInOut' }}
      />
      <motion.text
        x="160" y="200" textAnchor="middle" fontSize="11" fontWeight="700" fill="#ff2d55"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5, duration: 0.3 }}
      >
        ここで切ります
      </motion.text>
      <motion.text
        x="34" y="30" fontSize="11" fontWeight="700" fill={ACCENT}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.3, duration: 0.3 }}
      >
        塗り足し
      </motion.text>
      <motion.path d="M56 36 L76 44" {...accent} strokeWidth="1.6" {...draw(2.4, 0.3)} />

      {/* 刃が走る */}
      <motion.g
        initial={{ opacity: 0, x: -14 }}
        animate={reduced ? { opacity: 0, x: 0 } : { opacity: [0, 1, 1, 0], x: [-14, 0, 150, 164] }}
        transition={{ delay: 3, duration: 2.4, repeat: rep, repeatDelay: 1.6, ease: 'easeInOut' }}
      >
        <path d="M84 34 L96 42 L84 50 Z" fill={INK} />
      </motion.g>
    </Frame>
  );
}

/* ── 完了 ───────────────────────────────────── */
export function IlloDone() {
  const reduced = useStaticMotion();
  const dur = reduced ? 0 : 1;
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full" role="img" aria-hidden>
      <motion.circle
        cx="100" cy="76" r="42" fill="none" stroke={ACCENT} strokeWidth="2.6"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.7 * dur, ease: 'easeInOut' }}
      />
      <motion.path
        d="M80 76 L95 92 L122 62"
        fill="none" stroke={ACCENT} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ delay: 0.5 * dur, duration: 0.5 * dur, ease: 'easeOut' }}
      />
      {[
        { x: 42, y: 34, r: -20 },
        { x: 156, y: 40, r: 18 },
        { x: 36, y: 118, r: 12 },
        { x: 162, y: 116, r: -14 },
      ].map((p, i) => (
        <motion.line
          key={i}
          x1={p.x} y1={p.y} x2={p.x + 12} y2={p.y + 4}
          stroke={INK} strokeWidth="2.2" strokeLinecap="round"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0.85], scale: 1 }}
          transition={{ delay: (0.9 + i * 0.08) * dur, duration: 0.5 * dur }}
          style={{ transformOrigin: `${p.x}px ${p.y}px`, rotate: p.r }}
        />
      ))}
    </svg>
  );
}
