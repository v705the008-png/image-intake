'use client';

import { estimate, sumEstimates } from '@/lib/pricing';
import { formatPx } from '@/lib/print';
import { getProduct, yen, type ProductId } from '@/lib/products';
import type { CustomerInfo } from '@/lib/types';
import { Button, StepHeading, StickyBar } from '../ui';
import { DesignThumb, designSummary } from './DesignThumb';
import { EstimateSummary, EstimateTotal } from './EstimateSummary';
import { canUpscaleDesign, isPdfFile, type DesignDraft } from './PickStep';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-4">
      <span className="block text-[12px] font-extrabold tracking-wide mb-2">{label}</span>
      {children}
      {hint ? <span className="block text-[11.5px] text-faint mt-1.5">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'w-full rounded-card border border-line bg-white px-4 h-[52px] text-[15px] outline-none focus:border-ink transition-colors';

export function WhoStep({
  productId,
  designs,
  customer,
  setCustomer,
  onSubmit,
}: {
  productId: ProductId;
  designs: DesignDraft[];
  customer: CustomerInfo;
  setCustomer: (patch: Partial<CustomerInfo>) => void;
  onSubmit: () => void;
}) {
  const product = getProduct(productId);
  const ests = designs.map((d) =>
    estimate({ ...d.options, upscaleOption: d.options.upscaleOption && canUpscaleDesign(d.picked) }),
  );
  const total = sumEstimates(ests);
  const single = designs.length === 1 ? designs[0] : null;

  return (
    <div className="flex flex-col min-h-full">
      <StepHeading
        step="STEP 3 / 3"
        title="お名前を教えてください"
        lead="どなたからの画像か分かるようにするためだけに使います。"
      />

      <Field label="お名前 / 会社名">
        <input
          className={inputCls}
          value={customer.name}
          onChange={(e) => setCustomer({ name: e.target.value })}
          placeholder="例）田中"
          autoComplete="name"
        />
      </Field>

      <Field label="ご連絡先（任意）" hint="仕上がりの確認でこちらから連絡する場合があります。">
        <input
          className={inputCls}
          value={customer.contact}
          onChange={(e) => setCustomer({ contact: e.target.value })}
          placeholder="メールアドレス、LINEの名前など"
        />
      </Field>

      <Field label="ご要望（任意）">
        <textarea
          className="w-full rounded-card border border-line bg-white px-4 py-3.5 text-[15px] leading-relaxed outline-none focus:border-ink transition-colors min-h-[110px] resize-y"
          value={customer.note}
          onChange={(e) => setCustomer({ note: e.target.value })}
          placeholder="例）左上のロゴは切れないようにしてほしい"
        />
      </Field>

      <div className="rounded-hero border border-line bg-surface2/70 px-4 py-4 mt-2">
        <p className="text-[12px] font-extrabold tracking-wide mb-3">送る内容</p>
        <div className="flex items-baseline gap-3 text-[13px] mb-3">
          <span className="text-sub w-[100px] shrink-0 text-[12px]">商品</span>
          <span className="font-bold">
            {product.label}（{designs.length}点）
          </span>
        </div>

        {single ? (
          <>
            <div className="flex items-center gap-3 rounded-card bg-white border border-line px-3 py-2.5">
              <DesignThumb picked={single.picked} size={44} />
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-bold leading-snug num">
                  {designSummary(single.options, { withFit: true })}
                </span>
                <span className="block text-[11px] text-sub num mt-0.5">
                  {isPdfFile(single.picked.file)
                    ? 'PDF'
                    : `${formatPx(single.picked.width)} × ${formatPx(single.picked.height)} px`}
                </span>
              </span>
            </div>
            {ests[0] && <EstimateSummary est={ests[0]} className="mt-4 pt-4 border-t border-line" />}
          </>
        ) : (
          <>
            <ul className="space-y-2">
              {designs.map((d, i) => (
                <li key={d.key} className="flex items-center gap-3 rounded-card bg-white border border-line px-3 py-2.5">
                  <DesignThumb picked={d.picked} size={44} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold text-faint">デザイン {i + 1}</span>
                    <span className="block text-[12.5px] font-bold leading-snug num">
                      {designSummary(d.options, { withFit: true })}
                    </span>
                  </span>
                  <span className="text-[13px] font-extrabold num shrink-0">{yen(ests[i]?.subtotalYen ?? 0)}</span>
                </li>
              ))}
            </ul>
            <EstimateTotal total={total} count={designs.length} className="mt-4 pt-4 border-t border-line" />
          </>
        )}
      </div>

      <div className="flex-1 min-h-[24px]" />

      <StickyBar>
        <Button full disabled={customer.name.trim() === ''} onClick={onSubmit}>
          この内容で送る
        </Button>
        <p className="text-center text-[11.5px] text-faint mt-3">送信後、受付番号が表示されます</p>
      </StickyBar>
    </div>
  );
}
