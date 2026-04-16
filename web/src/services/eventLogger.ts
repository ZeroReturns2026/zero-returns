import { query } from '../db';
import { EventType } from '../types';

export async function logEvent(params: {
  merchantId?: number | null;
  productId?: number | null;
  eventType: EventType;
  payload?: Record<string, any>;
}) {
  const { merchantId = null, productId = null, eventType, payload = {} } = params;
  await query(
    `INSERT INTO events (merchant_id, product_id, event_type, payload) VALUES ($1, $2, $3, $4)`,
    [merchantId, productId, eventType, JSON.stringify(payload)]
  );
}
