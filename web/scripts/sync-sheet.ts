/* eslint-disable no-console */
/**
 * Sync Zero Returns Google Sheet submissions into closet_reports.
 *
 * The Zero Returns form writes rows to a Google Sheet. That sheet is
 * published to the web as CSV (File → Share → Publish to web → CSV).
 * Set ZERO_RETURNS_CSV_URL in web/.env to that URL.
 *
 * Column detection is pattern-based so this works even if the form schema
 * changes: we look for headers that match "Garment N <Field>".
 *
 * Run with: npm run sync  (from either repo root or web/)
 */

import dotenv from 'dotenv';
import path from 'path';
import { db, close } from '../src/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CSV_URL: string | undefined = process.env.ZERO_RETURNS_CSV_URL;
if (!CSV_URL) {
  console.error(
    'ZERO_RETURNS_CSV_URL is not set. Add it to web/.env, e.g.\n' +
      '  ZERO_RETURNS_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv'
  );
  process.exit(1);
}

// ---------- CSV parser (RFC-4180 compatible, small + stdlib-only) ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Trailing cell / row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- Header detection ----------

type GarmentSlot = {
  brand?: number;
  product?: number;
  size?: number;
  fit?: number;
};

type HeaderMap = {
  timestamp?: number;
  email?: number;
  garments: Record<number, GarmentSlot>;
};

function buildHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = { garments: {} };
  headers.forEach((raw, idx) => {
    const h = raw.trim().toLowerCase();

    if (!map.timestamp && /^timestamp$|^submitted|^date$/i.test(h)) {
      map.timestamp = idx;
    }
    if (!map.email && /email/i.test(h)) {
      map.email = idx;
    }

    // Flexible garment match: "garment 1 brand", "garment1_brand", "garment #1 product", etc.
    const gm = h.match(/garment[^0-9]*(\d+)[^a-z]*(brand|product|name|item|size|fit|rating)/i);
    if (gm) {
      const n = Number(gm[1]);
      const field = gm[2].toLowerCase();
      const slot = (map.garments[n] ||= {});
      if (field === 'brand') slot.brand = idx;
      else if (field === 'product' || field === 'name' || field === 'item') slot.product = idx;
      else if (field === 'size') slot.size = idx;
      else if (field === 'fit' || field === 'rating') slot.fit = idx;
    }
  });
  return map;
}

// ---------- Normalization ----------

function normalizeFit(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (/perfect|just right|great|ideal|good/.test(s)) return 'perfect';
  if (/small|tight|snug/.test(s)) return 'too_small';
  if (/big|loose|large|baggy/.test(s)) return 'too_big';
  return s;
}

function normalizeBrand(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// ---------- Main ----------

async function main() {
  const url = CSV_URL as string;
  console.log(`Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const csv = await res.text();
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) {
    console.log('Sheet has no data rows. Nothing to sync.');
    close();
    return;
  }

  const headers = rows[0];
  const map = buildHeaderMap(headers);
  const garmentSlots = Object.keys(map.garments)
    .map(Number)
    .sort((a, b) => a - b);

  if (garmentSlots.length === 0) {
    console.error('Could not find any "Garment N ..." columns in the sheet.');
    console.error('Headers seen: ' + headers.join(' | '));
    process.exit(1);
  }
  console.log(
    `Headers detected: ${garmentSlots.length} garment slots, ` +
      `timestamp=${map.timestamp ?? 'n/a'}, email=${map.email ?? 'n/a'}`
  );

  const upsert = db.prepare(
    `INSERT OR IGNORE INTO closet_reports
       (source, submission_id, customer_email, brand, product_name, size_label, fit_rating)
     VALUES ('zero_returns', ?, ?, ?, ?, ?, ?)`
  );

  let newRows = 0;
  let skipped = 0;

  db.exec('BEGIN');
  try {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const timestamp =
        map.timestamp !== undefined ? (row[map.timestamp] ?? '').trim() : '';
      const email = map.email !== undefined ? (row[map.email] ?? '').trim() : '';
      const submissionId = `${timestamp}|${email}` || `row-${r}`;

      for (const n of garmentSlots) {
        const slot = map.garments[n];
        const brand = slot.brand !== undefined ? row[slot.brand] : '';
        const product = slot.product !== undefined ? row[slot.product] : '';
        const size = slot.size !== undefined ? row[slot.size] : '';
        const fit = slot.fit !== undefined ? row[slot.fit] : '';

        if (!brand || !product || !size) {
          skipped++;
          continue;
        }

        const info = upsert.run(
          submissionId,
          email || null,
          normalizeBrand(brand),
          product.trim(),
          size.trim(),
          normalizeFit(fit)
        );
        if (info.changes > 0) newRows++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Sync failed:', err);
    process.exit(1);
  }

  console.log(`✓ Sync complete. Inserted ${newRows} new closet reports, skipped ${skipped} empty slots.`);

  // Quick summary of what's most reported and not yet promoted to reference items
  const pending = db
    .prepare(
      `SELECT cr.brand, cr.product_name, cr.size_label, COUNT(*) as reports,
              EXISTS (
                SELECT 1 FROM external_reference_items eri
                WHERE lower(eri.brand) = lower(cr.brand)
                  AND lower(eri.product_name) = lower(cr.product_name)
                  AND lower(eri.size_label) = lower(cr.size_label)
              ) as measured
         FROM closet_reports cr
         GROUP BY cr.brand, cr.product_name, cr.size_label
         HAVING measured = 0
         ORDER BY reports DESC
         LIMIT 10`
    )
    .all() as Array<{ brand: string; product_name: string; size_label: string; reports: number }>;

  if (pending.length > 0) {
    console.log('\nTop reported items not yet measured (run `npm run admin` → `promote` to add measurements):');
    pending.forEach((r) =>
      console.log(`  ${r.reports.toString().padStart(3)}x  ${r.brand} — ${r.product_name} (${r.size_label})`)
    );
  }

  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
