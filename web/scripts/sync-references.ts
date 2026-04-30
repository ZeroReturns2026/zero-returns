/* eslint-disable no-console */
/**
 * Sync the published "Factory Measurements" and (optional) "Hand Measurements"
 * Google Sheets into external_reference_items.
 *
 * The sheets are the canonical source of size-chart reference data. Each run
 * does a full-replace inside a single transaction so the table mirrors the
 * sheets exactly — no drift, no orphans.
 *
 * Run: `npm run references:sync` (reads CSV URLs from web/.env)
 *
 * Env vars:
 *   FACTORY_MEASUREMENTS_CSV_URL  — required
 *   HAND_MEASUREMENTS_CSV_URL     — optional; if unset, only factory data is synced
 */

import dotenv from 'dotenv';
import path from 'path';
import { db, close } from '../src/db';
import { normalizeBrand } from '../src/services/brandNormalizer';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const FACTORY_URL = process.env.FACTORY_MEASUREMENTS_CSV_URL;
const HAND_URL    = process.env.HAND_MEASUREMENTS_CSV_URL;

if (!FACTORY_URL) {
  console.error('FACTORY_MEASUREMENTS_CSV_URL is not set. Add it to web/.env.');
  process.exit(1);
}

// ---- CSV parser (handles quoted cells, doubled quotes, CRLF, BOM) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// ---- Value coercion ----------------------------------------------------
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === '—' || t === '-' || t === '–') return null;
  const n = Number(t.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanText(raw: string | undefined): string {
  return (raw ?? '').trim();
}

// Build the canonical product_name. Existing seed.ts encodes fit inside the
// product_name (e.g. "Featherweight Stripe Polo (Classic Fit)"), so we follow
// that convention so the recommendation engine treats trim/standard/relaxed
// as separate reference items.
function buildProductName(line: string, fit: string): string {
  const ln = line.trim();
  const ft = fit.trim();
  if (!ft) return ln;
  if (ln.toLowerCase().includes(ft.toLowerCase())) return ln;
  return `${ln} (${ft})`;
}

function findHeaderRow(rows: string[][], firstHeader = 'brand'): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i][0] ?? '').trim().toLowerCase() === firstHeader) return i;
  }
  return -1;
}

// ---- Shared row type ---------------------------------------------------
type ItemRow = {
  brand: string;
  productName: string;
  itemType: string;
  sizeLabel: string;
  chest: number;
  shoulder: number | null;
  length: number | null;
  source: 'factory' | 'hand';
};

type ParseResult = {
  accepted: ItemRow[];
  partial: ItemRow[];
  skipped: { row: number; brand: string; product: string; reason: string }[];
};

// ---- Factory sheet parser ----------------------------------------------
function parseFactorySheet(csvText: string): ParseResult {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''));
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) throw new Error('Factory sheet: header row starting with "Brand" not found.');

  const headers = rows[headerIdx];
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h.trim().toLowerCase()));
  const cols = {
    brand:    find(/^brand$/),
    poloLine: find(/polo\s*line|style/),
    fit:      find(/^fit\s*category|^fit$/),
    size:     find(/tagged\s*size|^size/),
    chest:    find(/chest\s*flat|chest\s*p2p|^chest\b/),
    length:   find(/body\s*length|^length/),
    shoulder: find(/shoulder/),
  };
  const missing: string[] = [];
  if (cols.brand    < 0) missing.push('Brand');
  if (cols.poloLine < 0) missing.push('Polo Line / Style');
  if (cols.size     < 0) missing.push('Tagged Size');
  if (cols.chest    < 0) missing.push('Chest Flat P2P');
  if (cols.length   < 0) missing.push('Body Length');
  if (cols.shoulder < 0) missing.push('Shoulder Width');
  if (missing.length) throw new Error(`Factory sheet: missing columns: ${missing.join(', ')}`);

  const result: ParseResult = { accepted: [], partial: [], skipped: [] };
  rows.slice(headerIdx + 1).forEach((row, idx) => {
    const sheetRow = headerIdx + 2 + idx;
    const rawBrand    = cleanText(row[cols.brand]);
    const rawPoloLine = cleanText(row[cols.poloLine]);
    const rawFit      = cleanText(row[cols.fit]);
    const rawSize     = cleanText(row[cols.size]);
    if (!rawBrand && !rawPoloLine && !rawSize) return;

    const chest    = toNumber(row[cols.chest]);
    const length   = toNumber(row[cols.length]);
    const shoulder = toNumber(row[cols.shoulder]);

    const missingHard: string[] = [];
    if (!rawBrand)    missingHard.push('brand');
    if (!rawPoloLine) missingHard.push('polo_line');
    if (!rawSize)     missingHard.push('size');
    if (chest === null) missingHard.push('chest');
    if (missingHard.length) {
      result.skipped.push({
        row: sheetRow,
        brand: rawBrand || '(blank)',
        product: rawPoloLine || '(blank)',
        reason: `missing ${missingHard.join(', ')}`,
      });
      return;
    }

    const item: ItemRow = {
      brand:       normalizeBrand(rawBrand),
      productName: buildProductName(rawPoloLine, rawFit),
      itemType:    'polo',
      sizeLabel:   rawSize.toUpperCase(),
      chest:       chest!,
      shoulder,
      length,
      source:      'factory',
    };
    result.accepted.push(item);
    if (shoulder === null || length === null) result.partial.push(item);
  });
  return result;
}

// ---- Hand sheet parser -------------------------------------------------
// Schema: Record ID | Brand | Model | Size | Fit Family | Your P2P | Your Length
//       | Your Shoulder | Your Sleeve | Your Hem | Has Factory Spec | ...
//
// Some garments are followed by a "note row" — same Record ID, but the Brand
// cell holds a paragraph of analysis text and the measurement fields are blank.
// We skip those: brand text > 60 chars OR no model/size present.
function parseHandSheet(csvText: string): ParseResult {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''));
  const headerIdx = findHeaderRow(rows, 'record id');
  if (headerIdx < 0) throw new Error('Hand sheet: header row starting with "Record ID" not found.');

  const headers = rows[headerIdx];
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h.trim().toLowerCase()));
  const cols = {
    brand:    find(/^brand$/),
    model:    find(/^model$/),
    size:     find(/^size$/),
    fit:      find(/fit\s*family/),
    chest:    find(/your\s*p2p/),
    length:   find(/your\s*length/),
    shoulder: find(/your\s*shoulder/),
  };
  const missing: string[] = [];
  if (cols.brand    < 0) missing.push('Brand');
  if (cols.model    < 0) missing.push('Model');
  if (cols.size     < 0) missing.push('Size');
  if (cols.chest    < 0) missing.push('Your P2P');
  if (cols.length   < 0) missing.push('Your Length');
  if (cols.shoulder < 0) missing.push('Your Shoulder');
  if (missing.length) throw new Error(`Hand sheet: missing columns: ${missing.join(', ')}`);

  const result: ParseResult = { accepted: [], partial: [], skipped: [] };
  let notesFiltered = 0;
  rows.slice(headerIdx + 1).forEach((row, idx) => {
    const sheetRow = headerIdx + 2 + idx;
    const rawBrand = cleanText(row[cols.brand]);
    const rawModel = cleanText(row[cols.model]);
    const rawSize  = cleanText(row[cols.size]);
    const rawFit   = cleanText(row[cols.fit]);

    // Note rows: paragraph of analysis text in the Model column (or anywhere),
    // missing size, missing measurements. Filter silently.
    const isNoteRow =
      rawModel.length > 100 ||
      rawBrand.length > 100 ||
      (!rawSize && toNumber(row[cols.chest]) === null);
    if (isNoteRow) { notesFiltered++; return; }
    if (!rawBrand && !rawModel && !rawSize) return;

    const chest    = toNumber(row[cols.chest]);
    const length   = toNumber(row[cols.length]);
    const shoulder = toNumber(row[cols.shoulder]);

    const missingHard: string[] = [];
    if (!rawBrand) missingHard.push('brand');
    if (!rawModel) missingHard.push('model');
    if (!rawSize)  missingHard.push('size');
    if (chest === null) missingHard.push('chest');
    if (missingHard.length) {
      result.skipped.push({
        row: sheetRow,
        brand: rawBrand || '(blank)',
        product: rawModel || '(blank)',
        reason: `missing ${missingHard.join(', ')}`,
      });
      return;
    }

    const item: ItemRow = {
      brand:       normalizeBrand(rawBrand),
      productName: buildProductName(rawModel, rawFit),
      itemType:    'polo',
      sizeLabel:   rawSize.toUpperCase(),
      chest:       chest!,
      shoulder,
      length,
      source:      'hand',
    };
    result.accepted.push(item);
    if (shoulder === null || length === null) result.partial.push(item);
  });
  if (notesFiltered > 0) {
    console.log(`Hand sheet: ignored ${notesFiltered} analytical note row${notesFiltered === 1 ? '' : 's'}.`);
  }
  return result;
}

// ---- Main --------------------------------------------------------------
async function fetchCsv(url: string, label: string): Promise<string> {
  console.log(`Fetching ${label} ← ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  const factoryCsv = await fetchCsv(FACTORY_URL!, 'Factory Measurements');
  const factory = parseFactorySheet(factoryCsv);

  let hand: ParseResult = { accepted: [], partial: [], skipped: [] };
  if (HAND_URL) {
    const handCsv = await fetchCsv(HAND_URL, 'Hand Measurements');
    hand = parseHandSheet(handCsv);
  } else {
    console.log('HAND_MEASUREMENTS_CSV_URL not set — skipping hand-measurement sync.');
  }

  const allAccepted = [...factory.accepted, ...hand.accepted];
  const allPartial  = [...factory.partial, ...hand.partial];
  const allSkipped  = [
    ...factory.skipped.map((s) => ({ ...s, sheet: 'factory' })),
    ...hand.skipped.map((s)    => ({ ...s, sheet: 'hand' })),
  ];

  console.log(
    `\nFactory: ${factory.accepted.length} usable ` +
    `(${factory.accepted.length - factory.partial.length} full + ${factory.partial.length} chest-only), ` +
    `${factory.skipped.length} unusable.`
  );
  if (HAND_URL) {
    console.log(
      `Hand:    ${hand.accepted.length} usable ` +
      `(${hand.accepted.length - hand.partial.length} full + ${hand.partial.length} chest-only), ` +
      `${hand.skipped.length} unusable.`
    );
  }
  console.log(`Total to insert: ${allAccepted.length} rows.\n`);

  if (allAccepted.length === 0) {
    console.error('No usable rows. Aborting before clearing the table.');
    await close();
    process.exit(1);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM external_reference_items');
    await client.query('ALTER SEQUENCE external_reference_items_id_seq RESTART WITH 1').catch(() => {});

    let inserted = 0;
    for (const item of allAccepted) {
      await client.query(
        `INSERT INTO external_reference_items
           (brand, product_name, item_type, size_label, chest_inches, shoulder_inches, length_inches, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          item.brand, item.productName, item.itemType, item.sizeLabel,
          item.chest,
          item.shoulder, // null allowed (migration 006)
          item.length,   // null allowed (migration 006)
          item.source,   // 'factory' | 'hand' (migration 007)
        ]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`✓ Sync complete. external_reference_items now contains ${inserted} rows.`);
    console.log(`   factory: ${factory.accepted.length}, hand: ${hand.accepted.length}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction rolled back. No rows changed.');
    throw err;
  } finally {
    client.release();
  }

  // -- Diagnostics ------------------------------------------------------
  if (allSkipped.length) {
    const byReason: Record<string, { row: number; brand: string; product: string; sheet: string }[]> = {};
    allSkipped.forEach((s) => {
      const key = `${s.sheet}: ${s.reason}`;
      (byReason[key] ||= []).push(s);
    });
    console.log(`\nSkipped ${allSkipped.length} unusable rows:`);
    Object.entries(byReason).forEach(([reason, items]) => {
      console.log(`  · ${reason} — ${items.length}`);
      items.slice(0, 5).forEach((it) => {
        console.log(`      sheet row ${it.row}: ${it.brand} — ${it.product}`);
      });
      if (items.length > 5) console.log(`      …and ${items.length - 5} more`);
    });
  }

  if (allPartial.length) {
    console.log(
      `\nNote: ${allPartial.length} rows synced with chest only (shoulder/length missing). ` +
      `These contribute to crowd-based recommendations but the measurement-scoring layer ` +
      `should be patched to skip NULL components.`
    );
  }

  await close();
}

main().catch((err) => { console.error(err); process.exit(1); });
