import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { referenceItemsRouter } from './referenceItems';
import { recommendRouter } from './recommend';
import { eventsRouter } from './events';

export const proxyRouter = Router();

/**
 * Shopify App Proxy signature verification.
 * In local dev we skip this (VERIFY_PROXY_SIGNATURE != "true").
 * In prod we hash the sorted query string with the app secret and compare.
 */
function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  if (process.env.VERIFY_PROXY_SIGNATURE !== 'true') return next();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return res.status(500).json({ error: 'Missing SHOPIFY_API_SECRET' });

  const { signature, ...params } = req.query as Record<string, string>;
  if (!signature) return res.status(401).json({ error: 'Missing proxy signature' });

  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('');
  const digest = crypto.createHmac('sha256', secret).update(sorted).digest('hex');

  if (digest !== signature) return res.status(401).json({ error: 'Invalid proxy signature' });
  next();
}

proxyRouter.use(verifyShopifyProxy);
proxyRouter.use('/reference-items', referenceItemsRouter);
proxyRouter.use('/recommend', recommendRouter);
proxyRouter.use('/events', eventsRouter);

// Basic health check through the proxy
proxyRouter.get('/', (_req, res) => {
  res.json({ app: 'hey-tailor', ok: true });
});
