-- Shopper profiles: the "sizing passport" that follows users across stores
CREATE TABLE IF NOT EXISTS shopper_profiles (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  height TEXT DEFAULT '',
  weight TEXT DEFAULT '',
  build_type TEXT DEFAULT '',
  chest_measurement TEXT DEFAULT '',
  fit_preference TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_items (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES shopper_profiles(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  fit_rating TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_items_profile ON profile_items(profile_id);
CREATE INDEX IF NOT EXISTS idx_shopper_profiles_email ON shopper_profiles(email);
