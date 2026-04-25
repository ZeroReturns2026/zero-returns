-- Hey Tailor — survey/preference data from Google Sheet intake form

CREATE TABLE IF NOT EXISTS survey_respondents (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  gender TEXT,
  height TEXT,
  weight TEXT,
  build_type TEXT,
  chest_measurement TEXT,
  fit_preference TEXT,
  buying_habits TEXT,
  return_frequency TEXT,
  frustrations TEXT,
  likelihood_score INTEGER,
  additional_notes TEXT,
  submitted_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_items (
  id SERIAL PRIMARY KEY,
  respondent_id INTEGER NOT NULL REFERENCES survey_respondents(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  fit_rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_items_respondent ON survey_items(respondent_id);
CREATE INDEX IF NOT EXISTS idx_survey_items_brand_product ON survey_items(brand, product_name);
CREATE INDEX IF NOT EXISTS idx_survey_items_brand_size ON survey_items(brand, size_label);
