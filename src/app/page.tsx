'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Onboarding } from '@/components/Onboarding';
import { DoneStep, type DoneResult } from '@/components/flow/DoneStep';
import { PickStep, type DesignDraft } from '@/components/flow/PickStep';
import { SendStep } from '@/components/flow/SendStep';
import { SpecStep } from '@/components/flow/SpecStep';
import { WhoStep } from '@/components/flow/WhoStep';
import { TopProgress, screenMotion } from '@/components/ui';
import { MAX_DESIGNS } from '@/lib/pricing';
import { getProduct, type ProductId } from '@/lib/products';
import type { CustomerInfo, OrderOptions } from '@/lib/types';
import { readLocalSize, startUpload, type UploadHandle, type UploadResult } from '@/lib/uploader';

type Phase = 'intro' | 'pick' | 'spec' | 'who' | 'sending' | 'done';

const ORDER: Phase[] = ['pick', 'spec', 'who'];

/** 同時に送る数。大きな PDF の後ろで、小さな画像が待たされないようにする */
const MAX_PARALLEL_UPLOADS = 3;

/** デザイン1点ぶんの初期設定。画像が横長なら向きも横長にしておく */
function defaultOptions(productId: ProductId, size: { width: number; height: number } | null): OrderOptions {
  const p = getProduct(productId);
  return {
    productId,
    sizeId: p.defaultSizeId,
    orientation: size && size.width > size.height ? 'landscape' : 'portrait',
    fit: 'cover',
    bleedOption: false,
    upscaleOption: false,
    quantity: productId === 'sticker' ? 30 : 1,
    stickerFinish: 'sheet',
    stickerShape: 'rect',
    // 以下はお客さんには見せない既定値
    bleedMm: p.defaultBleedMm,
    bleedMode: 'mirror',
    bleedColor: '#ffffff',
    padColor: '#ffffff',
  };
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [productId, setProductId] = useState<ProductId>('poster');
  const [drafts, setDrafts] = useState<DesignDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo>({ name: '', contact: '', note: '' });
  const [sendPhase, setSendPhase] = useState(0);
  const [result, setResult] = useState<DoneResult | null>(null);

  const productRef = useRef<ProductId>('poster');
  const draftsRef = useRef<DesignDraft[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  const uploads = useRef(new Map<string, Promise<UploadResult>>());
  const removed = useRef(new Set<string>());
  // 回線が細いスマホでも詰まらないよう、同時に送る数を絞る（空きが出たら次を送る）
  const active = useRef(0);
  const waiting = useRef<(() => void)[]>([]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // 画面を離れるときにプレビュー URL を開放する
  useEffect(
    () => () => {
      draftsRef.current.forEach((d) => URL.revokeObjectURL(d.picked.previewUrl));
    },
    [],
  );

  const patchDraft = useCallback((key: string, patch: Partial<DesignDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const acquire = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (active.current < MAX_PARALLEL_UPLOADS) {
          active.current += 1;
          resolve();
        } else {
          waiting.current.push(() => {
            active.current += 1;
            resolve();
          });
        }
      }),
    [],
  );
  const release = useCallback(() => {
    active.current -= 1;
    waiting.current.shift()?.();
  }, []);

  /** 1点ぶんのアップロードを始める（空きがなければ空くのを待つ） */
  const beginUpload = useCallback(
    (key: string, file: File) => {
      const p = acquire().then(async () => {
        try {
          if (removed.current.has(key)) throw new Error('removed');
          const h = startUpload(
            file,
            (r) => patchDraft(key, { progress: r }),
            (retrying) => patchDraft(key, { retrying }),
          );
          handles.current.set(key, h);
          return await h.done;
        } finally {
          release();
        }
      });
      uploads.current.set(key, p);

      p.then(({ image, previewUrl }) => {
        setDrafts((prev) =>
          prev.map((d) => {
            if (d.key !== key) return d;
            // ブラウザで縦横が読めなかった形式（HEIC・PDF など）はサーバーの結果で補う
            const unknownSize = d.picked.width === 0 && image.width > 0;
            return {
              ...d,
              picked: {
                ...d.picked,
                ...(unknownSize ? { width: image.width, height: image.height } : {}),
                // PDF はサーバーで作った1ページ目の画像をプレビューに、埋め込み画像の解像度を判定に使う
                ...(previewUrl ? { thumbUrl: previewUrl } : {}),
                ...(image.format === 'pdf' ? { pdf: image.pdf } : {}),
              },
              options: unknownSize
                ? { ...d.options, orientation: image.width > image.height ? 'landscape' : 'portrait' }
                : d.options,
            };
          }),
        );
      }).catch((e: unknown) => {
        if (removed.current.has(key)) return;
        patchDraft(key, { error: e instanceof Error ? e.message : '送信に失敗しました', retrying: false });
      });
    },
    [acquire, release, patchDraft],
  );

  const retryUpload = useCallback(
    (key: string) => {
      const d = draftsRef.current.find((x) => x.key === key);
      if (!d) return;
      patchDraft(key, { error: null, progress: 0, retrying: false });
      beginUpload(key, d.picked.file);
    },
    [beginUpload, patchDraft],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const room = MAX_DESIGNS - draftsRef.current.length;
      if (files.length > room) setError(`一度にお預かりできるのは${MAX_DESIGNS}点までです。`);

      for (const file of files.slice(0, Math.max(0, room))) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = URL.createObjectURL(file);
        const size = await readLocalSize(file);
        const draft: DesignDraft = {
          key,
          picked: { file, previewUrl, width: size?.width ?? 0, height: size?.height ?? 0 },
          progress: 0,
          error: null,
          options: defaultOptions(productRef.current, size),
        };
        draftsRef.current = [...draftsRef.current, draft];
        setDrafts((prev) => [...prev, draft]);

        // 選んだ瞬間からアップロードを始める（設定を選んでいる間に裏で送る）
        beginUpload(key, file);
      }
    },
    [beginUpload],
  );

  const removeDraft = useCallback((key: string) => {
    removed.current.add(key);
    handles.current.get(key)?.abort();
    handles.current.delete(key);
    uploads.current.delete(key);
    setDrafts((prev) => {
      const target = prev.find((d) => d.key === key);
      if (target) URL.revokeObjectURL(target.picked.previewUrl);
      return prev.filter((d) => d.key !== key);
    });
  }, []);

  /** 商品は注文全体で1つ。変えたら全デザインのサイズ・枚数を商品の初期値に戻す */
  const setProduct = useCallback((id: ProductId) => {
    productRef.current = id;
    setProductId(id);
    const p = getProduct(id);
    setDrafts((prev) =>
      prev.map((d) => ({
        ...d,
        options: {
          ...d.options,
          productId: id,
          sizeId: p.defaultSizeId,
          bleedMm: p.defaultBleedMm,
          quantity: id === 'sticker' ? 30 : 1,
        },
      })),
    );
  }, []);

  const setDesignOptions = useCallback((key: string, patch: Partial<OrderOptions>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, options: { ...d.options, ...patch } } : d)));
  }, []);

  const copyToAll = useCallback((key: string) => {
    setDrafts((prev) => {
      const src = prev.find((d) => d.key === key);
      if (!src) return prev;
      const { sizeId, orientation, customWidthMm, customHeightMm, fit, quantity, stickerFinish, stickerShape, bleedOption, upscaleOption } =
        src.options;
      return prev.map((d) =>
        d.key === key
          ? d
          : {
              ...d,
              options: {
                ...d.options,
                sizeId,
                orientation,
                customWidthMm,
                customHeightMm,
                fit,
                quantity,
                stickerFinish,
                stickerShape,
                bleedOption,
                upscaleOption,
              },
            },
      );
    });
  }, []);

  const submit = useCallback(async () => {
    const list = draftsRef.current;
    if (list.length === 0) return;
    setPhase('sending');
    setSendPhase(0);
    setError(null);

    const tick = setInterval(() => setSendPhase((p) => Math.min(p + 1, 3)), 2200);
    try {
      const uploaded = await Promise.all(
        list.map((d) => {
          const p = uploads.current.get(d.key);
          if (!p) throw new Error('アップロードが見つかりません。画像を選び直してください。');
          return p;
        }),
      );
      setSendPhase((p) => Math.max(p, 1));

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designs: list.map((d, i) => ({
            uploadId: uploaded[i].uploadId,
            options: { ...d.options, productId: productRef.current },
          })),
          customer,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '送信に失敗しました');

      setResult(json as DoneResult);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信に失敗しました');
      setPhase('who');
    } finally {
      clearInterval(tick);
    }
  }, [customer]);

  const restart = useCallback(() => {
    draftsRef.current.forEach((d) => removeDraft(d.key));
    setCustomer({ name: '', contact: '', note: '' });
    setResult(null);
    setError(null);
    setPhase('pick');
  }, [removeDraft]);

  if (phase === 'intro') {
    return <Onboarding onDone={() => setPhase('pick')} />;
  }

  const stepIndex = ORDER.indexOf(phase);
  const canGoBack = stepIndex > 0;
  const goBack = () => {
    if (canGoBack) setPhase(ORDER[stepIndex - 1]);
  };

  return (
    <main className="min-h-[100dvh] flex flex-col bg-white">
      <TopProgress
        value={phase === 'done' ? 1 : phase === 'sending' ? 0.95 : (stepIndex + 1) / (ORDER.length + 1)}
      />

      <div className="flex items-center justify-between px-5 h-[52px] safe-top">
        <button
          type="button"
          onClick={goBack}
          className={`w-9 h-9 -ml-2 grid place-items-center rounded-full transition-opacity ${
            canGoBack && phase !== 'sending' ? 'opacity-100 hover:bg-surface2' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="前の画面へ"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M12.5 4 L6.5 10 L12.5 16" stroke="#111113" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="text-[12px] font-extrabold tracking-[.1em] text-faint">画像アップローダー</p>
        <span className="w-9" />
      </div>

      <div className="flex-1 px-6 pb-2 w-full max-w-[520px] mx-auto flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div key={phase} {...screenMotion} className="flex-1 flex flex-col">
            {phase === 'pick' && (
              <PickStep
                designs={drafts}
                error={error}
                onAdd={addFiles}
                onRemove={removeDraft}
                onRetry={retryUpload}
                onNext={() => setPhase('spec')}
              />
            )}

            {phase === 'spec' && drafts.length > 0 && (
              <SpecStep
                productId={productId}
                designs={drafts}
                setProduct={setProduct}
                setOptions={setDesignOptions}
                copyToAll={copyToAll}
                onNext={() => setPhase('who')}
              />
            )}

            {phase === 'who' && drafts.length > 0 && (
              <>
                {error && (
                  <p className="mb-4 rounded-card bg-ngSoft text-ng px-4 py-3 text-[13px] leading-relaxed">{error}</p>
                )}
                <WhoStep
                  productId={productId}
                  designs={drafts}
                  customer={customer}
                  setCustomer={(patch) => setCustomer((c) => ({ ...c, ...patch }))}
                  onSubmit={submit}
                />
              </>
            )}

            {phase === 'sending' && <SendStep phase={sendPhase} />}

            {phase === 'done' && result && <DoneStep result={result} onRestart={restart} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {phase !== 'sending' && phase !== 'done' && (
        <footer className="px-6 pb-6 pt-2 text-center">
          <p className="text-[11px] text-faint leading-relaxed">お預かりした画像は、ご依頼の制作以外には使用しません。</p>
        </footer>
      )}
    </main>
  );
}
