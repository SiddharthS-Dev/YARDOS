-- Extensions required by the SmartPark schema.
-- Runs once, on first initialisation of the data volume.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram index for fuzzy plate/name search
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- exclusion constraints on ranges
