import { Router, raw } from 'express';
import crypto from 'crypto';
import { query, queryOne } from '../db';
import { logEvent } from '../services/eventLogger';
import { Merchant, Product } from '../types';

export const webhookRouter = Router();

/**
 * Verify Shopify HMAC signature on incoming webhooks.
 * In production this prevents spoofed events. In dev we skip if no secret.
 */
function verifyShopifyHmac(body: Buffer, hmacHeader: string | undefined): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    // Dev mode — no secret configured, allow through
    console.warn('[webhooks] SHOPIFY_API_SECRET not set — skipping HMAC verification');
    return true;
  }
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

// Parse raw body for HMAC verification (must come before express.json)
webhookRouter.use(raw({ type: 'application/json' }));

/**
 * POST /webhooks/orders-create
 * Shopify fires this when a customer completes checkout.
 * We match line items against recent recommendations and log conversions.
 */
webhookRouter.post('/orders-create', async (req, res) => {
  try {
    const bodyBuf = req.body as Buffer;
    const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

    if (!verifyShopifyHmac(bodyBuf, hmac)) {
      console.warn('[webhooks] Invalid HMAC on orders-create');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const order = JSON.parse(bodyBuf.toString('utf-8'));
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;
    const customerEmail = order.customer?.email || order.email || null;
    const customerId = order.customer?.id || null;

    console.log(`[webhooks] orders-create from ${shopDomain}, order #${order.order_number}, customer: ${customerEmail}`);

    // Look up merchant
    const merchant = await queryOne<Merchant>(
      `SELECT * FROM merchants WHERE shop_domain = $1`,
      [shopDomain]
    );
    if (!merchant) {
      console.warn(`[webhooks] Unknown merchant: ${shopDomain}`);
      return res.status(200).json({ ok: true, skipped: 'unknown merchant' });
    }

    // Process each line item
    for (const item of order.line_items || []) {
      const shopifyProductId = `gid://shopify/Product/${item.product_id}`;
      const variantTitle = item.variant_title || ''; // e.g. "M" or "L"
      const productTitle = item.title || '';

      // Find the product in our DB
      const product = await queryOne<Product>(
        `SELECT * FROM products WHERE merchant_id = $1 AND shopify_product_id = $2`,
        [merchant.id, shopifyProductId]
      );

      // Also try by title match if product_id lookup fails
      let matchedProduct = product;
      if (!matchedProduct) {
        matchedProduct = await queryOne<Product>(
          `SELECT * FROM products WHERE merchant_id = $1 AND title = $2`,
          [merchant.id, productTitle]
        );
      }

      if (!matchedProduct) {
        console.log(`[webhooks] No matching product for ${productTitle} (${shopifyProductId})`);
        continue;
      }

      // Check for a recent recommendation for this product (last 7 days)
      const recentRecs = await query<any>(
        `SELECT * FROM events
         WHERE merchant_id = $1
           AND product_id = $2
           AND event_type = 'recommendation_shown'
           AND created_at > datetime('now', '-7 days')
         ORDER BY created_at DESC
         LIMIT 10`,
        [merchant.id, matchedProduct.id]
      );

      // Try to match by shopper_id in the payload, or just log the conversion
      let matchedRec = null;
      for (const rec of recentRecs) {
        const recPayload = typeof rec.payload === 'string' ? JSON.parse(rec.payload) : rec.payload;
        // If we have a customer email match or shopper_id match, use it
        if (recPayload.customerEmail === customerEmail && customerEmail) {
          matchedRec = rec;
          break;
        }
        if (recPayload.shopperId && order.note_attributes) {
          const shopperAttr = order.note_attributes.find((a: any) => a.name === '_ht_shopper');
          if (shopperAttr && shopperAttr.value === recPayload.shopperId) {
            matchedRec = rec;
            break;
          }
        }
      }

      // Log the purchase event
      await logEvent({
        merchantId: merchant.id,
        productId: matchedProduct.id,
        eventType: 'purchase_completed',
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          customerEmail,
          customerId,
          purchasedSize: variantTitle,
          quantity: item.quantity,
          price: item.price,
          // If we matched a recommendation, link it
          matchedRecommendation: matchedRec
            ? {
                eventId: matchedRec.id,
                recommendedSize: JSON.parse(matchedRec.payload).recommendedSize,
                referenceItemId: JSON.parse(matchedRec.payload).referenceItemId,
                confidence: JSON.parse(matchedRec.payload).confidence,
              }
            : null,
          // Did they buy the recommended size?
          followedRecommendation: matchedRec
            ? JSON.parse(matchedRec.payload).recommendedSize === variantTitle
            : null,
        },
      });

      console.log(
        `[webhooks] Logged purchase: ${productTitle} size ${variantTitle}` +
          (matchedRec ? ` (had recommendation for ${JSON.parse(matchedRec.payload).recommendedSize})` : ' (no matching recommendation)')
      );
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[webhooks] orders-create error:', err);
    res.status(200).json({ ok: true }); // Always 200 so Shopify doesn't retry
  }
});

/**
 * POST /webhooks/refunds-create
 * Shopify fires this when a refund/return is created.
 * We check if the returned item was a recommended size — that's signal
 * that the recommendation may have been wrong.
 */
webhookRouter.post('/refunds-create', async (req, res) => {
  try {
    const bodyBuf = req.body as Buffer;
    const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

    if (!verifyShopifyHmac(bodyBuf, hmac)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const refund = JSON.parse(bodyBuf.toString('utf-8'));
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    console.log(`[webhooks] refunds-create from ${shopDomain}, order #${refund.order_id}`);

    const merchant = await queryOne<Merchant>(
      `SELECT * FROM merchants WHERE shop_domain = $1`,
      [shopDomain]
    );
    if (!merchant) {
      return res.status(200).json({ ok: true, skipped: 'unknown merchant' });
    }

    // Each refund_line_item references the original line item
    for (const refundItem of refund.refund_line_items || []) {
      const lineItem = refundItem.line_item || {};
      const shopifyProductId = `gid://shopify/Product/${lineItem.product_id}`;
      const variantTitle = lineItem.variant_title || '';
      const productTitle = lineItem.title || '';

      const product = await queryOne<Product>(
        `SELECT * FROM products WHERE merchant_id = $1 AND shopify_product_id = $2`,
        [merchant.id, shopifyProductId]
      );

      if (!product) continue;

      // Check if there was a purchase_completed event for this order + product
      const purchaseEvents = await query<any>(
        `SELECT * FROM events
         WHERE merchant_id = $1
           AND product_id = $2
           AND event_type = 'purchase_completed'
           AND json_extract(payload, '$.orderId') = $3`,
        [merchant.id, product.id, refund.order_id]
      );

      await logEvent({
        merchantId: merchant.id,
        productId: product.id,
        eventType: 'return_initiated',
        payload: {
          orderId: refund.order_id,
          refundId: refund.id,
          returnedSize: variantTitle,
          reason: refundItem.reason || 'unknown',
          hadRecommendation: purchaseEvents.length > 0,
          originalPurchaseEvent: purchaseEvents[0]?.id || null,
        },
      });

      console.log(
        `[webhooks] Logged return: ${productTitle} size ${variantTitle}` +
          (purchaseEvents.length > 0 ? ' (was a recommended purchase)' : '')
      );
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[webhooks] refunds-create error:', err);
    res.status(200).json({ ok: true });
  }
});
