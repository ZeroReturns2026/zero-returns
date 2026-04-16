// All storefront calls go through the Shopify app proxy path.
// In local dev (standalone), you can override this with window.__HEY_TAILOR_BASE__.

export function getBase(defaultBase: string): string {
  return (window as any).__HEY_TAILOR_BASE__ || defaultBase;
}

export interface BrandPickerData {
  brands: Record<
    string,
    Record<string, { itemType: string; sizes: string[]; ids: number[] }>
  >;
}

export interface RecommendationResult {
  recommendedSize: string;
  confidence: number;
  fitNote: string;
  scoredSizes: Array<{ size: string; score: number }>;
}

export async function fetchReferenceItems(base: string): Promise<BrandPickerData> {
  const res = await fetch(`${base}/reference-items`);
  if (!res.ok) throw new Error(`Failed to load reference items (${res.status})`);
  return res.json();
}

export async function postRecommend(
  base: string,
  body: {
    shopDomain: string;
    shopifyProductId: string;
    referenceItemId: number;
    fitPreference?: 'trim' | 'standard' | 'relaxed';
  }
): Promise<RecommendationResult> {
  const res = await fetch(`${base}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Recommendation failed (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function postEvent(
  base: string,
  body: {
    shopDomain: string;
    shopifyProductId: string;
    eventType: string;
    payload?: Record<string, any>;
  }
) {
  try {
    await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Swallow — events are fire-and-forget.
    console.warn('[hey-tailor] event log failed', err);
  }
}
