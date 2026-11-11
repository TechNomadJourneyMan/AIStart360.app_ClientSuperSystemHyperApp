-- 139_alem_light_route_qwen.sql
--
-- The light chat route calls the model its key allows. Production error log
-- 2026-11-05 … 11-10: migration 137 pointed chat/light at the model row
-- `AlemLLM` of a provider on llm.alem.ai, but the key attached to that row
-- may only call `qwen3-8` — every light-tier call answered
-- `403 key not allowed to access model` and fell through to the Claude rows.
-- A second row, `alemllm` with no key of its own, inherits a key that may only
-- call `deepseek-ocr` — another 403 on every fallback. The rows that do work
-- already exist (discovered): `qwen3-8` with the Qwen key and `alemllm` with
-- the Alem LLM key.
--
--   1. The first qwen3-8 chat model with its own key on llm.alem.ai: enabled,
--      tier_hint light. No such row → nothing changes at all.
--   2. Chat routes that point at an llm.alem.ai `AlemLLM` row move to it.
--   3. An llm.alem.ai `alemllm` chat model with its own key and no tier_hint
--      becomes light (the fallback after Qwen).
--   4. Disabled, tier_hint cleared: the llm.alem.ai `AlemLLM` chat rows, and
--      the keyless `alemllm` chat rows — the latter only when an `alemllm`
--      with its own key exists to take their place.
--
-- Resulting light chain (lib/ai/providers/router.ts resolveCandidates):
--   qwen3-8 → other enabled light rows (alemllm with its own key) → Haiku
--   → Sonnet → built-in
--
-- Keys and credentials are not touched; no schema change; no row is deleted.
-- Idempotent: a second run finds the routes already moved and the rows
-- already disabled. Apply (on push to main, PO rule):
--   node scripts/apply-migration.js supabase/migrations/139_alem_light_route_qwen.sql

DO $$
DECLARE
  v_qwen uuid;
BEGIN
  SELECT m.id INTO v_qwen
    FROM public.ai_models m JOIN public.ai_providers p ON p.id = m.provider_id
   WHERE p.base_url LIKE '%llm.alem.ai%' AND m.capability = 'chat'
     AND m.model_id = 'qwen3-8' AND m.credential_id IS NOT NULL
   ORDER BY m.created_at, m.id LIMIT 1;
  IF v_qwen IS NULL THEN
    RAISE NOTICE '139: no qwen3-8 chat model with its own key — nothing changed';
    RETURN;
  END IF;

  UPDATE public.ai_models
     SET tier_hint = 'light', enabled = TRUE, updated_at = now()
   WHERE id = v_qwen;

  UPDATE public.ai_routes r
     SET model_id = v_qwen, updated_by = 'migration:139', updated_at = now()
    FROM public.ai_models m JOIN public.ai_providers p ON p.id = m.provider_id
   WHERE r.model_id = m.id AND r.capability = 'chat'
     AND p.base_url LIKE '%llm.alem.ai%' AND m.model_id = 'AlemLLM';

  UPDATE public.ai_models m
     SET tier_hint = 'light', updated_at = now()
    FROM public.ai_providers p
   WHERE p.id = m.provider_id AND p.base_url LIKE '%llm.alem.ai%'
     AND m.capability = 'chat' AND m.model_id = 'alemllm'
     AND m.credential_id IS NOT NULL AND m.tier_hint IS NULL;

  UPDATE public.ai_models m
     SET enabled = FALSE, tier_hint = NULL, updated_at = now()
    FROM public.ai_providers p
   WHERE p.id = m.provider_id AND p.base_url LIKE '%llm.alem.ai%' AND m.capability = 'chat'
     AND (
       m.model_id = 'AlemLLM'
       OR (m.model_id = 'alemllm' AND m.credential_id IS NULL AND EXISTS (
             SELECT 1 FROM public.ai_models w JOIN public.ai_providers wp ON wp.id = w.provider_id
              WHERE wp.base_url LIKE '%llm.alem.ai%' AND w.capability = 'chat'
                AND w.model_id = 'alemllm' AND w.credential_id IS NOT NULL))
     );
END $$;
