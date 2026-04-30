import { Router } from 'express';
import { query, queryOne } from '../db';
import { recommendSize } from '../services/recommendationEngine';
import { normalizeBrand } from '../services/brandNormalizer';
import { ExternalReferenceItem } from '../types';

export const passportRecsRouter = Router();

// ---------------------------------------------------------------------------
// Size-shift helpers: detect when a brand's recommended size differs from
// what the user typically wears. Used by /brand-recs to intentionally
// surface 1-2 "not all mediums are the same" picks — but only when those
// picks already meet the engine's confidence threshold.
// ---------------------------------------------------------------------------
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL'];

function computeTypicalSize(stamps: any[]): string | null {
  const counts: Record<string, number> = {};
  for (const s of stamps) {
    const sz = (s.size_label || '').toUpperCase().trim();
    if (!sz) continue;
    counts[sz] = (counts[sz] || 0) + 1;
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [sz, count] of Object.entries(counts)) {
    if (count > bestCount) { best = sz; bestCount = count; }
  }
  return best;
}

/** Returns 'up' (rec bigger than typical), 'down' (smaller), or 'same'. */
function sizeShift(recSize: string, typicalSize: string | null): 'up' | 'down' | 'same' {
  if (!typicalSize) return 'same';
  const a = SIZE_ORDER.indexOf((recSize || '').toUpperCase());
  const b = SIZE_ORDER.indexOf(typicalSize.toUpperCase());
  if (a === -1 || b === -1 || a === b) return 'same';
  return a > b ? 'up' : 'down';
}

/**
 * Compute the chest range across the user's entire collection of stamps.
 * Floor = smallest stamp chest - 0.25"; ceiling = largest + 0.25".
 * Used to filter out clearly-out-of-range candidate sizes before scoring,
 * so the engine never recommends something outside what the user has
 * historically worn.
 */
const COLLECTION_TOLERANCE = 0.25;
async function computeCollectionRange(stamps: any[]): Promise<{ min: number; max: number } | null> {
  const chests: number[] = [];
  for (const stamp of stamps) {
    const ref = await findReferenceForStamp(stamp);
    const c = ref && ref.chest_inches != null ? Number(ref.chest_inches) : NaN;
    if (Number.isFinite(c)) chests.push(c);
  }
  if (chests.length === 0) return null;
  return {
    min: Math.min(...chests) - COLLECTION_TOLERANCE,
    max: Math.max(...chests) + COLLECTION_TOLERANCE,
  };
}

function inRange(row: ExternalReferenceItem, range: { min: number; max: number } | null): boolean {
  if (!range) return true;
  const c = row.chest_inches;
  if (c == null) return true; // can't filter what we don't know
  return c >= range.min && c <= range.max;
}

/**
 * Find the best matching reference row for a stamp. Three-tier match:
 *   1. Exact: same brand + product_name + size (after normalization)
 *   2. Loose: same brand + size, with product_name overlap either way
 *      (handles "Dri-FIT Standard" stamp ↔ "Dri-FIT Standard (Slim)" reference)
 *   3. Fallback: same brand + size, any product (factory rows preferred)
 */
async function findReferenceForStamp(stamp: any): Promise<ExternalReferenceItem | null> {
  const brand = normalizeBrand(stamp.brand || '');
  const productName = (stamp.product_name || '').trim();
  const sizeLabel = (stamp.size_label || '').trim();
  if (!brand || !sizeLabel) return null;

  // Tier 1: exact match
  if (productName) {
    const exact = await queryOne<ExternalReferenceItem>(
      `SELECT * FROM external_reference_items
       WHERE LOWER(brand) = LOWER($1)
         AND LOWER(product_name) = LOWER($2)
         AND LOWER(size_label) = LOWER($3)
       LIMIT 1`,
      [brand, productName, sizeLabel]
    );
    if (exact) return exact;
  }

  // Tier 2: brand + size + product-name overlap. Either direction —
  // stamp's name might be a prefix of ours ("Dri-FIT Standard" in
  // "Dri-FIT Standard (Slim)") or vice versa.
  if (productName) {
    const loose = await queryOne<ExternalReferenceItem>(
      `SELECT * FROM external_reference_items
       WHERE LOWER(brand) = LOWER($1)
         AND LOWER(size_label) = LOWER($2)
         AND (
           LOWER(product_name) LIKE '%' || LOWER($3) || '%'
           OR LOWER($3) LIKE '%' || LOWER(product_name) || '%'
         )
       ORDER BY
         CASE WHEN source = 'factory' THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`,
      [brand, sizeLabel, productName]
    );
    if (loose) return loose;
  }

  // Tier 3: brand + size only — best we can do
  return await queryOne<ExternalReferenceItem>(
    `SELECT * FROM external_reference_items
     WHERE LOWER(brand) = LOWER($1)
       AND LOWER(size_label) = LOWER($2)
     ORDER BY
       CASE WHEN source = 'factory' THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`,
    [brand, sizeLabel]
  );
}

/**
 * Look up the user's profile + stamps by email, find the most recent stamp
 * that has matching reference measurements, and return it as the "reference"
 * for measurement-based recommendations.
 *
 * "Matching" uses the three-tier fallback in findReferenceForStamp().
 *
 * Preference order for which stamp becomes the reference:
 *   1. Stamps for `preferredBrand` (after normalization) — when the user
 *      is searching a brand they own, their own data for that brand is
 *      the most reliable signal.
 *   2. Stamps with fit_rating='perfect' — they actually fit.
 *   3. Most recent stamp.
 */
async function getUserReference(
  email: string,
  preferredBrand?: string,
): Promise<{
  profile: any;
  stamps: any[];
  reference: ExternalReferenceItem | null;
  referenceStamp: any | null;
} | null> {
  const profile = await queryOne<any>(
    `SELECT * FROM shopper_profiles WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (!profile) return null;

  const normPreferred = preferredBrand ? normalizeBrand(preferredBrand).toLowerCase() : '';

  const stamps = await query<any>(
    `SELECT * FROM profile_items WHERE profile_id = $1
     ORDER BY
       CASE WHEN $2 <> '' AND LOWER(brand) = $2 THEN 0 ELSE 1 END,
       CASE WHEN fit_rating = 'perfect' THEN 0 ELSE 1 END,
       id DESC`,
    [profile.id, normPreferred]
  );

  for (const stamp of stamps) {
    const ref = await findReferenceForStamp(stamp);
    if (ref) return { profile, stamps, reference: ref, referenceStamp: stamp };
  }

  return { profile, stamps, reference: null, referenceStamp: null };
}

/**
 * POST /api/passport/find-size
 * Body: { email, targetBrand }
 * Returns the recommended size + product + confidence for the target brand.
 */
passportRecsRouter.post('/find-size', async (req, res) => {
  try {
    const { email, targetBrand } = req.body as { email?: string; targetBrand?: string };
    if (!email || !targetBrand) {
      return res.status(400).json({ error: 'email and targetBrand are required' });
    }

    // Pass the target brand so getUserReference prefers a same-brand stamp.
    const userData = await getUserReference(email, targetBrand);
    if (!userData || !userData.profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (!userData.reference) {
      return res.status(400).json({
        error: 'None of your stamps match a brand we have measurements for yet. Add a stamp for a brand on the Factory Measurements list and try again.',
      });
    }

    const normBrand = normalizeBrand(targetBrand);

    // Get all external_reference_items rows for the target brand, grouped by product.
    const targetRows = await query<ExternalReferenceItem>(
      `SELECT * FROM external_reference_items
       WHERE LOWER(brand) = LOWER($1)
       ORDER BY product_name ASC, size_label ASC`,
      [normBrand]
    );

    if (targetRows.length === 0) {
      return res.status(404).json({
        error: `We don't have measurements for ${normBrand} yet.`,
        suggestion: 'Try a different brand, or add a stamp for one of the brands we cover.',
      });
    }

    // Apply the collection-range filter: drop candidate sizes whose chest is
    // outside the user's historical fit range (smallest stamp - 0.25"  to
    // largest stamp + 0.25"). Keeps the engine from recommending something
    // the user has never worn anywhere close to.
    const collectionRange = await computeCollectionRange(userData.stamps);
    const filteredRows = targetRows.filter((r) => inRange(r, collectionRange));

    // Group by product_name. Each product_name encodes a distinct fit/line
    // combination — return one entry per fit so the user sees the spread
    // (M in one fit, L in another within the same brand).
    const productGroups: Record<string, ExternalReferenceItem[]> = {};
    for (const row of filteredRows) {
      if (!productGroups[row.product_name]) productGroups[row.product_name] = [];
      productGroups[row.product_name].push(row);
    }

    const fitPref = (userData.profile.fit_preference || 'standard') as 'trim' | 'standard' | 'relaxed';

    const options: any[] = [];
    for (const [productName, sizes] of Object.entries(productGroups)) {
      const result = await recommendSize(
        {
          // ExternalReferenceItem has the same chest/shoulder/length/size_label
          // fields the engine reads, so we can pass it as productSizes.
          productSizes: sizes as any,
          reference: userData.reference,
          fitPreference: fitPref,
        },
        productName
      );
      options.push({
        product: productName,
        recommendedSize: result.recommendedSize,
        confidence: result.confidence,
        fitNote: result.fitNote,
        source: result.source,
      });
    }

    options.sort((a, b) => b.confidence - a.confidence);

    // Show what the user typed for "basedOn" — that's what they'll recognize.
    const basedOnStamp = userData.referenceStamp;
    res.json({
      brand: normBrand,
      options, // one entry per fit/product
      basedOn: {
        brand:   basedOnStamp?.brand        ?? userData.reference.brand,
        product: basedOnStamp?.product_name ?? userData.reference.product_name,
        size:    basedOnStamp?.size_label   ?? userData.reference.size_label,
      },
    });
  } catch (err: any) {
    console.error('[passportRecs/find-size]', err);
    res.status(500).json({ error: 'Failed to compute size recommendation' });
  }
});

/**
 * GET /api/passport/brand-recs?email=...
 * Returns the top 3-5 brands the user is likely to fit well in, based on
 * their existing stamps + factory measurements + fit preference.
 */
passportRecsRouter.get('/brand-recs', async (req, res) => {
  try {
    const email = (req.query.email as string | undefined)?.trim();
    if (!email) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    const userData = await getUserReference(email);
    if (!userData || !userData.profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (!userData.reference) {
      return res.json({
        recommendations: [],
        note: 'None of your stamps match a brand we have measurements for yet. Add a stamp for a brand we cover and brand recs will appear.',
      });
    }

    // All distinct brands in factory measurements.
    const allBrands = await query<{ brand: string }>(
      `SELECT DISTINCT brand FROM external_reference_items ORDER BY brand`
    );

    // Brands the user already owns (so we skip them in recs).
    const ownedBrands = new Set(
      userData.stamps.map((s) => normalizeBrand(s.brand).toLowerCase())
    );

    const fitPref = (userData.profile.fit_preference || 'standard') as 'trim' | 'standard' | 'relaxed';

    // Same collection-range filter used by find-size: drop candidate sizes
    // outside the user's historical chest range across all their stamps.
    const collectionRange = await computeCollectionRange(userData.stamps);

    const recommendations: any[] = [];
    for (const { brand } of allBrands) {
      const normBrand = normalizeBrand(brand);
      if (ownedBrands.has(normBrand.toLowerCase())) continue;

      // Get this brand's products. Run engine per product, pick highest confidence.
      const rows = await query<ExternalReferenceItem>(
        `SELECT * FROM external_reference_items
         WHERE LOWER(brand) = LOWER($1)
         ORDER BY product_name ASC, size_label ASC`,
        [normBrand]
      );
      const filtered = rows.filter((r) => inRange(r, collectionRange));
      if (filtered.length === 0) continue;

      const productGroups: Record<string, ExternalReferenceItem[]> = {};
      for (const row of filtered) {
        if (!productGroups[row.product_name]) productGroups[row.product_name] = [];
        productGroups[row.product_name].push(row);
      }

      let bestForBrand: any = null;
      for (const [productName, sizes] of Object.entries(productGroups)) {
        const result = await recommendSize(
          {
            productSizes: sizes as any,
            reference: userData.reference,
            fitPreference: fitPref,
          },
          productName
        );
        if (!bestForBrand || result.confidence > bestForBrand.confidence) {
          bestForBrand = { ...result, productName };
        }
      }

      // Only surface high-confidence matches in Discover Brands. Users
      // shouldn't see brands we're not at least 80% sure about — even if
      // it makes the list shorter.
      if (bestForBrand && bestForBrand.confidence >= 80) {
        recommendations.push({
          brand: normBrand,
          recommendedSize: bestForBrand.recommendedSize,
          confidence: bestForBrand.confidence,
          product: bestForBrand.productName,
          fitNote: bestForBrand.fitNote,
        });
      }
    }

    // Sort all candidates by confidence desc.
    recommendations.sort((a, b) => b.confidence - a.confidence);

    // Tag each rec with how its recommended size compares to the user's
    // typical size, so the UI can surface "Runs small / Runs large" badges.
    const typicalSize = computeTypicalSize(userData.stamps);
    const tagged = recommendations.map((r) => ({
      ...r,
      sizeShift: sizeShift(r.recommendedSize, typicalSize),
    }));

    // Curate the final 5: take top 3 by confidence (any size), then up to 2
    // different-size picks that ALSO clear the confidence floor. If no
    // different-size picks exist, the list stays 5 same-size — we never
    // pad with weak recs to manufacture diversity.
    const TOP_TARGET = 5;
    const DIFF_TARGET = 2;
    const ANY_TOP = 3;

    let curated: typeof tagged = [];
    if (tagged.length <= TOP_TARGET || !typicalSize) {
      curated = tagged.slice(0, TOP_TARGET);
    } else {
      const diff = tagged.filter((r) => r.sizeShift !== 'same');
      const same = tagged.filter((r) => r.sizeShift === 'same');
      const seen = new Set<string>();
      const pick = (item: typeof tagged[number]) => {
        if (seen.has(item.brand)) return;
        seen.add(item.brand);
        curated.push(item);
      };
      // Top 3 by confidence regardless of shift.
      tagged.slice(0, ANY_TOP).forEach(pick);
      // Up to 2 different-size picks that aren't already in.
      let added = 0;
      for (const r of diff) {
        if (added >= DIFF_TARGET) break;
        if (!seen.has(r.brand)) { pick(r); added++; }
      }
      // Backfill with same-size if we still have room.
      for (const r of same) {
        if (curated.length >= TOP_TARGET) break;
        pick(r);
      }
      // Final order: highest confidence first (so curation doesn't feel
      // mechanical to the user).
      curated.sort((a, b) => b.confidence - a.confidence);
    }

    const basedOnStamp = userData.referenceStamp;
    res.json({
      recommendations: curated,
      typicalSize, // exposed so the UI can phrase "your usual is M"
      basedOn: {
        brand:   basedOnStamp?.brand        ?? userData.reference.brand,
        product: basedOnStamp?.product_name ?? userData.reference.product_name,
        size:    basedOnStamp?.size_label   ?? userData.reference.size_label,
      },
    });
  } catch (err: any) {
    console.error('[passportRecs/brand-recs]', err);
    res.status(500).json({ error: 'Failed to compute brand recommendations' });
  }
});
