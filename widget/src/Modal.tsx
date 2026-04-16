import { useEffect, useMemo, useState } from 'react';
import {
  BrandPickerData,
  RecommendationResult,
  fetchReferenceItems,
  postEvent,
  postRecommend,
} from './api';

interface Props {
  shopDomain: string;
  shopifyProductId: string;
  productTitle: string;
  proxyBase: string;
  onClose: () => void;
}

type Step = 'loading' | 'brand' | 'item' | 'size' | 'fit' | 'result' | 'error';

type FitPref = 'trim' | 'standard' | 'relaxed';

export function Modal(props: Props) {
  const [step, setStep] = useState<Step>('loading');
  const [data, setData] = useState<BrandPickerData | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [itemName, setItemName] = useState<string | null>(null);
  const [refSize, setRefSize] = useState<string | null>(null);
  const [fitPref, setFitPref] = useState<FitPref>('standard');
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchReferenceItems(props.proxyBase)
      .then((d) => {
        setData(d);
        setStep('brand');
      })
      .catch((e) => {
        setErr(String(e));
        setStep('error');
      });
  }, [props.proxyBase]);

  const brands = useMemo(() => (data ? Object.keys(data.brands).sort() : []), [data]);
  const items = useMemo(
    () => (brand && data ? Object.keys(data.brands[brand]) : []),
    [brand, data]
  );
  const sizes = useMemo(
    () => (brand && itemName && data ? data.brands[brand][itemName].sizes : []),
    [brand, itemName, data]
  );

  async function submit() {
    if (!brand || !itemName || !refSize || !data) return;
    const ids = data.brands[brand][itemName].ids;
    const sizeIdx = data.brands[brand][itemName].sizes.indexOf(refSize);
    const refId = ids[sizeIdx];
    try {
      const r = await postRecommend(props.proxyBase, {
        shopDomain: props.shopDomain,
        shopifyProductId: props.shopifyProductId,
        referenceItemId: refId,
        fitPreference: fitPref,
      });
      setResult(r);
      setStep('result');
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setStep('error');
    }
  }

  function onPickRecommended() {
    if (!result) return;
    postEvent(props.proxyBase, {
      shopDomain: props.shopDomain,
      shopifyProductId: props.shopifyProductId,
      eventType: 'recommended_size_clicked',
      payload: { size: result.recommendedSize, confidence: result.confidence },
    });

    // Try to click the matching theme variant/size option on the PDP.
    // We match by visible text on any radio label or select option.
    const target = result.recommendedSize.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label, option, button')) as HTMLElement[];
    for (const el of labels) {
      const text = el.textContent?.trim().toLowerCase() ?? '';
      if (text === target) {
        if (el.tagName === 'OPTION') {
          const sel = (el as HTMLOptionElement).parentElement as HTMLSelectElement | null;
          if (sel) {
            sel.value = (el as HTMLOptionElement).value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          el.click();
        }
        break;
      }
    }

    props.onClose();
  }

  return (
    <div className="ht-modal-overlay" onClick={props.onClose}>
      <div className="ht-modal" onClick={(e) => e.stopPropagation()}>
        <button className="ht-modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>

        {step === 'loading' && <div className="ht-step">Loading…</div>}

        {step === 'brand' && (
          <div className="ht-step">
            <h2>What brand fits you best?</h2>
            <p className="ht-help">Pick a brand you already own something from.</p>
            <div className="ht-grid">
              {brands.map((b) => (
                <button
                  key={b}
                  className={`ht-chip ${brand === b ? 'active' : ''}`}
                  onClick={() => {
                    setBrand(b);
                    setItemName(null);
                    setRefSize(null);
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
            <div className="ht-actions">
              <button
                className="ht-primary"
                disabled={!brand}
                onClick={() => setStep('item')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'item' && (
          <div className="ht-step">
            <h2>Which item fits you well?</h2>
            <p className="ht-help">We'll match your {props.productTitle} against it.</p>
            <div className="ht-grid">
              {items.map((it) => (
                <button
                  key={it}
                  className={`ht-chip ${itemName === it ? 'active' : ''}`}
                  onClick={() => {
                    setItemName(it);
                    setRefSize(null);
                  }}
                >
                  {it}
                </button>
              ))}
            </div>
            <div className="ht-actions">
              <button className="ht-secondary" onClick={() => setStep('brand')}>
                Back
              </button>
              <button
                className="ht-primary"
                disabled={!itemName}
                onClick={() => setStep('size')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'size' && (
          <div className="ht-step">
            <h2>What size do you wear in it?</h2>
            <div className="ht-grid">
              {sizes.map((s) => (
                <button
                  key={s}
                  className={`ht-chip ${refSize === s ? 'active' : ''}`}
                  onClick={() => setRefSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="ht-actions">
              <button className="ht-secondary" onClick={() => setStep('item')}>
                Back
              </button>
              <button
                className="ht-primary"
                disabled={!refSize}
                onClick={() => setStep('fit')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'fit' && (
          <div className="ht-step">
            <h2>Preferred fit?</h2>
            <p className="ht-help">Optional — helps us dial in the recommendation.</p>
            <div className="ht-grid">
              {(['trim', 'standard', 'relaxed'] as FitPref[]).map((f) => (
                <button
                  key={f}
                  className={`ht-chip ${fitPref === f ? 'active' : ''}`}
                  onClick={() => setFitPref(f)}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="ht-actions">
              <button className="ht-secondary" onClick={() => setStep('size')}>
                Back
              </button>
              <button className="ht-primary" onClick={submit}>
                Get My Size
              </button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="ht-step">
            <p className="ht-result-label">Your recommended size</p>
            <div className="ht-result-size">{result.recommendedSize}</div>
            <div className="ht-confidence">{result.confidence}% confidence</div>
            <p className="ht-fit-note">{result.fitNote}</p>
            <div className="ht-actions">
              <button className="ht-primary full" onClick={onPickRecommended}>
                Select Size {result.recommendedSize}
              </button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="ht-step">
            <h2>Something went wrong</h2>
            <p className="ht-help">{err}</p>
            <div className="ht-actions">
              <button className="ht-primary" onClick={props.onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
