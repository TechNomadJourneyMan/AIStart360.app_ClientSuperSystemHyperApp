-- 071_survey_completed_notice_once.sql
-- «Анкета заполнена» must be announced to admins exactly once per user.
--
-- lib/survey/completion-notice.ts checks for an existing marker and then
-- inserts one; two parallel saves could both pass the check and both send the
-- Telegram alert. This partial unique index makes the second insert fail with
-- 23505, which the code treats as "already announced".
--
-- It also strips the admin spreadsheet link from markers written before the
-- fix: clients can read their own app_notifications rows through RLS.

-- Keep only the oldest marker per user before adding the index.
DELETE FROM public.app_notifications a
USING public.app_notifications b
WHERE a.category = 'survey'
  AND b.category = 'survey'
  AND a.metadata->>'event' = 'survey_completed'
  AND b.metadata->>'event' = 'survey_completed'
  AND a.user_id = b.user_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS app_notifications_survey_completed_once
  ON public.app_notifications (user_id)
  WHERE category = 'survey' AND metadata->>'event' = 'survey_completed';

UPDATE public.app_notifications
SET metadata = metadata - 'sheet_url'
WHERE category = 'survey' AND metadata ? 'sheet_url';
