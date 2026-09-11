'use client';

import { MotionConfig, MotionGlobalConfig } from 'framer-motion';

// 開発中に画面の見た目だけを確認したいとき用。?nomotion を付けると演出を全て即完了させる。
// （本番ビルドでは無効）
if (
  process.env.NODE_ENV !== 'production' &&
  typeof window !== 'undefined' &&
  window.location.search.includes('nomotion')
) {
  MotionGlobalConfig.skipAnimations = true;
}

/**
 * 端末の「視差効果を減らす / 動きを減らす」設定を尊重する。
 * オンの人には移動・拡大縮小の演出が止まり、内容だけがそのまま表示される。
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
