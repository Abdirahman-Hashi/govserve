-- Baseline: extensions required by later phases (docs/DATA_MODEL.md).
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- partial reference-number search
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest() for audit hashing
