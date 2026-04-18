import { ProductSize, ExternalReferenceItem, RecommendationResponse } from '../types';
import { query } from '../db';

const CHEST_WEIGHT = 0.5;
const SHOULDER_WEIGHT = 0.3;
const LENGTH_WEIGHT = 0.2;

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
  // Find survey respondents who own this brand in this size
  const matchingItems = await query<any>(
    `SELECT si.respondent_id, si.brand, si.product_name, si.size_label, si.fit_rating
     FROM survey_items si
     WHERE LOWER(si.brand) = LOWER($1)
       AND LOWER(si.size_label) = LOWER($2)`,
    [reference.brand, reference.size_label]
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

  const adjustedChest = reference.chest_inches + offset.chest;
  const adjustedShoulder = reference.shoulder_inches + offset.shoulder;
  const adjustedLength = reference.length_inches + offset.length;

  const scored = productSizes.map((size) => {
    const chestDiff = Math.abs(size.chest_inches - adjustedChest);
    const shoulderDiff = Math.abs(size.shoulder_inches - adjustedShoulder);
    const lengthDiff = Math.abs(size.length_inches - adjustedLength);
    const score =
      chestDiff * CHEST_WEIGHT + shoulderDiff * SHOULDER_WEIGHT + lengthDiff * LENGTH_WEIGHT;
    return { size: size.size_label, score, chestDiff, shoulderDiff, lengthDiff, sizeRow: size, fitGuard: undefined as string | undefined };
  });

  scored.sort((a, b) => a.score - b.score);

  // ── Directional guard for trim/relaxed preferences ──
  // If the best size's chest is on the WRONG side of the original reference,
  // the shopper could end up with a garment that's tighter (or looser) than
  // even their reference — not just "slightly trimmer/roomier."
  // In that case, bump to the next size in the correct direction.
  if (fitPreference === 'trim' && scored.length >= 2) {
    const best = scored[0];
    // The trim floor is the adjusted chest (reference - 0.5").
    // The shopper wants up to 0.5" tighter — that's the wiggle room.
    // But if the winning size's chest goes BELOW that adjusted target,
    // it's tighter than they asked for.
    const trimFloor = adjustedChest; // reference.chest_inches - 0.5
    if (best.sizeRow.chest_inches < trimFloor) {
      // Find the next size up whose chest is at or above the trim floor
      const nextUp = scored.find(
        s => s.sizeRow.chest_inches >= trimFloor && s !== best
      );
      if (nextUp) {
        // Swap: promote the safer size to first position
        const nextIdx = scored.indexOf(nextUp);
        scored[nextIdx] = best;
        scored[0] = nextUp;
        scored[0].fitGuard = 'trim_floor';
      } else {
        // No option at or above the trim floor — warn the shopper
        best.fitGuard = 'trim_undersized';
      }
    }
  }

  if (fitPreference === 'relaxed' && scored.length >= 2) {
    const best = scored[0];
    // If the winning size's chest is LARGER than the relaxed-adjusted target
    // but also way bigger than original reference, it could be excessively roomy
    if (best.sizeRow.chest_inches > reference.chest_inches + 2.0) {
      // Find a size that's closer to the original but still roomier
      const nextDown = scored.find(
        s => s.sizeRow.chest_inches <= reference.chest_inches + 2.0
          && s.sizeRow.chest_inches > reference.chest_inches
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

  if (collab && collab.totalVotes >= 2) {
    // Collaborative data is strong enough to use
    if (collab.size === best.size.toUpperCase()) {
      // Both agree — highest confidence
      recommendedSize = best.size;
      confidence = Math.min(97, Math.max(collab.confidence, scoreToConfidence(best.score)) + 5);
      fitNote = `Size ${best.size} is confirmed by both our measurement analysis and ${collab.count} shopper(s) with similar preferences.`;
      source = 'collaborative+measurement';
    } else if (collab.confidence >= 80 && collab.totalVotes >= 3) {
      // Collaborative data is strong and disagrees — trust the crowd
      recommendedSize = collab.size;
      confidence = collab.confidence;
      fitNote = `Based on ${collab.count} shopper(s) who also wear ${reference.brand} ${reference.size_label}, size ${collab.size} is the best fit. Our measurement analysis suggests ${best.size}, but real-world preferences point to ${collab.size}.`;
      source = 'collaborative';
    } else {
      // Weak disagreement — go with measurements but note the collaborative signal
      recommendedSize = best.size;
      confidence = scoreToConfidence(best.score);
      fitNote = buildFitNote(best, reference, fitPreference) +
        ` (Note: some shoppers with similar preferences wear ${collab.size}.)`;
      source = 'measurement+collab-note';
    }
  } else {
    // No collaborative data — pure measurement matching
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
