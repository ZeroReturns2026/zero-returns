/* eslint-disable no-console */
import { db, close } from '../src/db';

// Men's top product template. Chest/shoulder/length in inches per size.
// Values are plausible but not copied from any real brand.
const SIZE_TEMPLATES: Record<string, Record<string, [number, number, number]>> = {
  // tshirt: baseline
  tshirt: {
    S: [39, 17, 27.5],
    M: [41, 17.75, 28.5],
    L: [43.5, 18.5, 29.5],
    XL: [46, 19.25, 30.5],
  },
  // Signature fit polo: H&B-style athletic cut, true to size
  polo_signature: {
    S: [39.5, 17.25, 27.75],
    M: [41.5, 18, 28.75],
    L: [44, 18.75, 29.75],
    XL: [46.5, 19.5, 30.75],
  },
  // Legacy alias so older catalog entries still work
  polo: {
    S: [39.5, 17.25, 27.75],
    M: [41.5, 18, 28.75],
    L: [44, 18.75, 29.75],
    XL: [46.5, 19.5, 30.75],
  },
  oxford: {
    S: [40, 17.5, 28.5],
    M: [42, 18.25, 29.5],
    L: [44.5, 19, 30.5],
    XL: [47, 19.75, 31.5],
  },
  performance_tee: {
    S: [38, 16.75, 27],
    M: [40.25, 17.5, 28],
    L: [42.75, 18.25, 29],
    XL: [45.25, 19, 30],
  },
  henley: {
    S: [39, 17, 28],
    M: [41, 17.75, 29],
    L: [43.5, 18.5, 30],
    XL: [46, 19.25, 31],
  },
  // Tailored fit polo: slimmer cut, about 1-1.5" narrower in chest.
  // Runs approx one size smaller than Signature.
  polo_tailored: {
    S: [38, 16.5, 27],
    M: [40, 17.25, 28],
    L: [42, 18, 29],
    XL: [44.5, 18.75, 30],
  },
  // Quarter-zip / pullover: signature fit, slightly roomier for layering
  quarter_zip: {
    S: [40.5, 17.5, 28],
    M: [42.5, 18.25, 29],
    L: [45, 19, 30],
    XL: [47.5, 19.75, 31],
  },
};

const PRODUCT_CATALOG: Array<{
  shopify_product_id: string;
  handle: string;
  title: string;
  template: keyof typeof SIZE_TEMPLATES;
}> = [
  { shopify_product_id: 'gid://shopify/Product/1001', handle: 'everyday-cotton-tee', title: 'Everyday Cotton Tee', template: 'tshirt' },
  { shopify_product_id: 'gid://shopify/Product/1002', handle: 'heritage-pocket-tee', title: 'Heritage Pocket Tee', template: 'tshirt' },
  { shopify_product_id: 'gid://shopify/Product/1003', handle: 'club-pique-polo', title: 'Club Pique Polo', template: 'polo' },
  { shopify_product_id: 'gid://shopify/Product/1004', handle: 'weekend-polo', title: 'Weekend Polo', template: 'polo' },
  { shopify_product_id: 'gid://shopify/Product/1005', handle: 'classic-oxford-shirt', title: 'Classic Oxford Shirt', template: 'oxford' },
  { shopify_product_id: 'gid://shopify/Product/1006', handle: 'travel-oxford', title: 'Travel Oxford', template: 'oxford' },
  { shopify_product_id: 'gid://shopify/Product/1007', handle: 'blue-hour-oxford', title: 'Blue Hour Oxford', template: 'oxford' },
  { shopify_product_id: 'gid://shopify/Product/1008', handle: 'run-club-tee', title: 'Run Club Tee', template: 'performance_tee' },
  { shopify_product_id: 'gid://shopify/Product/1009', handle: 'peak-performance-tee', title: 'Peak Performance Tee', template: 'performance_tee' },
  { shopify_product_id: 'gid://shopify/Product/1010', handle: 'trail-tech-tee', title: 'Trail Tech Tee', template: 'performance_tee' },
  { shopify_product_id: 'gid://shopify/Product/1011', handle: 'waffle-henley', title: 'Waffle Henley', template: 'henley' },
  { shopify_product_id: 'gid://shopify/Product/1012', handle: 'midweight-henley', title: 'Midweight Henley', template: 'henley' },
  { shopify_product_id: 'gid://shopify/Product/1013', handle: 'long-sleeve-tee', title: 'Long Sleeve Everyday Tee', template: 'tshirt' },
  { shopify_product_id: 'gid://shopify/Product/1014', handle: 'gameday-polo', title: 'Gameday Polo', template: 'polo' },
  { shopify_product_id: 'gid://shopify/Product/1015', handle: 'linen-oxford', title: 'Linen Oxford', template: 'oxford' },
  // Zero Returns storefront products (matched by handle from Shopify CSV)
  { shopify_product_id: 'gid://shopify/Product/2001', handle: 'the-perkins-polo', title: 'The Perkins Polo', template: 'polo_signature' },
  { shopify_product_id: 'gid://shopify/Product/2002', handle: 'the-yale-polo', title: 'The Yale Polo', template: 'polo_tailored' },
  { shopify_product_id: 'gid://shopify/Product/2003', handle: 'the-rodgers-quarter-zip', title: 'The Rodgers Quarter-Zip', template: 'quarter_zip' },
];

// ---------------------------------------------------------------------------
// External reference items: known items from other brands shoppers may own.
// Measurements are plausible approximations per brand fit philosophy.
// Fit label key: slim/tailored ≈ -1.5" chest, classic/relaxed ≈ +1" chest
// ---------------------------------------------------------------------------
const REFERENCE_ITEMS: Array<[string, string, string, string, number, number, number]> = [
  // [brand, product_name, item_type, size, chest, shoulder, length]

  // ── 1. PETER MILLAR ──────────────────────────────────────────────────────
  // Crown Crafted (Tour/Tailored Fit) — trimmer cut
  ['Peter Millar', 'Crown Crafted Polo (Tour Fit)', 'polo', 'S', 39, 17, 27.5],
  ['Peter Millar', 'Crown Crafted Polo (Tour Fit)', 'polo', 'M', 41, 17.75, 28.5],
  ['Peter Millar', 'Crown Crafted Polo (Tour Fit)', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Peter Millar', 'Crown Crafted Polo (Tour Fit)', 'polo', 'XL', 46, 19.25, 30.5],
  // Crown Sport (Classic Fit) — roomier athletic cut
  ['Peter Millar', 'Crown Sport Polo (Classic Fit)', 'polo', 'S', 40.5, 17.5, 28],
  ['Peter Millar', 'Crown Sport Polo (Classic Fit)', 'polo', 'M', 42.5, 18.25, 29],
  ['Peter Millar', 'Crown Sport Polo (Classic Fit)', 'polo', 'L', 45, 19, 30],
  ['Peter Millar', 'Crown Sport Polo (Classic Fit)', 'polo', 'XL', 47.5, 19.75, 31],
  // Crown Sport Quarter-Zip
  ['Peter Millar', 'Crown Sport Quarter-Zip', 'quarter_zip', 'S', 41, 17.5, 28.5],
  ['Peter Millar', 'Crown Sport Quarter-Zip', 'quarter_zip', 'M', 43, 18.25, 29.5],
  ['Peter Millar', 'Crown Sport Quarter-Zip', 'quarter_zip', 'L', 45.5, 19, 30.5],
  ['Peter Millar', 'Crown Sport Quarter-Zip', 'quarter_zip', 'XL', 48, 19.75, 31.5],

  // ── 2. GREYSON ───────────────────────────────────────────────────────────
  // Runs slightly large, tailored through chest — between standard and classic
  ['Greyson', 'Omaha Polo', 'polo', 'S', 40, 17.25, 27.5],
  ['Greyson', 'Omaha Polo', 'polo', 'M', 42, 18, 28.5],
  ['Greyson', 'Omaha Polo', 'polo', 'L', 44.5, 18.75, 29.5],
  ['Greyson', 'Omaha Polo', 'polo', 'XL', 47, 19.5, 30.5],
  ['Greyson', 'Saranac Polo', 'polo', 'S', 40, 17.25, 27.5],
  ['Greyson', 'Saranac Polo', 'polo', 'M', 42, 18, 28.5],
  ['Greyson', 'Saranac Polo', 'polo', 'L', 44.5, 18.75, 29.5],
  ['Greyson', 'Saranac Polo', 'polo', 'XL', 47, 19.5, 30.5],
  // Cherokee runs slimmer than other Greyson polos
  ['Greyson', 'Cherokee Polo (Slim)', 'polo', 'S', 39, 17, 27.25],
  ['Greyson', 'Cherokee Polo (Slim)', 'polo', 'M', 41, 17.75, 28.25],
  ['Greyson', 'Cherokee Polo (Slim)', 'polo', 'L', 43.5, 18.5, 29.25],
  ['Greyson', 'Cherokee Polo (Slim)', 'polo', 'XL', 46, 19.25, 30.25],

  // ── 3. TRAVIS MATHEW ─────────────────────────────────────────────────────
  // Standard Fit — modern athletic, true to size
  ['TravisMathew', 'Standard Polo', 'polo', 'S', 39.5, 17.25, 27.75],
  ['TravisMathew', 'Standard Polo', 'polo', 'M', 41.5, 18, 28.75],
  ['TravisMathew', 'Standard Polo', 'polo', 'L', 44, 18.75, 29.75],
  ['TravisMathew', 'Standard Polo', 'polo', 'XL', 46.5, 19.5, 30.75],
  ['TravisMathew', 'Cloud Quarter-Zip 2.0', 'quarter_zip', 'S', 40.5, 17.5, 28],
  ['TravisMathew', 'Cloud Quarter-Zip 2.0', 'quarter_zip', 'M', 42.5, 18.25, 29],
  ['TravisMathew', 'Cloud Quarter-Zip 2.0', 'quarter_zip', 'L', 45, 19, 30],
  ['TravisMathew', 'Cloud Quarter-Zip 2.0', 'quarter_zip', 'XL', 47.5, 19.75, 31],

  // ── 4. FOOTJOY ───────────────────────────────────────────────────────────
  // Athletic Fit — tighter chest/arms, shorter body
  ['FootJoy', 'Lisle Polo (Athletic Fit)', 'polo', 'S', 38.5, 16.75, 27],
  ['FootJoy', 'Lisle Polo (Athletic Fit)', 'polo', 'M', 40.5, 17.5, 28],
  ['FootJoy', 'Lisle Polo (Athletic Fit)', 'polo', 'L', 43, 18.25, 29],
  ['FootJoy', 'Lisle Polo (Athletic Fit)', 'polo', 'XL', 45.5, 19, 30],
  // Classic Fit — roomier
  ['FootJoy', 'ProDry Polo (Classic Fit)', 'polo', 'S', 40.5, 17.5, 28],
  ['FootJoy', 'ProDry Polo (Classic Fit)', 'polo', 'M', 42.5, 18.25, 29],
  ['FootJoy', 'ProDry Polo (Classic Fit)', 'polo', 'L', 45, 19, 30],
  ['FootJoy', 'ProDry Polo (Classic Fit)', 'polo', 'XL', 47.5, 19.75, 31],

  // ── 5. G/FORE ────────────────────────────────────────────────────────────
  // Slim Tailored Fit — European styling, runs fitted
  ['G/FORE', 'Line Up Polo (Slim Fit)', 'polo', 'S', 38, 16.5, 27],
  ['G/FORE', 'Line Up Polo (Slim Fit)', 'polo', 'M', 40, 17.25, 28],
  ['G/FORE', 'Line Up Polo (Slim Fit)', 'polo', 'L', 42.5, 18, 29],
  ['G/FORE', 'Line Up Polo (Slim Fit)', 'polo', 'XL', 45, 18.75, 30],
  ['G/FORE', 'All Play Polo (Slim Fit)', 'polo', 'S', 38, 16.5, 27],
  ['G/FORE', 'All Play Polo (Slim Fit)', 'polo', 'M', 40, 17.25, 28],
  ['G/FORE', 'All Play Polo (Slim Fit)', 'polo', 'L', 42.5, 18, 29],
  ['G/FORE', 'All Play Polo (Slim Fit)', 'polo', 'XL', 45, 18.75, 30],

  // ── 6. POLO RALPH LAUREN (RLX Golf) ──────────────────────────────────────
  // Classic Fit
  ['Polo Ralph Lauren', 'RLX Golf Polo (Classic Fit)', 'polo', 'S', 41, 17.5, 28.25],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Classic Fit)', 'polo', 'M', 43, 18.25, 29.25],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Classic Fit)', 'polo', 'L', 45.5, 19, 30.25],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Classic Fit)', 'polo', 'XL', 48, 19.75, 31.25],
  // Tailored Fit
  ['Polo Ralph Lauren', 'RLX Golf Polo (Tailored Fit)', 'polo', 'S', 39, 17, 27.75],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Tailored Fit)', 'polo', 'M', 41, 17.75, 28.75],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Tailored Fit)', 'polo', 'L', 43.5, 18.5, 29.75],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Tailored Fit)', 'polo', 'XL', 46, 19.25, 30.75],
  // Slim Fit
  ['Polo Ralph Lauren', 'RLX Golf Polo (Slim Fit)', 'polo', 'S', 38, 16.5, 27.5],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Slim Fit)', 'polo', 'M', 40, 17.25, 28.5],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Slim Fit)', 'polo', 'L', 42.5, 18, 29.5],
  ['Polo Ralph Lauren', 'RLX Golf Polo (Slim Fit)', 'polo', 'XL', 45, 18.75, 30.5],
  // Quarter-Zip
  ['Polo Ralph Lauren', 'RLX Performance Quarter-Zip', 'quarter_zip', 'S', 41, 17.5, 28.5],
  ['Polo Ralph Lauren', 'RLX Performance Quarter-Zip', 'quarter_zip', 'M', 43, 18.25, 29.5],
  ['Polo Ralph Lauren', 'RLX Performance Quarter-Zip', 'quarter_zip', 'L', 45.5, 19, 30.5],
  ['Polo Ralph Lauren', 'RLX Performance Quarter-Zip', 'quarter_zip', 'XL', 48, 19.75, 31.5],

  // ── 7. HOLDERNESS & BOURNE ───────────────────────────────────────────────
  // Refined Trim Fit — less excess, polished but not tight
  ['Holderness & Bourne', 'Performance Jersey Polo (Trim Fit)', 'polo', 'S', 39, 17, 27.5],
  ['Holderness & Bourne', 'Performance Jersey Polo (Trim Fit)', 'polo', 'M', 41, 17.75, 28.5],
  ['Holderness & Bourne', 'Performance Jersey Polo (Trim Fit)', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Holderness & Bourne', 'Performance Jersey Polo (Trim Fit)', 'polo', 'XL', 46, 19.25, 30.5],
  ['Holderness & Bourne', 'Performance Pique Polo (Trim Fit)', 'polo', 'S', 39, 17, 27.5],
  ['Holderness & Bourne', 'Performance Pique Polo (Trim Fit)', 'polo', 'M', 41, 17.75, 28.5],
  ['Holderness & Bourne', 'Performance Pique Polo (Trim Fit)', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Holderness & Bourne', 'Performance Pique Polo (Trim Fit)', 'polo', 'XL', 46, 19.25, 30.5],
  ['Holderness & Bourne', 'AIRATION Polo (Trim Fit)', 'polo', 'S', 39, 17, 27.5],
  ['Holderness & Bourne', 'AIRATION Polo (Trim Fit)', 'polo', 'M', 41, 17.75, 28.5],
  ['Holderness & Bourne', 'AIRATION Polo (Trim Fit)', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Holderness & Bourne', 'AIRATION Polo (Trim Fit)', 'polo', 'XL', 46, 19.25, 30.5],
  // H&B Quarter-Zips
  ['Holderness & Bourne', 'The Bell Quarter-Zip', 'quarter_zip', 'S', 40.5, 17.25, 28],
  ['Holderness & Bourne', 'The Bell Quarter-Zip', 'quarter_zip', 'M', 42.5, 18, 29],
  ['Holderness & Bourne', 'The Bell Quarter-Zip', 'quarter_zip', 'L', 45, 18.75, 30],
  ['Holderness & Bourne', 'The Bell Quarter-Zip', 'quarter_zip', 'XL', 47.5, 19.5, 31],
  ['Holderness & Bourne', 'The Stuart Quarter-Zip', 'quarter_zip', 'S', 40.5, 17.25, 28],
  ['Holderness & Bourne', 'The Stuart Quarter-Zip', 'quarter_zip', 'M', 42.5, 18, 29],
  ['Holderness & Bourne', 'The Stuart Quarter-Zip', 'quarter_zip', 'L', 45, 18.75, 30],
  ['Holderness & Bourne', 'The Stuart Quarter-Zip', 'quarter_zip', 'XL', 47.5, 19.5, 31],

  // ── 8. JOHNNIE-O ─────────────────────────────────────────────────────────
  // Tailored Fit — true to size, clean lines
  ['Johnnie-O', 'Top Shelf Polo (Tailored Fit)', 'polo', 'S', 39.5, 17.25, 27.75],
  ['Johnnie-O', 'Top Shelf Polo (Tailored Fit)', 'polo', 'M', 41.5, 18, 28.75],
  ['Johnnie-O', 'Top Shelf Polo (Tailored Fit)', 'polo', 'L', 44, 18.75, 29.75],
  ['Johnnie-O', 'Top Shelf Polo (Tailored Fit)', 'polo', 'XL', 46.5, 19.5, 30.75],
  ['Johnnie-O', 'Featherweight Polo (Tailored Fit)', 'polo', 'S', 39.5, 17.25, 27.75],
  ['Johnnie-O', 'Featherweight Polo (Tailored Fit)', 'polo', 'M', 41.5, 18, 28.75],
  ['Johnnie-O', 'Featherweight Polo (Tailored Fit)', 'polo', 'L', 44, 18.75, 29.75],
  ['Johnnie-O', 'Featherweight Polo (Tailored Fit)', 'polo', 'XL', 46.5, 19.5, 30.75],
  // Johnnie-O Quarter-Zips
  ['Johnnie-O', 'Diaz Quarter-Zip', 'quarter_zip', 'S', 40.5, 17.5, 28],
  ['Johnnie-O', 'Diaz Quarter-Zip', 'quarter_zip', 'M', 42.5, 18.25, 29],
  ['Johnnie-O', 'Diaz Quarter-Zip', 'quarter_zip', 'L', 45, 19, 30],
  ['Johnnie-O', 'Diaz Quarter-Zip', 'quarter_zip', 'XL', 47.5, 19.75, 31],

  // ── 9. VINEYARD VINES ────────────────────────────────────────────────────
  // Sankaty Classic — generous, roomy fit
  ['Vineyard Vines', 'Sankaty Polo (Classic Fit)', 'polo', 'S', 41, 17.5, 28],
  ['Vineyard Vines', 'Sankaty Polo (Classic Fit)', 'polo', 'M', 43, 18.25, 29],
  ['Vineyard Vines', 'Sankaty Polo (Classic Fit)', 'polo', 'L', 45.5, 19, 30],
  ['Vineyard Vines', 'Sankaty Polo (Classic Fit)', 'polo', 'XL', 48, 19.75, 31],
  // Slim Fit
  ['Vineyard Vines', 'Sankaty Polo (Slim Fit)', 'polo', 'S', 39, 17, 27.5],
  ['Vineyard Vines', 'Sankaty Polo (Slim Fit)', 'polo', 'M', 41, 17.75, 28.5],
  ['Vineyard Vines', 'Sankaty Polo (Slim Fit)', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Vineyard Vines', 'Sankaty Polo (Slim Fit)', 'polo', 'XL', 46, 19.25, 30.5],

  // ── 10. LULULEMON ────────────────────────────────────────────────────────
  // Classic Fit
  ['Lululemon', 'ShowZero Polo (Classic Fit)', 'polo', 'S', 40, 17.25, 27.75],
  ['Lululemon', 'ShowZero Polo (Classic Fit)', 'polo', 'M', 42, 18, 28.75],
  ['Lululemon', 'ShowZero Polo (Classic Fit)', 'polo', 'L', 44.5, 18.75, 29.75],
  ['Lululemon', 'ShowZero Polo (Classic Fit)', 'polo', 'XL', 47, 19.5, 30.75],
  // Slim Fit
  ['Lululemon', 'ShowZero Polo (Slim Fit)', 'polo', 'S', 38.5, 16.75, 27.5],
  ['Lululemon', 'ShowZero Polo (Slim Fit)', 'polo', 'M', 40.5, 17.5, 28.5],
  ['Lululemon', 'ShowZero Polo (Slim Fit)', 'polo', 'L', 43, 18.25, 29.5],
  ['Lululemon', 'ShowZero Polo (Slim Fit)', 'polo', 'XL', 45.5, 19, 30.5],
  // Evolution (slim-ish, extra range of motion)
  ['Lululemon', 'Evolution Polo', 'polo', 'S', 39, 17, 27.5],
  ['Lululemon', 'Evolution Polo', 'polo', 'M', 41, 17.75, 28.5],
  ['Lululemon', 'Evolution Polo', 'polo', 'L', 43.5, 18.5, 29.5],
  ['Lululemon', 'Evolution Polo', 'polo', 'XL', 46, 19.25, 30.5],
  // Metal Vent Tech (relaxed performance tee)
  ['Lululemon', 'Metal Vent Tech Polo (Relaxed Fit)', 'polo', 'S', 40.5, 17.5, 28],
  ['Lululemon', 'Metal Vent Tech Polo (Relaxed Fit)', 'polo', 'M', 42.5, 18.25, 29],
  ['Lululemon', 'Metal Vent Tech Polo (Relaxed Fit)', 'polo', 'L', 45, 19, 30],
  ['Lululemon', 'Metal Vent Tech Polo (Relaxed Fit)', 'polo', 'XL', 47.5, 19.75, 31],

  // ── 11. NIKE GOLF ────────────────────────────────────────────────────────
  // Tour Fit (Tailored/Athletic) — sleek, runs slim
  ['Nike', 'Tour Polo (Tour Fit)', 'polo', 'S', 38.5, 16.75, 27.25],
  ['Nike', 'Tour Polo (Tour Fit)', 'polo', 'M', 40.5, 17.5, 28.25],
  ['Nike', 'Tour Polo (Tour Fit)', 'polo', 'L', 43, 18.25, 29.25],
  ['Nike', 'Tour Polo (Tour Fit)', 'polo', 'XL', 45.5, 19, 30.25],
  // Dri-FIT Victory (Standard Fit)
  ['Nike', 'Dri-FIT Victory Polo (Standard Fit)', 'polo', 'S', 40, 17.25, 28],
  ['Nike', 'Dri-FIT Victory Polo (Standard Fit)', 'polo', 'M', 42, 18, 29],
  ['Nike', 'Dri-FIT Victory Polo (Standard Fit)', 'polo', 'L', 44.5, 18.75, 30],
  ['Nike', 'Dri-FIT Victory Polo (Standard Fit)', 'polo', 'XL', 47, 19.5, 31],
  // Nike Quarter-Zips
  ['Nike', 'Dri-FIT ADV Vapor Quarter-Zip', 'quarter_zip', 'S', 40.5, 17.25, 28],
  ['Nike', 'Dri-FIT ADV Vapor Quarter-Zip', 'quarter_zip', 'M', 42.5, 18, 29],
  ['Nike', 'Dri-FIT ADV Vapor Quarter-Zip', 'quarter_zip', 'L', 45, 18.75, 30],
  ['Nike', 'Dri-FIT ADV Vapor Quarter-Zip', 'quarter_zip', 'XL', 47.5, 19.5, 31],

  // ── 12. ADIDAS GOLF ──────────────────────────────────────────────────────
  // Athletic Fit
  ['adidas', 'Go To Polo (Athletic Fit)', 'polo', 'S', 39.5, 17, 27.5],
  ['adidas', 'Go To Polo (Athletic Fit)', 'polo', 'M', 41.5, 17.75, 28.5],
  ['adidas', 'Go To Polo (Athletic Fit)', 'polo', 'L', 44, 18.5, 29.5],
  ['adidas', 'Go To Polo (Athletic Fit)', 'polo', 'XL', 46.5, 19.25, 30.5],
  // Relaxed Fit
  ['adidas', 'Adicross Polo (Relaxed Fit)', 'polo', 'S', 41, 17.5, 28],
  ['adidas', 'Adicross Polo (Relaxed Fit)', 'polo', 'M', 43, 18.25, 29],
  ['adidas', 'Adicross Polo (Relaxed Fit)', 'polo', 'L', 45.5, 19, 30],
  ['adidas', 'Adicross Polo (Relaxed Fit)', 'polo', 'XL', 48, 19.75, 31],
  // Quarter-Zip
  ['adidas', 'Ultimate365 Quarter-Zip', 'quarter_zip', 'S', 41, 17.5, 28.5],
  ['adidas', 'Ultimate365 Quarter-Zip', 'quarter_zip', 'M', 43, 18.25, 29.5],
  ['adidas', 'Ultimate365 Quarter-Zip', 'quarter_zip', 'L', 45.5, 19, 30.5],
  ['adidas', 'Ultimate365 Quarter-Zip', 'quarter_zip', 'XL', 48, 19.75, 31.5],

  // ── 13. PUMA GOLF ────────────────────────────────────────────────────────
  // Classic Fit — relaxed, fuller silhouette
  ['Puma', 'Icon Polo (Classic Fit)', 'polo', 'S', 40.5, 17.5, 27.5],
  ['Puma', 'Icon Polo (Classic Fit)', 'polo', 'M', 42.5, 18.25, 28.5],
  ['Puma', 'Icon Polo (Classic Fit)', 'polo', 'L', 45, 19, 29.5],
  ['Puma', 'Icon Polo (Classic Fit)', 'polo', 'XL', 47.5, 19.75, 30.5],

  // ── 14. UNDER ARMOUR ─────────────────────────────────────────────────────
  // Athletic Fit — tight through chest/arms
  ['Under Armour', 'Playoff 3.0 Polo (Athletic Fit)', 'polo', 'S', 38.5, 16.75, 27.25],
  ['Under Armour', 'Playoff 3.0 Polo (Athletic Fit)', 'polo', 'M', 40.5, 17.5, 28.25],
  ['Under Armour', 'Playoff 3.0 Polo (Athletic Fit)', 'polo', 'L', 43, 18.25, 29.25],
  ['Under Armour', 'Playoff 3.0 Polo (Athletic Fit)', 'polo', 'XL', 45.5, 19, 30.25],
  // Loose Fit — fuller cut
  ['Under Armour', 'Tech Polo (Loose Fit)', 'polo', 'S', 41, 17.5, 28],
  ['Under Armour', 'Tech Polo (Loose Fit)', 'polo', 'M', 43, 18.25, 29],
  ['Under Armour', 'Tech Polo (Loose Fit)', 'polo', 'L', 45.5, 19, 30],
  ['Under Armour', 'Tech Polo (Loose Fit)', 'polo', 'XL', 48, 19.75, 31],
  // Quarter-Zip
  ['Under Armour', 'Playoff Quarter-Zip', 'quarter_zip', 'S', 40.5, 17.25, 28],
  ['Under Armour', 'Playoff Quarter-Zip', 'quarter_zip', 'M', 42.5, 18, 29],
  ['Under Armour', 'Playoff Quarter-Zip', 'quarter_zip', 'L', 45, 18.75, 30],
  ['Under Armour', 'Playoff Quarter-Zip', 'quarter_zip', 'XL', 47.5, 19.5, 31],

  // ── 15. BONOBOS ──────────────────────────────────────────────────────────
  // Slim Fit
  ['Bonobos', 'M-Flex Golf Polo (Slim Fit)', 'polo', 'S', 38.5, 16.75, 27.5],
  ['Bonobos', 'M-Flex Golf Polo (Slim Fit)', 'polo', 'M', 40.5, 17.5, 28.5],
  ['Bonobos', 'M-Flex Golf Polo (Slim Fit)', 'polo', 'L', 43, 18.25, 29.5],
  ['Bonobos', 'M-Flex Golf Polo (Slim Fit)', 'polo', 'XL', 45.5, 19, 30.5],
  // Standard Fit
  ['Bonobos', 'Tour Golf Polo (Standard Fit)', 'polo', 'S', 40, 17.25, 28],
  ['Bonobos', 'Tour Golf Polo (Standard Fit)', 'polo', 'M', 42, 18, 29],
  ['Bonobos', 'Tour Golf Polo (Standard Fit)', 'polo', 'L', 44.5, 18.75, 30],
  ['Bonobos', 'Tour Golf Polo (Standard Fit)', 'polo', 'XL', 47, 19.5, 31],

  // ── BONUS: NON-GOLF BASICS (people own these) ────────────────────────────
  ['J.Crew', 'Broken-in Short-Sleeve Tee', 'tshirt', 'S', 38.5, 16.75, 27.25],
  ['J.Crew', 'Broken-in Short-Sleeve Tee', 'tshirt', 'M', 40.5, 17.5, 28.25],
  ['J.Crew', 'Broken-in Short-Sleeve Tee', 'tshirt', 'L', 43, 18.25, 29.25],
  ['Uniqlo', 'Dry-EX Crew Neck T-Shirt', 'tshirt', 'S', 38.5, 16.5, 27],
  ['Uniqlo', 'Dry-EX Crew Neck T-Shirt', 'tshirt', 'M', 40.5, 17.25, 28],
  ['Uniqlo', 'Dry-EX Crew Neck T-Shirt', 'tshirt', 'L', 43, 18, 29],
];

function main() {
  try {
    db.exec('BEGIN');

    // Wipe everything so seed is idempotent
    db.exec(`
      DELETE FROM events;
      DELETE FROM product_sizes;
      DELETE FROM products;
      DELETE FROM merchants;
      DELETE FROM external_reference_items;
      DELETE FROM sqlite_sequence WHERE name IN (
        'events','product_sizes','products','merchants','external_reference_items'
      );
    `);

    // 1 merchant
    const insertMerchant = db.prepare(
      `INSERT INTO merchants (shop_domain, display_name) VALUES (?, ?)`
    );
    const mInfo = insertMerchant.run('zeroreturns.myshopify.com', 'Zero Returns');
    const merchantId = Number(mInfo.lastInsertRowid);

    // No alias merchants needed — the recommend endpoint falls back to
    // the first merchant when the widget reports an unknown domain.

    const insertProduct = db.prepare(
      `INSERT INTO products (merchant_id, shopify_product_id, handle, title, category)
       VALUES (?, ?, ?, ?, 'mens_top')`
    );
    const insertSize = db.prepare(
      `INSERT INTO product_sizes (product_id, size_label, chest_inches, shoulder_inches, length_inches)
       VALUES (?, ?, ?, ?, ?)`
    );

    let productCount = 0;
    let sizeCount = 0;
    for (const p of PRODUCT_CATALOG) {
      const pInfo = insertProduct.run(merchantId, p.shopify_product_id, p.handle, p.title);
      const productId = Number(pInfo.lastInsertRowid);
      productCount++;

      for (const [sizeLabel, dims] of Object.entries(SIZE_TEMPLATES[p.template])) {
        const [chest, shoulder, length] = dims;
        insertSize.run(productId, sizeLabel, chest, shoulder, length);
        sizeCount++;
      }
    }

    const insertRef = db.prepare(
      `INSERT INTO external_reference_items (brand, product_name, item_type, size_label, chest_inches, shoulder_inches, length_inches)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [brand, name, itemType, size, chest, shoulder, length] of REFERENCE_ITEMS) {
      insertRef.run(brand, name, itemType, size, chest, shoulder, length);
    }

    db.exec('COMMIT');
    console.log(
      `✓ Seeded 1 merchant, ${productCount} products, ${sizeCount} sizes, ${REFERENCE_ITEMS.length} reference items`
    );
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    close();
  }
}

main();
