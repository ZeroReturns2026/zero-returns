import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execScript, queryOne } from './db';
import { proxyRouter } from './routes/proxy';
import { referenceItemsRouter } from './routes/referenceItems';
import { recommendRouter } from './routes/recommend';
import { eventsRouter } from './routes/events';
import { webhookRouter } from './routes/webhooks';
import { conversionsRouter } from './routes/conversions';
import { profilesRouter } from './routes/profiles';
import { authRouter } from './routes/auth';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// --- Auto-migrate on startup ---
async function runMigrations() {
  // Try multiple possible locations for migration files
  const candidates = [
    path.resolve(__dirname, '../migrations'),      // from src/ (dev)
    path.resolve(__dirname, '../../migrations'),    // from dist/src/ (compiled)
  ];
  let migrationsDir = '';
  for (const dir of candidates) {
    if (fs.existsSync(dir)) { migrationsDir = dir; break; }
  }
  if (!migrationsDir) {
    console.log('[boot] No migrations directory found, skipping');
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await execScript(sql);
      console.log(`[boot] Migration applied: ${file}`);
    } catch (err: any) {
      // "already exists" is fine — means migration already ran
      if (!err.message?.includes('already exists')) {
        console.error(`[boot] Migration error in ${file}:`, err.message);
      }
    }
  }
}

// --- Auto-seed if tables are empty ---
async function seedIfEmpty() {
  try {
    const row = await queryOne<any>('SELECT COUNT(*) as cnt FROM merchants');
    if (row && Number(row.cnt) > 0) {
      console.log('[boot] Data already seeded, skipping');
      return;
    }
  } catch {
    console.log('[boot] Cannot check merchants table, skipping seed');
    return;
  }

  console.log('[boot] Seeding initial data...');
  try {
    const seedPath = path.resolve(__dirname, '../scripts/seed');
    if (fs.existsSync(seedPath + '.js')) {
      const { seed } = require(seedPath);
      await seed();
    } else {
      console.log('[boot] No compiled seed script found, skipping');
    }
  } catch (err: any) {
    console.error('[boot] Seed error:', err.message);
  }
}

// Boot: run migrations, seed, then start server
(async () => {
  await runMigrations();
  await seedIfEmpty();

  const app = express();

  // CORS + Chrome Private Network Access.
  app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Private-Network', 'true');
    res.header('Access-Control-Allow-Headers', 'content-type, accept, origin, authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/', (_req, res) => {
    res.json({ service: 'zero-returns', status: 'ok' });
  });

  // Merchant dashboard
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dashboard.html'));
  });

  // Shopify app proxy entry point.
  app.use('/proxy', proxyRouter);

  // Dev-only API routes
  app.use('/api/reference-items', referenceItemsRouter);
  app.use('/api/recommend', recommendRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/conversions', conversionsRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/auth', authRouter);

  // Serve static assets (logos, etc.)
  app.use('/assets', express.static(path.resolve(__dirname)));

  // Serve the standalone profile app
  app.get('/profile', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'profile-app.html'));
  });

  // Shopify webhooks (raw body for HMAC verification)
  app.use('/webhooks', webhookRouter);

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`[zero-returns] backend listening on http://localhost:${port}`);
    console.log(`  health:       GET  /`);
    console.log(`  dashboard:    http://localhost:${port}/dashboard`);
    console.log(`  proxy:        /proxy/*`);
    console.log(`  dev-only API: /api/*`);
  });
})();
