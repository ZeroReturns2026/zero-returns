import { ProductSize, ExternalReferenceItem, RecommendationResponse } from '../types';
import { query } from '../db';
import { normalizeBrand } from './brandNormalizer';

const CHEST_WEIGHT = 0.5;
const SHOULDER_WEIGHT = 0.3;
const LENGTH_WEIGHT = 0.2;

/**
 * Coerce a possibly-null/undefined/string-typed measurement to number|null.
 * Pg returns NUMERIC columns as strings sometimes; null comes back as null.
 */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const FIT_OFFSETS: Record<string, { chest: number; shoulder: number; length: number }> = {
  trim: { chest: -0.5, shoulder: -0.25, length: 0 },
  standard: { chest: 0, shoulder: 0, length: 0 },
  relaxed: { chest: 0.75, shoulder: 0.25, length: 0.25 },
};

export interface RecommendInput {
  productSizes: ProductSize[];
  reference: ExternalReferenceItem;
  fitPreference?: 'trim' | 'standard' | 'relaxed';
}

// ---------------------------------------------------------------------------
// Collaborative filtering — uses survey data to find what people with the
// same reference item actually wear in the target product category.
// ---------------------------------------------------------------------------

interface CollaborativeMatch {
  size: string;
  count: number;       // how many survey respondents wear this size
  totalVotes: number;  // total respondents who matched
  confidence: number;  // 0-100
}

/**
 * Look up survey respondents who own the same reference brand + size,
 * then see what sizes they wear in products similar to the target.
 */
async function getCollaborativeSignal(
  reference: ExternalReferenceItem,
  productSizes: ProductSize[],
  targetProductTitle?: string,
): Promise<CollaborativeMatch | null> {
  // Normalize the incoming brand so typo'd or abbreviated input still matches
  // the canonical brand names stored in survey_items.
  const referenceBrand = normalizeBrand(reference.brand);

  // Find survey respondents who own this brand in this size.
  // We also check survey_items writes pre-normalization, so still LOWER-compare.
  const matchingItems = await query<any>(
    `SELECT si.respondent_id, si.brand, si.product_name, si.size_label, si.fit_rating
     FROM survey_items si
     WHERE LOWER(si.brand) = LOWER($1)
       AND LOWER(si.size_label) = LOWER($2)`,
    [referenceBrand, reference.size_label]
  );

  if (matchingItems.length === 0) return null;

  // Get all respondent IDs who match
  const respondentIds = [...new Set(matchingItems.map((m: any) => m.respondent_id))];

  // For those respondents, find ALL other items they own
  const placeholders = respondentIds.map((_: any, i: number) => `$${i + 1}`).join(',');
  const otherItems = await query<any>(
    `SELECT si.respondent_id, si.brand, si.product_name, si.size_label, si.fit_rating
     FROM survey_items si
     WHERE si.respondent_id IN (${placeholders})
       AND NOT (LOWER(si.brand) = LOWER($${respondentIds.length + 1})
                AND LOWER(si.size_label) = LOWER($${respondentIds.length + 2}))`,
    [...respondentIds, reference.brand, reference.size_label]
  );

  // Now count size votes from these "similar" shoppers.
  // We look at ALL their items because each one tells us about their sizing.
  // The available sizes for the target product constrain the vote.
  const availableSizes = new Set(productSizes.map(ps => ps.size_label.toUpperCase()));
  const sizeVotes: Record<string, number> = {};

  for (const item of otherItems) {
    const normalizedSize = item.size_label.toUpperCase().trim();
    if (availableSizes.has(normalizedSize)) {
      sizeVotes[normalizedSize] = (sizeVotes[normalizedSize] || 0) + 1;
    }
  }

  // Also check if respondents have body measurements that help
  const respondentsWithChest = await query<any>(
    `SELECT sr.id, sr.chest_measurement, sr.build_type
     FROM survey_respondents sr
     WHERE sr.id IN (${placeholders})
       AND sr.chest_measurement IS NOT NULL
       AND sr.chest_measurement != ''`,
    respondentIds
  );

  // Parse chest measurements and try to match to closest product size
  for (const resp of respondentsWithChest) {
    const chestNum = parseFloat(resp.chest_measurement);
    if (!isNaN(chestNum) && chestNum > 20 && chestNum < 60) {
      // Find the closest size by chest measurement
      let bestSize = '';
      let bestDiff = Infinity;
      for (const ps of productSizes) {
        const diff = Math.abs(ps.chest_inches - chestNum);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSize = ps.size_label.toUpperCase();
        }
      }
      if (bestSize) {
        // Body measurement vote counts as 0.5 (weaker than an actual item preference)
        sizeVotes[bestSize] = (sizeVotes[bestSize] || 0) + 0.5;
      }
    }
  }

  if (Object.keys(sizeVotes).length === 0) return null;

  // Pick the size with the most votes
  const totalVotes = Object.values(sizeVotes).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(sizeVotes).sort((a, b) => b[1] - a[1]);
  const [winningSize, winningCount] = sorted[0];

  // Confidence based on vote count and agreement
  const agreement = winningCount / totalVotes;
  let confidence: number;
  if (totalVotes >= 5 && agreement >= 0.7) confidence = 95;
  else if (totalVotes >= 3 && agreement >= 0.6) confidence = 88;
  else if (totalVotes >= 2) confidence = 78;
  else confidence = 65;

  return {
    size: winningSize,
    count: Math.round(winningCount),
    totalVotes: Math.round(totalVotes),
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Measurement-based matching (original engine)
// ---------------------------------------------------------------------------

function measurementMatch(input: RecommendInput) {
  const { productSizes, reference, fitPreference } = input;
  const offset = FIT_OFFSETS[fitPreference ?? 'standard'];

  // Reference can have NULL shoulder/length (some brands only publish chest).
  // We treat each component as "available or not" and only score components
  // that are present on BOTH the reference and the candidate size, then
  // renormalize the weights so chest-only references still produce a score
  // on the same 0-1ish scale as fully-measured references.
  const refChest    = numOrNull(reference.chest_inches);
  const refShoulder = numOrNull(reference.shoulder_inches);
  const refLength   = numOrNull(reference.length_inches);

  const adjustedChest    = refChest    !== null ? refChest    + offset.chest    : null;
  const adjustedShoulder = refShoulder !== null ? refShoulder + offset.shoulder : null;
  const adjustedLength   = refLength   !== null ? refLength   + offset.length   : null;

  const scored = productSizes.map((size) => {
    const sChest    = numOrNull(size.chest_inches);
    const sShoulder = numOrNull(size.shoulder_inches);
    const sLength   = numOrNull(size.length_inches);

    let weightUsed = 0;
    let weightedDiff = 0;
    const chestDiff    = (adjustedChest    !== null && sChest    !== null) ? Math.abs(sChest    - adjustedChest)    : null;
    const shoulderDiff = (adjustedShoulder !== null && sShoulder !== null) ? Math.abs(sShoulder - adjustedShoulder) : null;
    const lengthDiff   = (adjustedLength   !== null && sLength   !== null) ? Math.abs(sLength   - adjustedLength)   : null;

    if (chestDiff    !== null) { weightedDiff += chestDiff    * CHEST_WEIGHT;    weightUsed += CHEST_WEIGHT; }
    if (shoulderDiff !== null) { weightedDiff += shoulderDiff * SHOULDER_WEIGHT; weightUsed += SHOULDER_WEIGHT; }
    if (lengthDiff   !== null) { weightedDiff += lengthDiff   * LENGTH_WEIGHT;   weightUsed += LENGTH_WEIGHT; }

    // Renormalize: a chest-only score and a full-measurement score should be
    // comparable. weightUsed === 0 means we have no measurements at all to
    // compare — bail with a huge score so this size loses any tie.
    const score = weightUsed > 0 ? weightedDiff / weightUsed : Number.MAX_SAFE_INTEGER;

    return {
      size: size.size_label,
      score,
      chestDiff:    chestDiff    ?? 0,
      shoulderDiff: shoulderDiff ?? 0,
      lengthDiff:   lengthDiff   ?? 0,
      sizeRow: size,
      fitGuard: undefined as string | undefined,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  // ── Floor guard (default behavior, all fit preferences) ──
  // "Too tight" is unrecoverable; "slightly big" is wearable. Never recommend
  // a candidate whose chest is BELOW the adjusted reference chest. Among
  // candidates that meet the floor, pick the SMALLEST one — that keeps us
  // close to the user's actual size without pushing them into oversized.
  // The fit-preference offset already encodes per-pref tolerance: trim
  // floor = ref - 0.5", standard floor = ref, relaxed floor = ref + 0.75".
  if (scored.length >= 2 && adjustedChest !== null) {
    const best = scored[0];
    if (best.sizeRow.chest_inches < adjustedChest) {
      // Best-by-distance is below the floor. Find the smallest size that
      // meets or exceeds the floor.
      const passing = scored
        .filter((s) => s.sizeRow.chest_inches >= adjustedChest)
        .sort((a, b) => a.sizeRow.chest_inches - b.sizeRow.chest_inches);
      if (passing.length > 0) {
        const next = passing[0];
        const nextIdx = scored.indexOf(next);
        scored[nextIdx] = best;
        scored[0] = next;
        scored[0].fitGuard = 'floor_size_up';
      } else {
        // No size in the brand's run is large enough — flag for the UI.
        best.fitGuard = 'undersized_collection';
      }
    }
  }

  if (fitPreference === 'relaxed' && scored.length >= 2 && refChest !== null) {
    const best = scored[0];
    // If the winning size's chest is LARGER than the relaxed-adjusted target
    // but also way bigger than original reference, it could be excessively roomy
    if (best.sizeRow.chest_inches > refChest + 2.0) {
      // Find a size that's closer to the original but still roomier
      const nextDown = scored.find(
        s => s.sizeRow.chest_inches <= refChest + 2.0
          && s.sizeRow.chest_inches > refChest
          && s !== best
      );
      if (nextDown) {
        const nextIdx = scored.indexOf(nextDown);
        scored[nextIdx] = best;
        scored[0] = nextDown;
        scored[0].fitGuard = 'relaxed_ceiling';
      }
    }
  }

  return scored;
}

// ---------------------------------------------------------------------------
// Public API — blends collaborative + measurement signals
// ---------------------------------------------------------------------------

/**
 * Score every available size against the reference item and return
 * the best match + a confidence bucket + a short fit note.
 *
 * Now checks survey data first for collaborative filtering.
 * If enough people who own the same reference item have told us their
 * sizing preferences, that signal takes priority over pure measurement
 * matching. Otherwise falls back to measurement-based matching.
 */
export async function recommendSize(
  input: RecommendInput,
  targetProductTitle?: string,
): Promise<RecommendationResponse> {
  const { productSizes, reference, fitPreference } = input;

  if (productSizes.length === 0) {
    throw new Error('No product sizes provided.');
  }

  // Layer 1: Check collaborative filtering from survey data
  let collab: CollaborativeMatch | null = null;
  try {
    collab = await getCollaborativeSignal(reference, productSizes, targetProductTitle);
    if (collab) {
      console.log(`[collab] Brand="${reference.brand}" Size="${reference.size_label}" → ${collab.count} votes for ${collab.size} (${collab.totalVotes} total, ${collab.confidence}% conf)`);
    } else {
      console.log(`[collab] Brand="${reference.brand}" Size="${reference.size_label}" → no matching survey data`);
    }
  } catch (err) {
    console.log('[collab] Survey tables not available:', (err as any).message);
  }

  // Layer 2: Measurement-based matching (always computed)
  const scored = measurementMatch(input);
  const best = scored[0];

  // Blend the two signals
  let recommendedSize: string;
  let confidence: number;
  let fitNote: string;
  let source: string;

  // ── Blend: crowd-first ────────────────────────────────────────────
  // Design principle: real-world fit experience ("people who wear X also
  // wear Y") is a stronger signal than measurement math. Measurements are
  // a directional guide. So whenever the collaborative layer has any
  // meaningful consensus, it wins. The thresholds here are deliberately
  // generous toward the crowd: a single confident vote can override
  // measurements (with a small confidence haircut), and 2+ votes become
  // authoritative.
  if (collab && collab.totalVotes >= 2) {
    if (collab.size === best.size.toUpperCase()) {
      // Both agree — highest confidence
      recommendedSize = best.size;
      confidence = Math.min(97, Math.max(collab.confidence, scoreToConfidence(best.score)) + 5);
      fitNote = `Size ${best.size} is confirmed by both our measurement analysis and ${collab.count} shopper(s) with similar preferences.`;
      source = 'collaborative+measurement';
    } else if (collab.confidence >= 70 && collab.totalVotes >= 2) {
      // Crowd has any reasonable consensus and disagrees — trust the crowd.
      // Lowered from ≥80% / ≥3 votes so the flywheel can dominate sooner.
      recommendedSize = collab.size;
      confidence = collab.confidence;
      fitNote = `Based on ${collab.count} shopper(s) who also wear ${reference.brand} ${reference.size_label}, size ${collab.size} is the best fit. Measurements suggest ${best.size}, but real-world fit experience points to ${collab.size}.`;
      source = 'collaborative';
    } else {
      // Weak crowd disagreement — go with measurements but flag the alternative.
      recommendedSize = best.size;
      confidence = scoreToConfidence(best.score);
      fitNote = buildFitNote(best, reference, fitPreference) +
        ` (Note: some shoppers with similar preferences wear ${collab.size}.)`;
      source = 'measurement+collab-note';
    }
  } else if (collab && collab.totalVotes >= 1) {
    // A single crowd vote — used to be ignored. Now: if it agrees with
    // measurements, treat as confirmation. If it disagrees, lean toward
    // crowd at moderate confidence.
    if (collab.size === best.size.toUpperCase()) {
      recommendedSize = best.size;
      confidence = Math.min(92, scoreToConfidence(best.score) + 3);
      fitNote = `Size ${best.size} matches both measurements and ${collab.count} similar shopper.`;
      source = 'collaborative+measurement';
    } else {
      recommendedSize = collab.size;
      confidence = 70; // moderate — only one data point
      fitNote = `One shopper with similar preferences wears ${collab.size} here. Measurements suggest ${best.size}, but real-world experience tilts us toward ${collab.size}.`;
      source = 'collaborative';
    }
  } else {
    // No crowd data at all — fall back to measurement-only.
    recommendedSize = best.size;
    confidence = scoreToConfidence(best.score);
    fitNote = buildFitNote(best, reference, fitPreference);
    source = 'measurement';
  }

  return {
    recommendedSize,
    confidence,
    fitNote,
    source,
    scoredSizes: scored.map((s) => ({ size: s.size, score: Number(s.score.toFixed(3)) })),
  };
}

function scoreToConfidence(score: number): number {
  if (score <= 0.75) return 92;
  if (score <= 1.5) return 85;
  if (score <= 3.0) return 75;
  return 62;
}

function buildFitNote(
  best: { size: string; chestDiff: number; shoulderDiff: number; lengthDiff: number; fitGuard?: string },
  reference: ExternalReferenceItem,
  fitPreference?: 'trim' | 'standard' | 'relaxed'
): string {
  // Handle directional guard cases first
  if (best.fitGuard === 'trim_floor') {
    return `Size ${best.size} is our recommendation. A smaller size would run tighter than your ${reference.brand} ${reference.product_name}, so ${best.size} gives you a trim fit without going too small.`;
  }
  if (best.fitGuard === 'trim_undersized') {
    return `Size ${best.size} is the closest available, but this garment runs small — even ${best.size} may fit tighter than your ${reference.brand} ${reference.product_name}.`;
  }
  if (best.fitGuard === 'relaxed_ceiling') {
    return `Size ${best.size} gives you a relaxed fit without being excessively roomy compared to your ${reference.brand} ${reference.product_name}.`;
  }

  const { chestDiff, shoulderDiff, lengthDiff } = best;
  const maxDiff = Math.max(chestDiff, shoulderDiff, lengthDiff);

  if (maxDiff <= 0.5) {
    return `Size ${best.size} should feel very similar to your ${reference.brand} ${reference.product_name}.`;
  }

  if (chestDiff > 1 && chestDiff >= shoulderDiff && chestDiff >= lengthDiff) {
    return chestDiff > 0
      ? `Size ${best.size} will feel ${fitPreference === 'trim' ? 'slightly trimmer' : 'a touch roomier'} in the chest than your reference.`
      : `Size ${best.size} is our closest match on chest.`;
  }
  if (shoulderDiff > 0.75) {
    return `Size ${best.size} is our closest shoulder match — the fit across the shoulders should feel familiar.`;
  }
  if (lengthDiff > 0.75) {
    return `Size ${best.size} will run ${lengthDiff > 1 ? 'a bit longer' : 'similar in length'} compared to your reference.`;
  }

  return `Size ${best.size} is our best overall match on chest, shoulders, and length.`;
}
