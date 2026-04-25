-- Closet reports: every (brand, product, size, fit_rating) a customer has
-- told us they own, coming in from the Zero Returns Google Sheet sync.

CREATE TABLE IF NOT EXISTS closet_reports (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'zero_returns',
  submission_id TEXT NOT NULL,
  customer_email TEXT,
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  fit_rating TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, submission_id, brand, product_name, size_label)
);

CREATE INDEX IF NOT EXISTS idx_closet_brand_product ON closet_reports(brand, product_name);
CREATE INDEX IF NOT EXISTS idx_closet_reported_at ON closet_reports(reported_at);
