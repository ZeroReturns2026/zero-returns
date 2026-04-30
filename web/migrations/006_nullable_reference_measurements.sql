-- Allow NULL for shoulder and length on external_reference_items.
--
-- The "Factory Measurements" Google Sheet (the new source of truth) contains
-- many rows where the brand publishes chest specs but not shoulder/length —
-- these were previously skipped, but partial chest-only data is still useful
-- for the collaborative-filtering layer of the recommendation engine.
--
-- Chest remains NOT NULL (every reference row must have a chest measurement).
-- The measurement-scoring layer should be patched separately to skip NULL
-- components and renormalize weights when shoulder/length are missing.

ALTER TABLE external_reference_items ALTER COLUMN shoulder_inches DROP NOT NULL;
ALTER TABLE external_reference_items ALTER COLUMN length_inches DROP NOT NULL;
