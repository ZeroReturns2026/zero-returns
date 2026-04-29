/**
 * Brand normalization — maps common abbreviations, misspellings, and variations
 * to canonical brand names. This ensures collaborative filtering and profile
 * data treats "H&B", "H and B", "Holderness and Bourne" as the same brand.
 */

const BRAND_ALIASES: Record<string, string> = {
  // Holderness & Bourne
  'h&b': 'Holderness & Bourne',
  'h and b': 'Holderness & Bourne',
  'h & b': 'Holderness & Bourne',
  'holderness and bourne': 'Holderness & Bourne',
  'holderness & bourne': 'Holderness & Bourne',
  'holderness bourne': 'Holderness & Bourne',
  'h&b golf': 'Holderness & Bourne',

  // Peter Millar
  'peter millar': 'Peter Millar',
  'peter miller': 'Peter Millar',
  'pm': 'Peter Millar',

  // TravisMathew
  'travis mathew': 'TravisMathew',
  'travismathew': 'TravisMathew',
  'travis matthew': 'TravisMathew',
  'travis': 'TravisMathew',

  // Polo Ralph Lauren
  'polo ralph lauren': 'Polo Ralph Lauren',
  'ralph lauren': 'Polo Ralph Lauren',
  'polo rl': 'Polo Ralph Lauren',
  'rlx': 'Polo Ralph Lauren',
  'ralph lauren rlx': 'Polo Ralph Lauren',
  'polo': 'Polo Ralph Lauren',

  // FootJoy
  'footjoy': 'FootJoy',
  'foot joy': 'FootJoy',
  'fj': 'FootJoy',

  // G/FORE
  'g/fore': 'G/FORE',
  'gfore': 'G/FORE',
  'g fore': 'G/FORE',

  // Johnnie-O
  'johnnie-o': 'Johnnie-O',
  'johnnie o': 'Johnnie-O',
  'johnny o': 'Johnnie-O',
  'johnnio': 'Johnnie-O',

  // Vineyard Vines
  'vineyard vines': 'Vineyard Vines',
  'vv': 'Vineyard Vines',

  // Lululemon
  'lululemon': 'Lululemon',
  'lulu': 'Lululemon',
  'lulu lemon': 'Lululemon',

  // Nike
  'nike': 'Nike',
  'nike golf': 'Nike',

  // adidas
  'adidas': 'adidas',
  'adidas golf': 'adidas',

  // Puma
  'puma': 'Puma',
  'puma golf': 'Puma',

  // Under Armour
  'under armour': 'Under Armour',
  'under armor': 'Under Armour',
  'ua': 'Under Armour',

  // Bonobos
  'bonobos': 'Bonobos',

  // Greyson
  'greyson': 'Greyson',
  'greyson clothiers': 'Greyson',

  // Criquet
  'criquet': 'Criquet',

  // B. Draddy
  'b. draddy': 'B. Draddy',
  'b draddy': 'B. Draddy',
  'billy draddy': 'B. Draddy',

  // Southern Shirt Co
  'southern shirt': 'Southern Shirt Co',
  'southern shirt co': 'Southern Shirt Co',
  'southern shirt company': 'Southern Shirt Co',

  // Faherty
  'faherty': 'Faherty',
  'faherty brand': 'Faherty',
};

/**
 * Levenshtein distance — number of single-character edits to transform a → b.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * How many character edits we tolerate when fuzzy-matching to an alias.
 * Strict for short strings (avoid false positives like "polo" → anything),
 * looser for longer ones where typos are more likely.
 */
function fuzzyThreshold(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return 0;          // exact only for very short inputs
  if (minLen <= 7) return 1;         // 1 edit allowed for medium
  return 2;                          // 2 edits allowed for long
}

/**
 * Find the closest alias key for an input, returning its canonical brand
 * if within the fuzzy threshold. Returns null if nothing close enough.
 */
function fuzzyBrandMatch(lowerInput: string): string | null {
  let best: { key: string; dist: number } | null = null;
  for (const key of Object.keys(BRAND_ALIASES)) {
    const threshold = fuzzyThreshold(lowerInput, key);
    if (threshold === 0) continue;
    const dist = levenshtein(lowerInput, key);
    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { key, dist };
    }
  }
  return best ? BRAND_ALIASES[best.key] : null;
}

/**
 * Normalize a brand name to its canonical form.
 * Returns the canonical name if found (exact or fuzzy match), otherwise
 * returns the trimmed original.
 */
export function normalizeBrand(input: string): string {
  if (!input) return input;
  const lower = input.trim().toLowerCase();
  if (BRAND_ALIASES[lower]) {
    return BRAND_ALIASES[lower];
  }
  const fuzzy = fuzzyBrandMatch(lower);
  if (fuzzy) return fuzzy;
  return input.trim();
}

/**
 * Common product/fit name aliases → canonical fit names.
 * Helps when users type "tailored fit" vs "Tailored" vs "trim fit" etc.
 */
const FIT_ALIASES: Record<string, Record<string, string>> = {
  'holderness & bourne': {
    'tailored': 'Tailored Fit Polo',
    'tailored fit': 'Tailored Fit Polo',
    'trim': 'Tailored Fit Polo',
    'trim fit': 'Tailored Fit Polo',
    'yale': 'The Yale Polo',
    'the yale': 'The Yale Polo',
    'clark': 'The Clark Polo',
    'the clark': 'The Clark Polo',
    'standard': 'Standard Fit Polo',
    'classic': 'Standard Fit Polo',
    'classic fit': 'Standard Fit Polo',
    'signature': 'Signature Fit Polo',
    'jersey': 'Jersey Trim Polo',
    'pique': 'Pique Trim Polo',
    'airation': 'AIRATION Trim Polo',
    'bell': 'Bell Quarter-Zip',
    'stuart': 'Stuart Quarter-Zip',
    'quarter zip': 'Bell Quarter-Zip',
    'qz': 'Bell Quarter-Zip',
  },
  'peter millar': {
    'crown': 'Crown Crafted Polo (Tour Fit)',
    'crown crafted': 'Crown Crafted Polo (Tour Fit)',
    'tour fit': 'Crown Crafted Polo (Tour Fit)',
    'tour': 'Crown Crafted Polo (Tour Fit)',
    'crown sport': 'Crown Sport Polo (Classic Fit)',
    'classic': 'Crown Sport Polo (Classic Fit)',
    'classic fit': 'Crown Sport Polo (Classic Fit)',
    'featherweight': 'Crown Sport Polo (Classic Fit)',
    'southern comfort': 'Crown Sport Polo (Classic Fit)',
    'quarter zip': 'Crown Sport Quarter-Zip',
    'qz': 'Crown Sport Quarter-Zip',
  },
};

/**
 * Normalize a product/fit name based on the brand.
 * Returns the canonical fit name if found (exact or fuzzy match), otherwise the original.
 */
export function normalizeFit(brand: string, productName: string): string {
  if (!productName) return productName;
  const normalizedBrand = normalizeBrand(brand).toLowerCase();
  const fits = FIT_ALIASES[normalizedBrand];
  if (!fits) return productName.trim();
  const lower = productName.trim().toLowerCase();
  if (fits[lower]) return fits[lower];

  // Fuzzy fallback within the brand's known fit aliases
  let best: { key: string; dist: number } | null = null;
  for (const key of Object.keys(fits)) {
    const threshold = fuzzyThreshold(lower, key);
    if (threshold === 0) continue;
    const dist = levenshtein(lower, key);
    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { key, dist };
    }
  }
  if (best) return fits[best.key];

  return productName.trim();
}
