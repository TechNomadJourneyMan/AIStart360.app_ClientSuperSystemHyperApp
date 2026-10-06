-- 100_rate_limits.sql
--
-- Rate limiting shared by every serverless instance (docs/platform/09-security.md P2-7).
--
-- Before: lib/rate-limit.ts fell back to an in-memory Map per Vercel instance
-- when Upstash was not configured — N instances meant N independent counters,
-- and the Map was never evicted. Now lib/rate-limit.ts calls
-- public.rate_limit_hit() through Prisma (or Upstash when configured).
--
-- Algorithm — sliding window from two fixed windows (the weighted-previous-
-- window estimate also used by Upstash/Cloudflare):
--
--   estimate = prev_count * (1 - elapsed / window) + cur_count
--   a hit is allowed iff estimate + 1 <= max, and only allowed hits are counted
--
-- Each (key, window) holds at most two live rows. The check and the increment
-- of the current window are ONE statement (INSERT … ON CONFLICT DO UPDATE …
-- WHERE … RETURNING): the conflicting row is locked and the WHERE re-evaluated
-- on its latest version, so N concurrent calls with max M allow exactly M.
-- The previous window is read just before; it is closed (no longer written)
-- by then, except for requests in flight across the boundary.
--
-- `key` is '<bucket>:<hmac(identifier)>' — user ids / IPs are hashed by the
-- app before they reach the database (lib/rate-limit.ts hashIdentifier).
--
-- UNLOGGED: counters are disposable; skipping WAL keeps the hot path cheap.
-- After a crash the table is emptied, which only resets the limits.
--
-- Server-only: RLS on, no policies, ALL revoked from anon/authenticated; the
-- functions are SECURITY DEFINER with a pinned search_path and EXECUTE only
-- for the owner (Prisma's direct connection) and service_role.
--
-- Cleanup: rate_limit_prune() deletes expired rows in bounded batches; called
-- by the agents maintenance cron and opportunistically by the app.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/100_rate_limits.sql

CREATE UNLOGGED TABLE IF NOT EXISTS public.rate_limit_hits (
  key            TEXT        NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  window_seconds INTEGER     NOT NULL CHECK (window_seconds BETWEEN 1 AND 604800),
  window_start   TIMESTAMPTZ NOT NULL,
  count          INTEGER     NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, window_seconds, window_start)
);
COMMENT ON TABLE public.rate_limit_hits IS
  'Sliding-window rate limit counters (100). key = bucket:hmac(identifier); written only via rate_limit_hit().';

CREATE INDEX IF NOT EXISTS rate_limit_hits_expires_idx ON public.rate_limit_hits (expires_at);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_hits FROM PUBLIC, anon, authenticated;

-- ── rate_limit_hit ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_window_seconds INTEGER, p_max INTEGER)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after_seconds INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now      DOUBLE PRECISION := extract(epoch FROM clock_timestamp());
  v_w        INTEGER := p_window_seconds;
  v_cur_ep   DOUBLE PRECISION;
  v_cur      TIMESTAMPTZ;
  v_elapsed  DOUBLE PRECISION;
  v_weight   DOUBLE PRECISION;
  v_prev_cnt INTEGER;
  v_cnt      INTEGER;
  v_retry    DOUBLE PRECISION;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid key' USING ERRCODE = '22023';
  END IF;
  IF v_w IS NULL OR v_w NOT BETWEEN 1 AND 604800 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid window' USING ERRCODE = '22023';
  END IF;
  IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 1000000 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid max' USING ERRCODE = '22023';
  END IF;

  v_cur_ep  := floor(v_now / v_w) * v_w;
  v_cur     := to_timestamp(v_cur_ep);
  v_elapsed := v_now - v_cur_ep;
  v_weight  := greatest(0, 1 - v_elapsed / v_w);

  SELECT h.count INTO v_prev_cnt
    FROM public.rate_limit_hits h
   WHERE h.key = p_key AND h.window_seconds = v_w AND h.window_start = to_timestamp(v_cur_ep - v_w);
  v_prev_cnt := coalesce(v_prev_cnt, 0);

  -- Check + increment in one statement. No row back = denied.
  INSERT INTO public.rate_limit_hits AS h (key, window_seconds, window_start, count, expires_at)
  SELECT p_key, v_w, v_cur, 1, v_cur + make_interval(secs => 2 * v_w)
   WHERE v_prev_cnt * v_weight + 1 <= p_max
  ON CONFLICT (key, window_seconds, window_start) DO UPDATE
     SET count = h.count + 1
   WHERE h.count + v_prev_cnt * v_weight + 1 <= p_max
  RETURNING h.count INTO v_cnt;

  IF v_cnt IS NOT NULL THEN
    allowed := true;
    remaining := greatest(0, floor(p_max - (v_prev_cnt * v_weight + v_cnt)))::INTEGER;
    retry_after_seconds := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT h.count INTO v_cnt
    FROM public.rate_limit_hits h
   WHERE h.key = p_key AND h.window_seconds = v_w AND h.window_start = v_cur;
  v_cnt := coalesce(v_cnt, 0);

  IF v_cnt < p_max AND v_prev_cnt > 0 THEN
    -- The previous window's weight has to decay: prev * (1 - e/W) + cnt + 1 <= max.
    v_retry := v_w * (1 - (p_max - v_cnt - 1)::DOUBLE PRECISION / v_prev_cnt) - v_elapsed;
  ELSE
    -- The current window is full: wait for it to close, then for its weight
    -- (as the next window's "previous") to decay: cnt * (1 - e/W) + 1 <= max.
    v_retry := (v_w - v_elapsed) + v_w * greatest(0, 1 - (p_max - 1)::DOUBLE PRECISION / greatest(v_cnt, 1));
  END IF;

  allowed := false;
  remaining := 0;
  retry_after_seconds := least(2 * v_w, greatest(1, ceil(v_retry)))::INTEGER;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) IS
  'Atomic sliding-window rate limit hit (100): (allowed, remaining, retry_after_seconds). Server only.';

-- ── rate_limit_prune ────────────────────────────────────────────────────────
-- Deletes up to p_limit expired rows (expires_at = window_start + 2 windows,
-- i.e. no longer needed even as a "previous" window). SKIP LOCKED: never waits
-- on a row a concurrent rate_limit_hit holds.
CREATE OR REPLACE FUNCTION public.rate_limit_prune(p_limit INTEGER DEFAULT 10000)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.rate_limit_hits
   WHERE ctid = ANY (ARRAY(
     SELECT h.ctid FROM public.rate_limit_hits h
      WHERE h.expires_at < clock_timestamp()
      ORDER BY h.expires_at
      LIMIT greatest(1, least(coalesce(p_limit, 10000), 100000))
      FOR UPDATE SKIP LOCKED
   ));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_prune(INTEGER) IS
  'Deletes expired rate_limit_hits rows in a bounded batch (100). Server only.';

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_prune(INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rate_limit_prune(INTEGER) TO service_role;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
