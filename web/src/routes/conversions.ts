import { Router } from 'express';
import { query } from '../db';

export const conversionsRouter = Router();

/**
 * GET /api/conversions
 * Returns a summary of the recommendation → purchase → return funnel.
 */
conversionsRouter.get('/', async (_req, res) => {
  try {
    // Total recommendations shown
    const [recCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events WHERE event_type = 'recommendation_shown'`
    );

    // Total add-to-carts after recommendation
    const [atcCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events WHERE event_type = 'add_to_cart_after_recommendation'`
    );

    // Total purchases
    const [purchaseCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events WHERE event_type = 'purchase_completed'`
    );

    // Purchases that followed the recommendation (bought recommended size)
    const [followedCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events
       WHERE event_type = 'purchase_completed'
         AND json_extract(payload, '$.followedRecommendation') = 1`
    );

    // Returns
    const [returnCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events WHERE event_type = 'return_initiated'`
    );

    // Returns that had a recommendation
    const [returnWithRecCount] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM events
       WHERE event_type = 'return_initiated'
         AND json_extract(payload, '$.hadRecommendation') = 1`
    );

    // --- Time series: daily event counts for the last 30 days ---
    const dailyEvents = await query<any>(
      `SELECT
         date(created_at) as day,
         event_type,
         COUNT(*) as count
       FROM events
       WHERE event_type IN (
         'recommendation_shown',
         'add_to_cart_after_recommendation',
         'purchase_completed',
         'return_initiated'
       )
       AND created_at > datetime('now', '-30 days')
       GROUP BY date(created_at), event_type
       ORDER BY day ASC`
    );

    // --- Per-product breakdown ---
    const productBreakdown = await query<any>(
      `SELECT
         p.title as product,
         p.handle,
         SUM(CASE WHEN e.event_type = 'recommendation_shown' THEN 1 ELSE 0 END) as recommendations,
         SUM(CASE WHEN e.event_type = 'add_to_cart_after_recommendation' THEN 1 ELSE 0 END) as add_to_carts,
         SUM(CASE WHEN e.event_type = 'purchase_completed' THEN 1 ELSE 0 END) as purchases,
         SUM(CASE WHEN e.event_type = 'return_initiated' THEN 1 ELSE 0 END) as returns
       FROM events e
       JOIN products p ON e.product_id = p.id
       WHERE e.event_type IN (
         'recommendation_shown',
         'add_to_cart_after_recommendation',
         'purchase_completed',
         'return_initiated'
       )
       GROUP BY p.id
       ORDER BY recommendations DESC`
    );

    // --- Top reference brands chosen by shoppers ---
    const topBrands = await query<any>(
      `SELECT
         json_extract(payload, '$.referenceItemId') as ref_id,
         COUNT(*) as count
       FROM events
       WHERE event_type = 'recommendation_shown'
       GROUP BY ref_id
       ORDER BY count DESC
       LIMIT 10`
    );

    // --- Size distribution of recommendations ---
    const sizeDistribution = await query<any>(
      `SELECT
         json_extract(payload, '$.recommendedSize') as size,
         COUNT(*) as count
       FROM events
       WHERE event_type = 'recommendation_shown'
         AND json_extract(payload, '$.recommendedSize') IS NOT NULL
       GROUP BY size
       ORDER BY count DESC`
    );

    // Recent events (last 50)
    const recentEvents = await query<any>(
      `SELECT e.*, p.title as product_title
       FROM events e
       LEFT JOIN products p ON e.product_id = p.id
       WHERE e.event_type IN (
         'recommendation_shown',
         'add_to_cart_after_recommendation',
         'purchase_completed',
         'return_initiated'
       )
       ORDER BY e.created_at DESC
       LIMIT 50`
    );

    res.json({
      funnel: {
        recommendations_shown: recCount?.count || 0,
        add_to_carts: atcCount?.count || 0,
        purchases: purchaseCount?.count || 0,
        followed_recommendation: followedCount?.count || 0,
        returns: returnCount?.count || 0,
        returns_with_recommendation: returnWithRecCount?.count || 0,
      },
      rates: {
        add_to_cart_rate:
          recCount?.count > 0
            ? ((atcCount?.count / recCount.count) * 100).toFixed(1)
            : '0.0',
        purchase_rate:
          recCount?.count > 0
            ? ((purchaseCount?.count / recCount.count) * 100).toFixed(1)
            : '0.0',
        recommendation_accuracy:
          purchaseCount?.count > 0
            ? ((followedCount?.count / purchaseCount.count) * 100).toFixed(1)
            : '0.0',
        return_rate:
          purchaseCount?.count > 0
            ? ((returnCount?.count / purchaseCount.count) * 100).toFixed(1)
            : '0.0',
      },
      daily: dailyEvents,
      products: productBreakdown,
      top_brands: topBrands,
      size_distribution: sizeDistribution,
      recent_events: recentEvents.map((e: any) => ({
        id: e.id,
        type: e.event_type,
        product: e.product_title,
        payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
        created_at: e.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[conversions]', err);
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});
