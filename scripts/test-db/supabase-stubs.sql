-- Minimal Supabase platform objects for a disposable local Postgres.
--
-- Production runs on Supabase, where these objects are provided by the
-- platform (GoTrue owns auth.*, Storage owns storage.*). Locally we recreate
-- just enough of them for supabase/migrations/*.sql to apply and for RLS
-- policies to be exercised in tests:
--   * roles anon / authenticated / service_role (service_role BYPASSRLS)
--   * auth.users + auth.uid() / auth.role() / auth.jwt() / auth.email()
--     reading the same `request.jwt.claims` GUC PostgREST sets
--   * storage.buckets / storage.objects / storage.foldername()
--   * the supabase_realtime publication
--
-- NEVER apply this file to a real Supabase project.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ─── auth ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id          UUID,
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aud                  VARCHAR(255) DEFAULT 'authenticated',
  role                 VARCHAR(255) DEFAULT 'authenticated',
  email                VARCHAR(255),
  encrypted_password   VARCHAR(255),
  email_confirmed_at   TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  last_sign_in_at      TIMESTAMPTZ,
  raw_app_meta_data    JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data   JSONB DEFAULT '{}'::jsonb,
  phone                TEXT,
  banned_until         TIMESTAMPTZ,
  deleted_at           TIMESTAMPTZ,
  is_anonymous         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT ON auth.users TO service_role;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      auth.jwt() ->> 'sub'
    ), ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      auth.jwt() ->> 'role'
    ), ''
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'email', '')::text
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- ─── storage ─────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  owner               UUID,
  public              BOOLEAN DEFAULT FALSE,
  file_size_limit     BIGINT,
  allowed_mime_types  TEXT[],
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   TEXT REFERENCES storage.buckets(id),
  name        TEXT,
  owner       UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;

-- ─── realtime ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
