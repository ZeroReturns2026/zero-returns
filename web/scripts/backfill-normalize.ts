/* eslint-disable no-console */
/**
 * One-time backfill: re-normalize every brand and product_name in
 * profile_items and survey_items using the (current) brandNormalizer.
 *
 * Run from web/:
 *   npm run backfill:normalize
 *
 * Safe to run multiple times — only updates rows whose normalized values
 * differ from what's currently stored.
 */
import { query, close } from '../src/db';
import { normalizeBrand, normalizeFit } from '../src/services/brandNormalizer';

interface Row {
  id: number;
  brand: string;
  product_name: string;
}

async function backfillTable(tableName: string): Promise<{ scanned: number; updated: number }> {
  const rows = await query<Row>(
    `SELECT id, brand, product_name FROM ${tableName}`
  );

  let updated = 0;
  for (const row of rows) {
    const newBrand = normalizeBrand(row.brand || '');
    const newProduct = normalizeFit(newBrand, row.product_name || '');

    const brandChanged = newBrand !== (row.brand || '');
    const productChanged = newProduct !== (row.product_name || '');

    if (brandChanged || productChanged) {
      await query(
        `UPDATE ${tableName} SET brand = $1, product_name = $2 WHERE id = $3`,
        [newBrand, newProduct, row.id]
      );
      updated++;
      const flags = [brandChanged && 'brand', productChanged && 'product']
        .filter(Boolean)
        .join('+');
      console.log(
        `  [${tableName} #${row.id}] (${flags}) "${row.brand}" / "${row.product_name}" → "${newBrand}" / "${newProduct}"`
      );
    }
  }

  return { scanned: rows.length, updated };
}

async function main() {
  console.log('Backfilling normalized brand and product names...');

  const profileResult = await backfillTable('profile_items');
  console.log(
    `\nprofile_items: scanned ${profileResult.scanned}, updated ${profileResult.updated}`
  );

  const surveyResult = await backfillTable('survey_items');
  console.log(
    `survey_items:  scanned ${surveyResult.scanned}, updated ${surveyResult.updated}`
  );

  await close();
  console.log('\nBackfill complete.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
