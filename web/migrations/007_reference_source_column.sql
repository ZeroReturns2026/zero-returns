-- Track the provenance of each row in external_reference_items.
--
-- 'factory' — manufacturer-published size chart (default; covers all existing rows)
-- 'hand'    — Mike's personal hand measurements of garments he owns. Useful for
--             brands without published factory specs.
--
-- Future values might include 'crowd' once we accept community contributions.

ALTER TABLE external_reference_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'factory';

CREATE INDEX IF NOT EXISTS idx_reference_source ON external_reference_items(source);
