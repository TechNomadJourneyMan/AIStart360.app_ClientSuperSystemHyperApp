-- 078_system_settings_actor_text.sql
-- system_settings.updated_by был UUID, но автором бывает и аварийный вход
-- ('giga:super_admin'), и тогда сохранение любого переключателя падало.
-- Тот же формат, что admin_audit_log.actor_id / cms_pages.updated_by.
-- Применение: node scripts/apply-migration.js supabase/migrations/078_system_settings_actor_text.sql

ALTER TABLE public.system_settings ALTER COLUMN updated_by TYPE TEXT USING updated_by::text;

NOTIFY pgrst, 'reload schema';
