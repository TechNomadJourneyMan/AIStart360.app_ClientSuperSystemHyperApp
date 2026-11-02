-- 137_ai_routing_claude_default.sql
--
-- Platform-wide chat routing, PO decision 2026-11-02: Claude (through
-- OpenRouter) is the default chat model; the models of the Kazakh provider
-- llm.alem.ai — Qwen (`AlemLLM`) and Alem LLM (`alemllm`) — are the cheap
-- tier (Point A blocks, hypotheses) and the fallback when Claude is
-- unavailable or the OpenRouter credits ran out (HTTP 402 fails over,
-- lib/ai/providers/failover.ts).
--
--   1. The OpenRouter chat model registered as `Claude` is not an OpenRouter
--      id (every call answered HTTP 400, so every Point A analysis failed): it
--      becomes anthropic/claude-sonnet-4.5 «Claude Sonnet 4.5», tier_hint
--      premium. When that id is already registered, the routes of the bad row
--      move to it and the bad row is deleted. No row at all → it is added.
--   2. anthropic/claude-haiku-4.5 «Claude Haiku 4.5», tier_hint standard,
--      with the Sonnet row's key (credential_id).
--   3. Chat models of providers on llm.alem.ai: tier_hint light.
--   4. Chat routes: premium → Sonnet, standard → Haiku, light → AlemLLM (Qwen;
--      alemllm when there is no AlemLLM row; no Alem row → light unchanged).
--
-- Resulting candidate chains (lib/ai/providers/router.ts resolveCandidates:
-- route → other usable chat models by tier_hint distance, the stronger tier
-- first at the same distance → built-in OpenRouter):
--   premium   Sonnet → Haiku  → Qwen  → Alem   → built-in
--   standard  Haiku  → Sonnet → Qwen  → Alem   → built-in
--   light     Qwen   → Alem   → Haiku → Sonnet → built-in
--
-- Embeddings / rerank / OCR / transcribe routes are not touched. No keys, no
-- schema change. Idempotent; does nothing when the `openrouter` provider row
-- is missing. Apply (on push to main, PO rule):
--   node scripts/apply-migration.js supabase/migrations/137_ai_routing_claude_default.sql

DO $$
DECLARE
  v_or     uuid;
  v_sonnet uuid;
  v_haiku  uuid;
  v_light  uuid;
  v_bad    record;
BEGIN
  SELECT id INTO v_or FROM public.ai_providers WHERE key = 'openrouter';
  IF v_or IS NULL THEN
    RAISE NOTICE '137: provider openrouter is missing — nothing changed';
    RETURN;
  END IF;

  -- ─── 1. Claude Sonnet 4.5 (premium) ──────────────────────────────────────
  SELECT id INTO v_sonnet FROM public.ai_models
   WHERE provider_id = v_or AND capability = 'chat' AND model_id = 'anthropic/claude-sonnet-4.5';

  FOR v_bad IN
    SELECT id, credential_id FROM public.ai_models
     WHERE provider_id = v_or AND capability = 'chat' AND lower(btrim(model_id)) = 'claude'
     ORDER BY created_at, id
  LOOP
    IF v_sonnet IS NULL THEN
      UPDATE public.ai_models
         SET model_id = 'anthropic/claude-sonnet-4.5', updated_at = now()
       WHERE id = v_bad.id;
      v_sonnet := v_bad.id;
    ELSE
      -- Keep the bad row's key when the registered Sonnet row has none.
      UPDATE public.ai_models
         SET credential_id = v_bad.credential_id, updated_at = now()
       WHERE id = v_sonnet AND credential_id IS NULL AND v_bad.credential_id IS NOT NULL;
      -- Routes cascade on delete: move them first. (capability, tier) is unique
      -- and unchanged, so the move cannot collide.
      UPDATE public.ai_routes
         SET model_id = v_sonnet, updated_by = 'migration:137', updated_at = now()
       WHERE model_id = v_bad.id;
      DELETE FROM public.ai_models WHERE id = v_bad.id;
    END IF;
  END LOOP;

  IF v_sonnet IS NULL THEN
    INSERT INTO public.ai_models (provider_id, model_id, capability, label, tier_hint, source, enabled)
    VALUES (v_or, 'anthropic/claude-sonnet-4.5', 'chat', 'Claude Sonnet 4.5', 'premium', 'manual', TRUE)
    RETURNING id INTO v_sonnet;
  END IF;

  UPDATE public.ai_models
     SET label = 'Claude Sonnet 4.5', tier_hint = 'premium', updated_at = now()
   WHERE id = v_sonnet;

  -- ─── 2. Claude Haiku 4.5 (standard), the Sonnet row's key ────────────────
  INSERT INTO public.ai_models AS am (provider_id, credential_id, model_id, capability, label, tier_hint, source, enabled)
  SELECT v_or, s.credential_id, 'anthropic/claude-haiku-4.5', 'chat', 'Claude Haiku 4.5', 'standard', 'manual', TRUE
    FROM public.ai_models s
   WHERE s.id = v_sonnet
  ON CONFLICT (provider_id, model_id, capability) DO UPDATE SET
    label         = EXCLUDED.label,
    tier_hint     = EXCLUDED.tier_hint,
    credential_id = coalesce(am.credential_id, EXCLUDED.credential_id),
    updated_at    = now()
  RETURNING am.id INTO v_haiku;

  -- ─── 3. llm.alem.ai chat models: the cheap tier ──────────────────────────
  UPDATE public.ai_models m
     SET tier_hint = 'light', updated_at = now()
    FROM public.ai_providers p
   WHERE p.id = m.provider_id
     AND p.base_url ILIKE '%llm.alem.ai%'
     AND m.capability = 'chat'
     AND m.tier_hint IS DISTINCT FROM 'light';

  -- ─── 4. chat routes (ai_routes_capability_tier_key: capability, coalesce(tier, '')) ─
  INSERT INTO public.ai_routes (capability, tier, model_id, updated_by)
  VALUES ('chat', 'premium', v_sonnet, 'migration:137'),
         ('chat', 'standard', v_haiku, 'migration:137')
  ON CONFLICT (capability, coalesce(tier, '')) DO UPDATE SET
    model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now();

  SELECT m.id INTO v_light
    FROM public.ai_models m
    JOIN public.ai_providers p ON p.id = m.provider_id
   WHERE m.capability = 'chat'
     AND p.base_url ILIKE '%llm.alem.ai%'
     AND m.model_id IN ('AlemLLM', 'alemllm')
   ORDER BY (m.model_id = 'AlemLLM') DESC, (m.enabled AND p.enabled) DESC, m.created_at, m.id
   LIMIT 1;

  IF v_light IS NULL THEN
    RAISE NOTICE '137: no AlemLLM / alemllm chat model on llm.alem.ai — light route unchanged';
  ELSE
    INSERT INTO public.ai_routes (capability, tier, model_id, updated_by)
    VALUES ('chat', 'light', v_light, 'migration:137')
    ON CONFLICT (capability, coalesce(tier, '')) DO UPDATE SET
      model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END $$;
