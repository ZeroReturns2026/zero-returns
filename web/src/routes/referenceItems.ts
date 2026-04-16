import { Router } from 'express';
import { query } from '../db';
import { ExternalReferenceItem } from '../types';

export const referenceItemsRouter = Router();

/**
 * GET /reference-items
 * Returns the list of reference items the shopper can pick from.
 * Grouped by brand on the client.
 */
referenceItemsRouter.get('/', async (_req, res) => {
  try {
    const rows = await query<ExternalReferenceItem>(
      `SELECT id, brand, product_name, item_type, size_label, chest_inches, shoulder_inches, length_inches
       FROM external_reference_items
       ORDER BY brand ASC, product_name ASC, size_label ASC`
    );

    // Collapse: for the picker, we expose brand -> product_name -> [sizes]
    const byBrand: Record<string, Record<string, { itemType: string; sizes: string[]; ids: number[] }>> = {};
    for (const row of rows) {
      if (!byBrand[row.brand]) byBrand[row.brand] = {};
      const bucket = byBrand[row.brand];
      if (!bucket[row.product_name]) {
        bucket[row.product_name] = { itemType: row.item_type, sizes: [], ids: [] };
      }
      bucket[row.product_name].sizes.push(row.size_label);
      bucket[row.product_name].ids.push(row.id);
    }

    res.json({ brands: byBrand });
  } catch (err: any) {
    console.error('[reference-items]', err);
    res.status(500).json({ error: 'Failed to load reference items' });
  }
});
