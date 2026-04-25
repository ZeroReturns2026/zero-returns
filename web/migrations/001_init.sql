-- Hey Tailor — initial schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS merchants (
  id SERIAL PRIMARY KEY,
  shop_domain TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'mens_top',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, shopify_product_id)
);

CREATE TABLE IF NOT EXISTS product_sizes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_label TEXT NOT NULL,
  chest_inches REAL NOT NULL,
  shoulder_inches REAL NOT NULL,
  length_inches REAL NOT NULL,
  UNIQUE (product_id, size_label)
);

CREATE TABLE IF NOT EXISTS external_reference_items (
  id SERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  size_label TEXT NOT NULL,
  chest_inches REAL NOT NULL,
  shoulder_inches REAL NOT NULL,
  length_inches REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS fit_profiles (
  id SERIAL PRIMARY KEY,
  anon_id TEXT UNIQUE,
  preferred_fit TEXT CHECK (preferred_fit IN ('trim', 'standard', 'relaxed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_merchant ON events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_product_sizes_product ON product_sizes(product_id);
CREATE INDEX IF NOT EXISTS idx_reference_brand ON external_reference_items(brand);
