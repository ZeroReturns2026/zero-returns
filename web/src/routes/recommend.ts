import { Router } from 'express';
import { query, queryOne } from '../db';
import { recommendSize } from '../services/recommendationEngine';
import { logEvent } from '../services/eventLogger';
import {
  ExternalReferenceItem,
  Merchant,
  Product,
  ProductSize,
  RecommendationRequest,
} from '../types';

export const recommendRouter = Router();

/**
 * POST /recommend
 * Body: { shopDomain, shopifyProductId, referenceItemId, fitPreference? }
 */
recommendRouter.post('/', async (req, res) => {
  try {
    const body = req.body as RecommendationRequest;
    const { shopDomain, shopifyProductId, referenceItemId, fitPreference } = body;
    const productHandle = (body as any).productHandle as string | undefined;
    const shopperId = (body as any).shopperId as string | undefined;

    if (!shopDomain || !referenceItemId) {
      return res.status(400).json({ error: 'Missing shopDomain or referenceItemId' });
    }

    let merchant = await queryOne<Merchant>(
      `SELECT * FROM merchants WHERE shop_domain = $1`,
      [shopDomain]
    );
    // Dev fallback: if exact domain not found, use the first merchant.
    // In production each merchant has a unique domain, but during dev the
    // widget might report a different domain than what's in the seed.
    if (!merchant) {
      merchant = await queryOne<Merchant>(
        `SELECT * FROM merchants ORDER BY id ASC LIMIT 1`
      );
    }
    if (!merchant) {
      console.log('[recommend] 404: no merchant found for', shopDomain);
      return res.status(404).json({ error: 'Merchant not found' });
    }
    console.log('[recommend] merchant:', merchant.id, merchant.shop_domain);

    // Look up by handle first (preferred), fall back to shopify_product_id,
    // then fall back to first product in catalog (demo convenience).
    let product: Product | null = null;
    if (productHandle) {
      product = await queryOne<Product>(
        `SELECT * FROM products WHERE merchant_id = $1 AND handle = $2`,
        [merchant.id, productHandle]
      );
    }
    if (!product && shopifyProductId) {
      product = await queryOne<Product>(
        `SELECT * FROM products WHERE merchant_id = $1 AND shopify_product_id = $2`,
        [merchant.id, shopifyProductId]
      );
    }
    if (!product) {
      product = await queryOne<Product>(
        `SELECT * FROM products WHERE merchant_id = $1 ORDER BY id ASC LIMIT 1`,
        [merchant.id]
      );
    }
    if (!product) {
      console.log('[recommend] 404: no product found. handle=', productHandle, 'merchantId=', merchant.id);
      return res.status(404).json({ error: 'Product not found for this merchant' });
    }
    console.log('[recommend] product:', product.id, product.handle);

    const productSizes = await query<ProductSize>(
      `SELECT * FROM product_sizes WHERE product_id = $1 ORDER BY id ASC`,
      [product.id]
    );
    if (productSizes.length === 0) {
      return res.status(404).json({ error: 'No sizes configured for this product' });
    }

    const reference = await queryOne<ExternalReferenceItem>(
      `SELECT * FROM external_reference_items WHERE id = $1`,
      [referenceItemId]
    );
    if (!reference) {
      console.log('[recommend] 404: reference item not found, id=', referenceItemId);
      return res.status(404).json({ error: 'Reference item not found' });
    }
    console.log('[recommend] reference:', reference.id, reference.brand, reference.size_label);

    await logEvent({
      merchantId: merchant.id,
      productId: product.id,
      eventType: 'recommendation_requested',
      payload: { referenceItemId, fitPreference: fitPreference ?? 'standard', shopperId },
    });

    const result = await recommendSize({ productSizes, reference, fitPreference }, product.title);

    await logEvent({
      merchantId: merchant.id,
      productId: product.id,
      eventType: 'recommendation_shown',
      payload: {
        referenceItemId,
        recommendedSize: result.recommendedSize,
        confidence: result.confidence,
        shopperId,
        productHandle: product.handle,
      },
    });

    res.json(result);
  } catch (err: any) {
    console.error('[recommend]', err);
    res.status(500).json({ error: 'Recommendation failed' });
  }
});
