-- scripts/staging/verify-pii.sql — проверка «ПДн не осталось» в STAGING.
-- Печатает ТОЛЬКО счётчики (никаких значений). При любом остатке — EXCEPTION,
-- поэтому внутри транзакции загрузки (load.sh) остаток ПДн откатывает всю загрузку.
-- Можно запускать отдельно: psql … -v ON_ERROR_STOP=1 -f scripts/staging/verify-pii.sql

\set ON_ERROR_STOP 1
SET search_path = public, extensions, pg_temp;

DROP TABLE IF EXISTS pg_temp._pii;
CREATE TEMP TABLE _pii (check_name text, tbl text, col text, bad bigint);

-- 1. E-mail во ВСЕХ текстовых/jsonb/массивных колонках public, market и auth.users/identities:
--    допустимы только @staging.aistart360.test и @dev.aistart360.test.
-- 2. Телефоны (+7…, 8 7xx…, 7(0|7)xxxxxxxxx, любые +<10–14 цифр>), кроме заглушки +70000000000.
DO $$
DECLARE r record; e bigint; p bigint;
  re_email text := '[A-Za-z0-9._%+-]+@(?!(staging|dev)\.aistart360\.test)[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
  re_phone text := '((^|[^0-9A-Za-z])\+\d[\d\s()-]{8,16}\d)|((^|[^0-9A-Za-z.,+])8[\s(-]?7\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}($|[^0-9A-Za-z]))|((^|[^0-9A-Za-z.,+])7[07]\d{9}($|[^0-9A-Za-z]))';
BEGIN
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE (c.table_schema IN ('public', 'market') AND c.table_name NOT IN ('spatial_ref_sys', 'schema_migrations')
           OR (c.table_schema = 'auth' AND c.table_name IN ('users', 'identities')))
      AND (c.data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
           OR c.udt_name IN ('citext', '_text', '_varchar'))
      -- технические колонки, где «похожее на телефон» — не телефон
      AND NOT (c.column_name ~* '(hash|checksum|sha256|fingerprint)$')
  LOOP
    EXECUTE format($q$SELECT
        count(*) FILTER (WHERE %1$I::text ~* %4$L),
        count(*) FILTER (WHERE replace(%1$I::text, '+70000000000', '') ~ %5$L)
      FROM %2$I.%3$I WHERE %1$I IS NOT NULL$q$, r.col, r.s, r.t, re_email, re_phone) INTO e, p;
    IF e > 0 THEN INSERT INTO _pii VALUES ('email', r.s || '.' || r.t, r.col, e); END IF;
    -- телефоны: auth и колонки, где номер — это и есть данные (внешние ID ботов/мессенджеров очищены)
    IF p > 0 THEN INSERT INTO _pii VALUES ('phone', r.s || '.' || r.t, r.col, p); END IF;
  END LOOP;
END $$;

-- 3. Точечные проверки.
INSERT INTO _pii
SELECT 'auth.users email not staging', 'auth.users', 'email', count(*) FROM auth.users
 WHERE email NOT LIKE '%@staging.aistart360.test' AND email NOT LIKE '%@dev.aistart360.test'
UNION ALL SELECT 'auth.users phone', 'auth.users', 'phone', count(*) FROM auth.users WHERE coalesce(phone, '') <> ''
UNION ALL SELECT 'auth.users tokens', 'auth.users', '*_token, email_change, phone_change', count(*) FROM auth.users
 WHERE coalesce(confirmation_token, '') <> '' OR coalesce(recovery_token, '') <> '' OR coalesce(email_change_token_new, '') <> ''
    OR coalesce(email_change_token_current, '') <> '' OR coalesce(reauthentication_token, '') <> ''
    OR coalesce(phone_change_token, '') <> '' OR coalesce(email_change, '') <> '' OR coalesce(phone_change, '') <> ''
UNION ALL SELECT 'auth.users meta name/phone/avatar', 'auth.users', 'raw_user_meta_data', count(*) FROM auth.users
 WHERE raw_user_meta_data ?| ARRAY['name', 'phone', 'avatar_url', 'picture', 'given_name', 'family_name', 'preferred_username', 'user_name']
    OR (raw_user_meta_data ? 'full_name' AND raw_user_meta_data->>'full_name' !~ '^Пользователь ')
UNION ALL SELECT 'auth.identities email', 'auth.identities', 'identity_data', count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
 WHERE i.identity_data->>'email' IS DISTINCT FROM u.email
    OR i.identity_data ?| ARRAY['name', 'full_name', 'picture', 'avatar_url', 'given_name', 'family_name', 'phone']
UNION ALL SELECT 'auth.identities google id', 'auth.identities', 'provider_id', count(*) FROM auth.identities
 WHERE provider <> 'email' AND provider_id NOT LIKE 'staging-%'
UNION ALL SELECT 'public.profiles email', 'public.profiles', 'email', count(*) FROM public.profiles
 WHERE email NOT LIKE '%@staging.aistart360.test' AND email NOT LIKE '%@dev.aistart360.test'
UNION ALL SELECT 'public.profiles name', 'public.profiles', 'full_name', count(*) FROM public.profiles
 WHERE full_name IS NOT NULL AND full_name !~ '^Пользователь '
UNION ALL SELECT 'public.profiles contacts', 'public.profiles', 'phone/avatar/telegram_*', count(*) FROM public.profiles
 WHERE phone IS NOT NULL OR avatar_url IS NOT NULL OR telegram_chat_id IS NOT NULL OR telegram_user_id IS NOT NULL
    OR telegram_username IS NOT NULL OR telegram_link_code IS NOT NULL OR telegram_link_token_hash IS NOT NULL
UNION ALL SELECT 'public.companies', 'public.companies', 'name/contact_*', count(*) FROM public.companies
 WHERE name !~ '^Компания ' OR contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL
UNION ALL SELECT 'survey phones/sites', 'public.survey_answers', 'answer (*_phone, *_website, s1_social_media)', count(*)
 FROM public.survey_answers WHERE question_key IN ('s1_contact_phone', 'medical_phone', 's1_website', 's1_social_media', 'medical_clinic_website', 'ec_website')
  AND answer->'value' <> 'null'::jsonb
UNION ALL SELECT 'survey names', 'public.survey_answers', 'answer (company/person names)', count(*)
 FROM public.survey_answers WHERE (question_key IN ('s1_company_name', 'medical_clinic_name') AND answer->>'value' !~ '^Компания ')
  OR (question_key IN ('s1_contact_name', 'medical_full_name', 's9n_responsible_person') AND answer->>'value' !~ '^Пользователь ')
UNION ALL SELECT 'documents parsed_data', 'public.documents', 'parsed_data', count(*) FROM public.documents WHERE parsed_data IS NOT NULL
UNION ALL SELECT 'journals ip/ua', 'public.admin_audit_log+activity_log+audit_logs', 'ip/user_agent', (
   (SELECT count(*) FROM public.admin_audit_log WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL)
 + (SELECT count(*) FROM public.activity_log WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL)
 + (SELECT count(*) FROM public.audit_logs WHERE "ipAddress" IS NOT NULL)
 + (SELECT count(*) FROM market.audit_log WHERE ip IS NOT NULL OR user_agent IS NOT NULL))
UNION ALL SELECT 'secrets', 'ai_credentials+crm_*+integration_connections', 'secret/token', (
   (SELECT count(*) FROM public.ai_credentials WHERE secret_ciphertext <> 'v1:staging-redacted')
 + (SELECT count(*) FROM public.crm_integrations WHERE "accessToken" <> 'staging-redacted' OR "refreshToken" IS NOT NULL)
 + (SELECT count(*) FROM public.crm_provider_connections WHERE access_token <> 'staging-redacted')
 + (SELECT count(*) FROM public.integration_connections WHERE secret_ciphertext IS NOT NULL OR refresh_ciphertext IS NOT NULL)
 + (SELECT count(*) FROM market.forecasts WHERE share_token IS NOT NULL))
UNION ALL SELECT 'patients', 'public.patient_segments', 'display_name', count(*) FROM public.patient_segments
 WHERE display_name IS NOT NULL AND display_name !~ '^Пациент '
UNION ALL SELECT 'market people', 'market.companies+persons', 'founders/directors/iin/contacts', (
   (SELECT count(*) FROM market.companies WHERE founders IS NOT NULL OR directors IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
 + (SELECT count(*) FROM market.persons WHERE iin IS NOT NULL OR contacts IS NOT NULL OR full_name !~ '^Персона '));

-- 4. Очищенные таблицы пусты.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT n.nspname AS s, c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND (
      (n.nspname = 'public' AND (
         c.relname ~ '^(comm_|assistant_|telegram_|whatsapp_|oauth_)'
         OR (c.relname ~ '^omnichannel_' AND c.relname <> 'omnichannel_settings')
         OR c.relname IN ('ai_messages', 'ai_conversations', 'bot_ai_messages', 'ai_journey_messages',
           'ai_journey_device_credentials', 'ai_journey_connect_codes', 'shared_reports', 'pb_invites',
           'platform_invitations', 'user_security', 'webauthn_credentials', 'mcp_tokens', 'staff_telegram_links',
           'myhonor_order_notifications', 'sessions', 'verification_tokens', 'accounts', 'email_deliveries',
           'impersonation_sessions', 'document_chunks', 'document_summaries', 'idempotency_records', 'rate_limit_hits')))
      OR (n.nspname = 'auth' AND c.relname IN ('sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_challenges',
           'mfa_factors', 'one_time_tokens', 'flow_state', 'audit_log_entries')))
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.s, r.t) INTO n;
    IF n > 0 THEN INSERT INTO _pii VALUES ('must be empty', r.s || '.' || r.t, '*', n); END IF;
  END LOOP;
END $$;

-- 5. Исходные ФИО/названия (если проверка идёт в той же сессии, что anonymize.sql).
DO $$
DECLARE r record; o record; n bigint;
BEGIN
  IF to_regclass('pg_temp._orig') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema IN ('public', 'market') AND c.table_name NOT IN ('spatial_ref_sys', 'schema_migrations')
      AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json') OR c.udt_name IN ('citext', '_text', '_varchar'))
      AND c.column_name !~* '(^id$|hash$|checksum$|sha256$|fingerprint$)'
  LOOP
    -- ФИО — нигде; названия компаний — нигде, кроме технических идентификаторов
    -- (id, source, sku, url, пути и имена файлов: бренд в слаге — не ПДн, см. README).
    EXECUTE format('SELECT count(*) FROM %I.%I x WHERE %I IS NOT NULL AND EXISTS
                      (SELECT 1 FROM pg_temp._orig o WHERE x.%I::text ~* o.re AND (o.kind = ''person'' OR NOT %L))',
                   r.s, r.t, r.col, r.col,
                   r.col ~* '(^id$|_id$|Id$|_key$|^key$|^source$|^sku$|url$|path$|file_name$|^subject_id$|external_id$|event_id$)') INTO n;
    IF n > 0 THEN INSERT INTO _pii VALUES ('original name', r.s || '.' || r.t, r.col, n); END IF;
  END LOOP;
END $$;

\echo '=== verify-pii: нарушения (пусто = ПДн не найдено) ==='
SELECT check_name, tbl, col, bad FROM _pii WHERE bad > 0 ORDER BY 1, 2, 3;
SELECT count(*) FILTER (WHERE bad > 0) AS violations, count(*) AS checks FROM _pii \gset pii_
\echo 'verify-pii: проверок' :pii_checks ', нарушений' :pii_violations

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp._pii WHERE bad > 0) THEN
    RAISE EXCEPTION 'verify-pii: остались ПДн/секреты — см. список выше (транзакция откатывается)';
  END IF;
END $$;
