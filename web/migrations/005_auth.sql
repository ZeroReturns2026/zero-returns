-- Auth: user accounts for persistent login
CREATE TABLE IF NOT EXISTS auth_users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  profile_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  FOREIGN KEY (profile_id) REFERENCES shopper_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
