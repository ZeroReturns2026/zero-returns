import { Router } from 'express';
import { queryOne } from '../db';
import { logEvent } from '../services/eventLogger';
import { EventType, Merchant, Product } from '../types';

export const eventsRouter = Router();

const ALLOWED: EventType[] = [
  'widget_open',
  'recommendation_requested',
  'recommendation_shown',
  'recommended_size_clicked',
  'add_to_cart_after_recommendation',
];

/**
 * POST /events
 * Body: { shopDomain?, shopifyProductId?, eventType, payload? }
 */
eventsRouter.post('/', async (req, res) => {
  try {
    const { shopDomain, shopifyProductId, productHandle, eventType, shopperId, payload } = req.body ?? {};
    if (!eventType || !ALLOWED.includes(eventType)) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }

    let merchantId: number | null = null;
    let productId: number | null = null;

    if (shopDomain) {
      const merchant = await queryOne<Merchant>(
        `SELECT id FROM merchants WHERE shop_domain = $1`,
        [shopDomain]
      );
      merchantId = merchant?.id ?? null;
    }
    // Look up product by handle first, then by shopify_product_id
    if (productHandle && merchantId) {
      const product = await queryOne<Product>(
        `SELECT id FROM products WHERE merchant_id = $1 AND handle = $2`,
        [merchantId, productHandle]
      );
      productId = product?.id ?? null;
    }
    if (!productId && shopifyProductId && merchantId) {
      const product = await queryOne<Product>(
        `SELECT id FROM products WHERE merchant_id = $1 AND shopify_product_id = $2`,
        [merchantId, shopifyProductId]
      );
      productId = product?.id ?? null;
    }

    await logEvent({
      merchantId,
      productId,
      eventType,
      payload: { ...((payload as any) ?? {}), shopperId },
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[events]', err);
    res.status(500).json({ error: 'Failed to log event' });
  }
});
