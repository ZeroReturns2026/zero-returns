-- Hey Tailor — survey/preference data from Google Sheet intake form

CREATE TABLE IF NOT EXISTS survey_respondents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  gender TEXT,
  height TEXT,              -- e.g. "5'10" or "178cm" — stored as-is from form
  weight TEXT,              -- e.g. "175 lbs" — stored as-is from form
  build_type TEXT,          -- e.g. "athletic", "slim", "average", "broad"
  chest_measurement TEXT,   -- e.g. "40 inches"
  fit_preference TEXT,      -- e.g. "slim fit", "regular", "relaxed"
  buying_habits TEXT,
  return_frequency TEXT,
  frustrations TEXT,
  likelihood_score INTEGER, -- 1-10 NPS-style score
  additional_notes TEXT,
  submitted_at TEXT,        -- original form timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  respondent_id INTEGER NOT NULL REFERENCES survey_respondents(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,    -- 1-5 (which garment slot in the form)
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  fit_rating TEXT,          -- how well it fits: "perfect", "slightly tight", etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_survey_items_respondent ON survey_items(respondent_id);
CREATE INDEX IF NOT EXISTS idx_survey_items_brand_product ON survey_items(brand, product_name);
CREATE INDEX IF NOT EXISTS idx_survey_items_brand_size ON survey_items(brand, size_label);
