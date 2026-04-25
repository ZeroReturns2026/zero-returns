/**
 * Import survey responses from a Google Sheet CSV export.
 *
 * Usage:
 *   npm run survey:import -- path/to/responses.csv
 */

import fs from 'fs';
import path from 'path';
import { query, queryOne, execScript, close } from '../src/db';

// Ensure migration has run
const migrationPath = path.resolve(__dirname, '../migrations/003_survey_data.sql');
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  execScript(sql);
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field.trim());
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
        field = '';
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
  }
  row.push(field.trim());
  if (row.some(f => f !== '')) rows.push(row);

  return rows;
}

interface ColumnMap {
  [header: string]: string;
}

const HEADER_MAP: ColumnMap = {
  timestamp: 'submitted_at',
  email: 'email',
  firstname: 'first_name',
  lastname: 'last_name',
  gender: 'gender',
  height: 'height',
  weight: 'weight',
  buildtype: 'build_type',
  chestmeasurement: 'chest_measurement',
  fitpreference: 'fit_preference',
  buyinghabits: 'buying_habits',
  returnfrequency: 'return_frequency',
  frustrations: 'frustrations',
  likelihoodscore: 'likelihood_score',
  additionalnotes: 'additional_notes',
};

const GARMENT_PATTERN = /^garment(\d+)_(brand|product|size|fit)$/i;

async function main() {
  const args = process.argv.slice(2);
  let csvPath: string | undefined;
  let doUpdate = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') doUpdate = true;
    else if (!args[i].startsWith('-')) csvPath = args[i];
  }

  if (!csvPath) {
    console.error('Usage: npm run survey:import -- path/to/responses.csv [--update]');
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvText);

  if (rows.length < 2) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }

  const headers = rows[0].map(h => h.replace(/\s+/g, '').toLowerCase());
  const dataRows = rows.slice(1);

  console.log(`Found ${dataRows.length} response(s) with ${headers.length} columns.`);

  const colIndex: { [field: string]: number } = {};
  const garmentCols: { [slot: number]: { [part: string]: number } } = {};

  headers.forEach((h, i) => {
    if (HEADER_MAP[h]) {
      colIndex[HEADER_MAP[h]] = i;
    }
    const gMatch = h.match(GARMENT_PATTERN);
    if (gMatch) {
      const slot = parseInt(gMatch[1], 10);
      const part = gMatch[2].toLowerCase();
      if (!garmentCols[slot]) garmentCols[slot] = {};
      garmentCols[slot][part] = i;
    }
    if (h === 'otherbrand') colIndex['other_brand'] = i;
    if (h === 'otherproduct') colIndex['other_product'] = i;
  });

  function col(row: string[], field: string): string {
    const idx = colIndex[field];
    return idx !== undefined ? (row[idx] || '') : '';
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let itemCount = 0;

  for (const row of dataRows) {
    const email = col(row, 'email');
    if (!email) {
      skipped++;
      continue;
    }

    const existing = await queryOne<any>(`SELECT id FROM survey_respondents WHERE email = $1`, [email]);

    let respondentId: number;

    if (existing && doUpdate) {
      await query(
        `UPDATE survey_respondents SET
          first_name = $1, last_name = $2, gender = $3, height = $4, weight = $5,
          build_type = $6, chest_measurement = $7, fit_preference = $8,
          buying_habits = $9, return_frequency = $10, frustrations = $11,
          likelihood_score = $12, additional_notes = $13, submitted_at = $14
        WHERE email = $15`,
        [
          col(row, 'first_name'), col(row, 'last_name'), col(row, 'gender'),
          col(row, 'height'), col(row, 'weight'), col(row, 'build_type'),
          col(row, 'chest_measurement'), col(row, 'fit_preference'),
          col(row, 'buying_habits'), col(row, 'return_frequency'),
          col(row, 'frustrations'),
          col(row, 'likelihood_score') ? parseInt(col(row, 'likelihood_score'), 10) : null,
          col(row, 'additional_notes'), col(row, 'submitted_at'),
          email
        ]
      );
      respondentId = existing.id;
      await query(`DELETE FROM survey_items WHERE respondent_id = $1`, [respondentId]);
      updated++;
    } else if (existing) {
      skipped++;
      continue;
    } else {
      const result = await query<any>(
        `INSERT INTO survey_respondents
          (email, first_name, last_name, gender, height, weight, build_type,
           chest_measurement, fit_preference, buying_habits, return_frequency,
           frustrations, likelihood_score, additional_notes, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id`,
        [
          email, col(row, 'first_name'), col(row, 'last_name'), col(row, 'gender'),
          col(row, 'height'), col(row, 'weight'), col(row, 'build_type'),
          col(row, 'chest_measurement'), col(row, 'fit_preference'),
          col(row, 'buying_habits'), col(row, 'return_frequency'),
          col(row, 'frustrations'),
          col(row, 'likelihood_score') ? parseInt(col(row, 'likelihood_score'), 10) : null,
          col(row, 'additional_notes'), col(row, 'submitted_at')
        ]
      );
      respondentId = result[0].id;
      imported++;
    }

    for (const slotStr of Object.keys(garmentCols).sort()) {
      const slot = parseInt(slotStr, 10);
      const cols = garmentCols[slot];
      const brand = cols.brand !== undefined ? (row[cols.brand] || '').trim() : '';
      const product = cols.product !== undefined ? (row[cols.product] || '').trim() : '';
      const size = cols.size !== undefined ? (row[cols.size] || '').trim() : '';
      const fit = cols.fit !== undefined ? (row[cols.fit] || '').trim() : '';

      if (brand && product && size) {
        await query(
          `INSERT INTO survey_items (respondent_id, slot, brand, product_name, size_label, fit_rating)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [respondentId, slot, brand, product, size, fit || null]
        );
        itemCount++;
      }
    }
  }

  await close();

  console.log(`\n✓ Import complete:`);
  console.log(`  ${imported} new respondent(s)`);
  if (doUpdate) console.log(`  ${updated} updated respondent(s)`);
  console.log(`  ${skipped} skipped`);
  console.log(`  ${itemCount} garment items`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
