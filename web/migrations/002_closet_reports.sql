-- Closet reports: every (brand, product, size, fit_rating) a customer has
-- told us they own, coming in from the Zero Returns Google Sheet sync.
-- These are UNMEASURED until an admin promotes them into external_reference_items.

CREATE TABLE IF NOT EXISTS closet_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'zero_returns',
  submission_id TEXT NOT NULL,             -- timestamp+email from the form, for dedupe
  customer_email TEXT,
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  fit_rating TEXT,                         -- raw value from the form, normalized lowercase
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, submission_id, brand, product_name, size_label)
);

CREATE INDEX IF NOT EXISTS idx_closet_brand_product ON closet_reports(brand, product_name);
CREATE INDEX IF NOT EXISTS idx_closet_reported_at ON closet_reports(reported_at);
