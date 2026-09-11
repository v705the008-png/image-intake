'use client';

import { STICKER_FINISHES, STICKER_SHAPES, clampQuantity, validFinish, validShape } from '@/lib/pricing';
import { FIT_MODES, OPTIONS, resolveSize } from '@/lib/products';
import type { OrderOptions } from '@/lib/types';
import { isPdfFile, type PickedFile } from './PickStep';

/** デザインの小さなサムネイル（PDF はアイコン） */
export function DesignThumb({ picked, size = 48 }: { picked: PickedFile; size?: number }) {
  return (
    <span
      className="rounded-[10px] overflow-hidden checker shrink-0 grid place-items-center border border-line"
      style={{ width: size, height: size }}
    >
      {isPdfFile(picked.file) && !picked.thumbUrl ? (
        <span className="text-[10px] font-extrabold text-accent">PDF</span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={picked.thumbUrl ?? picked.previewUrl} alt="" className="w-full h-full object-cover" />
      )}
    </span>
  );
}

/** 「A1・10枚・塗り足し・トンボ作成」のような一行の要約 */
export function designSummary(o: OrderOptions, { withFit = false }: { withFit?: boolean } = {}) {
  const size = resolveSize(o);
  const parts: string[] = [size ? size.label.split('（')[0] : 'サイズ未指定'];
  if (o.productId === 'sticker') {
    parts.push(STICKER_SHAPES.find((x) => x.id === validShape(o.stickerShape))?.label ?? '');
    parts.push(STICKER_FINISHES.find((x) => x.id === validFinish(o.stickerFinish))?.label ?? '');
  }
  if (o.productId !== 'tapestry') {
    parts.push(`${clampQuantity(o.quantity)}枚`);
  }
  if (withFit) parts.push(FIT_MODES.find((m) => m.id === o.fit)?.label ?? '');
  if (o.bleedOption) parts.push(OPTIONS.bleed.label);
  if (o.upscaleOption) parts.push(OPTIONS.upscale.label);
  return parts.filter(Boolean).join('・');
}
