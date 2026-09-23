-- 083_admin_purge_user.sql — полное удаление пользователя из платформы и БД.
--
-- admin_purge_user(user_id, dry_run):
--   dry_run = true  → ничего не меняет, возвращает что будет удалено (счётчики
--                     и список файлов в Storage) — для диалога подтверждения;
--   dry_run = false → в ОДНОЙ транзакции удаляет данные, у которых нет внешнего
--                     ключа на пользователя, обнуляет «чужие» ссылки на него,
--                     затем удаляет profiles и auth.users — остальное (~70
--                     таблиц) уходит каскадом ON DELETE CASCADE.
--
-- Файлы Storage функция НЕ трогает (прямой DELETE из storage.objects запрещён
-- триггером protect_objects_delete) — она только возвращает их список, а
-- сервер удаляет их через Storage API.
--
-- Журнал действий персонала (admin_audit_log) сохраняется намеренно: запись
-- об удалении должна пережить удалённого.
--
-- Доступ — только service_role.
-- Применение: node scripts/apply-migration.js supabase/migrations/083_admin_purge_user.sql

CREATE OR REPLACE FUNCTION public.admin_purge_user(p_user_id UUID, p_dry_run BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          TEXT := p_user_id::text;
  v_company_ids  UUID[];
  v_company_txt  TEXT[];
  v_storage      JSONB;
  v_counts       JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_company_ids FROM public.companies WHERE user_id = p_user_id;
  v_company_txt := ARRAY(SELECT unnest(v_company_ids)::text);

  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name)), '[]'::jsonb)
    INTO v_storage
    FROM storage.objects
   WHERE owner = p_user_id OR owner_id = v_uid OR name LIKE v_uid || '/%';

  v_counts := jsonb_build_object(
    'companies',       coalesce(array_length(v_company_ids, 1), 0),
    'documents',       (SELECT count(*) FROM public.documents WHERE user_id = v_uid OR company_id = ANY (v_company_ids)),
    'survey_answers',  (SELECT count(*) FROM public.survey_answers WHERE user_id = p_user_id),
    'gri_assessments', (SELECT count(*) FROM public.gri_assessments WHERE user_id = p_user_id),
    'diagnostics',     (SELECT count(*) FROM public.diagnostics WHERE user_id = p_user_id),
    'ai_conversations',(SELECT count(*) FROM public.ai_conversations WHERE user_id = p_user_id),
    'files',           jsonb_array_length(v_storage)
  );

  IF p_dry_run THEN
    RETURN jsonb_build_object('found', true, 'dry_run', true, 'counts', v_counts, 'storage', v_storage);
  END IF;

  -- 1. Данные пользователя без внешнего ключа на него (text/uuid-колонки).
  DELETE FROM public.documents               WHERE user_id = v_uid OR company_id = ANY (v_company_ids);
  DELETE FROM public.document_summaries      WHERE user_id = v_uid;
  DELETE FROM public.assistant_conversations WHERE user_id = v_uid;
  DELETE FROM public.point_a_resolutions     WHERE user_id = v_uid;
  DELETE FROM public.point_a_value_events    WHERE user_id = v_uid;
  DELETE FROM public.point_a_values          WHERE user_id = v_uid;
  DELETE FROM public.point_a_sources         WHERE user_id = v_uid;
  DELETE FROM public.survey_answer_history   WHERE user_id = p_user_id;
  DELETE FROM public.shared_reports          WHERE "companyId" = ANY (v_company_txt);

  -- 2. Ссылки на пользователя из чужих записей без ON DELETE — обнуляем.
  UPDATE public.ai_conflicts SET resolved_by = NULL WHERE resolved_by = p_user_id;

  -- 3. Профиль и учётная запись; остальное — каскадом.
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users      WHERE id = p_user_id;

  RETURN jsonb_build_object('found', true, 'dry_run', false, 'counts', v_counts, 'storage', v_storage);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) TO service_role;
