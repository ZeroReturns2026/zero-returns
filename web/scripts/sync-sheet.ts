/* eslint-disable no-console */
/**
 * Sync Zero Returns Google Sheet submissions into closet_reports.
 */

import dotenv from 'dotenv';
import path from 'path';
import { query, close } from '../src/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CSV_URL: string | undefined = process.env.ZERO_RETURNS_CSV_URL;
if (!CSV_URL) {
  console.error(
    'ZERO_RETURNS_CSV_URL is not set. Add it to web/.env.'
  );
  process.exit(1);
}

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

type GarmentSlot = { brand?: number; product?: number; size?: number; fit?: number; };
type HeaderMap = { timestamp?: number; email?: number; garments: Record<number, GarmentSlot>; };

function buildHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = { garments: {} };
  headers.forEach((raw, idx) => {
    const h = raw.trim().toLowerCase();
    if (!map.timestamp && /^timestamp$|^submitted|^date$/i.test(h)) map.timestamp = idx;
    if (!map.email && /email/i.test(h)) map.email = idx;
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
    console.log('Sheet has no data rows.');
    await close();
    return;
  }

  const headers = rows[0];
  const map = buildHeaderMap(headers);
  const garmentSlots = Object.keys(map.garments).map(Number).sort((a, b) => a - b);

  if (garmentSlots.length === 0) {
    console.error('Could not find any "Garment N ..." columns.');
    process.exit(1);
  }

  let newRows = 0;
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const timestamp = map.timestamp !== undefined ? (row[map.timestamp] ?? '').trim() : '';
    const email = map.email !== undefined ? (row[map.email] ?? '').trim() : '';
    const submissionId = `${timestamp}|${email}` || `row-${r}`;

    for (const n of garmentSlots) {
      const slot = map.garments[n];
      const brand = slot.brand !== undefined ? row[slot.brand] : '';
      const product = slot.product !== undefined ? row[slot.product] : '';
      const size = slot.size !== undefined ? row[slot.size] : '';
      const fit = slot.fit !== undefined ? row[slot.fit] : '';

      if (!brand || !product || !size) { skipped++; continue; }

      try {
        await query(
          `INSERT INTO closet_reports (source, submission_id, customer_email, brand, product_name, size_label, fit_rating)
           VALUES ('zero_returns', $1, $2, $3, $4, $5, $6)
           ON CONFLICT (source, submission_id, brand, product_name, size_label) DO NOTHING`,
          [submissionId, email || null, normalizeBrand(brand), product.trim(), size.trim(), normalizeFit(fit)]
        );
        newRows++;
      } catch {
        // Duplicate — skip
      }
    }
  }

  console.log(`✓ Sync complete. Inserted ${newRows} new closet reports, skipped ${skipped} empty slots.`);

  const pending = await query<any>(
    `SELECT cr.brand, cr.product_name, cr.size_label, COUNT(*) as reports
     FROM closet_reports cr
     LEFT JOIN external_reference_items eri
       ON lower(eri.brand) = lower(cr.brand)
       AND lower(eri.product_name) = lower(cr.product_name)
       AND lower(eri.size_label) = lower(cr.size_label)
     WHERE eri.id IS NULL
     GROUP BY cr.brand, cr.product_name, cr.size_label
     ORDER BY reports DESC
     LIMIT 10`
  );

  if (pending.length > 0) {
    console.log('\nTop reported items not yet measured:');
    pending.forEach((r: any) =>
      console.log(`  ${String(r.reports).padStart(3)}x  ${r.brand} — ${r.product_name} (${r.size_label})`)
    );
  }

  await close();
}

main().catch((err) => { console.error(err); process.exit(1); });
