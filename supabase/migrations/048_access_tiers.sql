-- AIStart360 — Migration 048: тариф и per-user feature-флаги (Фаза 6, Пакет VIII)
--
-- Модель доступа (решение ПО 2026-07-09, вариант А): free = mini-GRI + Пульс +
-- мини-CRM + 1 демо-проход полного GRI; по тарифу — повторные полные GRI, PDF,
-- AI-чат, бенчмарки. tier — базовый уровень; feature_flags — per-user override
-- (админ-кнопки Фазы 6). Идемпотентно; существующие профили → 'free', {}.
--
-- ВАЖНО: сама миграция ничего не гейтит — энфорсмент включается в роутах
-- ОТДЕЛЬНО (вместе с upgrade-экраном), чтобы не ограничить существующих молча.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'pro'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.tier IS
  'Тариф доступа: free (mini-GRI+Пульс+CRM+1 полный GRI) | pro (всё). Фаза 6.';
COMMENT ON COLUMN public.profiles.feature_flags IS
  'Per-user override фич поверх тира: { gri_full, pdf_export, ai_chat, benchmarks }.';

NOTIFY pgrst, 'reload schema';
