/**
 * Import survey responses from a Google Sheet CSV export.
 *
 * Usage:
 *   npm run survey:import -- path/to/responses.csv
 *
 * Or with the Google Sheets public CSV URL:
 *   npm run survey:import -- --url "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv"
 *
 * The script is idempotent — it uses the respondent's email as a unique key.
 * Running it again with updated data will skip existing respondents (or update
 * them if you pass --update).
 */

import fs from 'fs';
import path from 'path';
import { db, execScript, close } from '../src/db';

// ---------------------------------------------------------------------------
// Ensure migration has run
// ---------------------------------------------------------------------------
const migrationPath = path.resolve(__dirname, '../migrations/003_survey_data.sql');
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  execScript(sql);
}

// ---------------------------------------------------------------------------
// Minimal CSV parser (handles quoted fields with commas and newlines)
// ---------------------------------------------------------------------------
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
        i++; // skip escaped quote
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
        if (ch === '\r') i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  row.push(field.trim());
  if (row.some(f => f !== '')) rows.push(row);

  return rows;
}

// ---------------------------------------------------------------------------
// Column mapping — maps your Google Sheet headers to our fields
// ---------------------------------------------------------------------------
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

// Garment slot pattern: garmentN_brand, garmentN_product, garmentN_size, garmentN_fit
const GARMENT_PATTERN = /^garment(\d+)_(brand|product|size|fit)$/i;

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let csvPath: string | undefined;
  let doUpdate = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') doUpdate = true;
    else if (!args[i].startsWith('-')) csvPath = args[i];
  }

  if (!csvPath) {
    console.error('Usage: npm run survey:import -- path/to/responses.csv [--update]');
    console.error('');
    console.error('To export from Google Sheets:');
    console.error('  1. Open your sheet in Google Sheets');
    console.error('  2. File → Download → Comma-separated values (.csv)');
    console.error('  3. Run this script with the downloaded file');
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
  console.log(`Headers: ${headers.join(', ')}`);

  // Build column index maps
  const colIndex: { [field: string]: number } = {};
  const garmentCols: { [slot: number]: { [part: string]: number } } = {};

  headers.forEach((h, i) => {
    // Check respondent-level fields
    if (HEADER_MAP[h]) {
      colIndex[HEADER_MAP[h]] = i;
    }

    // Check garment fields
    const gMatch = h.match(GARMENT_PATTERN);
    if (gMatch) {
      const slot = parseInt(gMatch[1], 10);
      const part = gMatch[2].toLowerCase(); // brand, product, size, fit
      if (!garmentCols[slot]) garmentCols[slot] = {};
      garmentCols[slot][part] = i;
    }

    // Also map otherBrand / otherProduct
    if (h === 'otherbrand') colIndex['other_brand'] = i;
    if (h === 'otherproduct') colIndex['other_product'] = i;
  });

  // Prepare statements
  const insertRespondent = db.prepare(`
    INSERT INTO survey_respondents
      (email, first_name, last_name, gender, height, weight, build_type,
       chest_measurement, fit_preference, buying_habits, return_frequency,
       frustrations, likelihood_score, additional_notes, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateRespondent = db.prepare(`
    UPDATE survey_respondents SET
      first_name = ?, last_name = ?, gender = ?, height = ?, weight = ?,
      build_type = ?, chest_measurement = ?, fit_preference = ?,
      buying_habits = ?, return_frequency = ?, frustrations = ?,
      likelihood_score = ?, additional_notes = ?, submitted_at = ?
    WHERE email = ?
  `);

  const findRespondent = db.prepare(`SELECT id FROM survey_respondents WHERE email = ?`);
  const deleteItems = db.prepare(`DELETE FROM survey_items WHERE respondent_id = ?`);

  const insertItem = db.prepare(`
    INSERT INTO survey_items (respondent_id, slot, brand, product_name, size_label, fit_rating)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

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

    const existing = findRespondent.get(email) as any;

    let respondentId: number;

    if (existing && doUpdate) {
      // Update existing respondent
      updateRespondent.run(
        col(row, 'first_name'), col(row, 'last_name'), col(row, 'gender'),
        col(row, 'height'), col(row, 'weight'), col(row, 'build_type'),
        col(row, 'chest_measurement'), col(row, 'fit_preference'),
        col(row, 'buying_habits'), col(row, 'return_frequency'),
        col(row, 'frustrations'),
        col(row, 'likelihood_score') ? parseInt(col(row, 'likelihood_score'), 10) : null,
        col(row, 'additional_notes'), col(row, 'submitted_at'),
        email
      );
      respondentId = existing.id;
      deleteItems.run(respondentId); // Re-import items
      updated++;
    } else if (existing) {
      skipped++;
      continue;
    } else {
      // Insert new respondent
      const info = insertRespondent.run(
        email, col(row, 'first_name'), col(row, 'last_name'), col(row, 'gender'),
        col(row, 'height'), col(row, 'weight'), col(row, 'build_type'),
        col(row, 'chest_measurement'), col(row, 'fit_preference'),
        col(row, 'buying_habits'), col(row, 'return_frequency'),
        col(row, 'frustrations'),
        col(row, 'likelihood_score') ? parseInt(col(row, 'likelihood_score'), 10) : null,
        col(row, 'additional_notes'), col(row, 'submitted_at')
      );
      respondentId = Number(info.lastInsertRowid);
      imported++;
    }

    // Import garment items (slots 1-5)
    for (const slotStr of Object.keys(garmentCols).sort()) {
      const slot = parseInt(slotStr, 10);
      const cols = garmentCols[slot];
      const brand = cols.brand !== undefined ? (row[cols.brand] || '').trim() : '';
      const product = cols.product !== undefined ? (row[cols.product] || '').trim() : '';
      const size = cols.size !== undefined ? (row[cols.size] || '').trim() : '';
      const fit = cols.fit !== undefined ? (row[cols.fit] || '').trim() : '';

      if (brand && product && size) {
        insertItem.run(respondentId, slot, brand, product, size, fit || null);
        itemCount++;
      }
    }
  }

  close();

  console.log('');
  console.log(`✓ Import complete:`);
  console.log(`  ${imported} new respondent(s)`);
  if (doUpdate) console.log(`  ${updated} updated respondent(s)`);
  console.log(`  ${skipped} skipped (${doUpdate ? 'no email' : 'already exists or no email'})`);
  console.log(`  ${itemCount} garment items`);
}

try {
  main();
} catch (err) {
  console.error('Import failed:', err);
  process.exit(1);
}
