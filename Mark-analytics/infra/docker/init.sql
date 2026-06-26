-- Bootstraps a fresh Postgres for local development.
-- Run automatically by docker-compose on first boot (mounted to /docker-entrypoint-initdb.d/).

\connect mark

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- PostGIS is not bundled in pgvector/pgvector:pg16; try and skip gracefully.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'postgis extension unavailable in this image; geo features will use raw text';
END $$;
