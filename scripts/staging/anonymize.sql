-- scripts/staging/anonymize.sql — обезличивание копии прода в STAGING.
--
-- Запуск: как supabase_admin (суперпользователь), в той же транзакции, что и загрузка
-- (load.sh), либо отдельно на уже загруженной базе. Идемпотентно: повторный запуск
-- даёт тот же результат (N стабилен — порядок auth.users по created_at, id).
-- Ни данных, ни секретов не содержит.
--
-- Что делает (подробно — docs/staging/README.md):
--   1. Очищает переписку, омниканал, токены/секреты, 2FA, telegram/whatsapp-привязки,
--      письма, имперсонацию, чанки документов (явный список; ссылки на них из других таблиц — NULL).
--   2. auth.users / auth.identities: e-mail → user-<N>@staging.aistart360.test, телефоны,
--      токены, метаданные; пароль — случайный bcrypt (вход только через dev-панель).
--   3. Профили, компании, клиенты, анкета (контакты), документы, журналы (IP/UA).
--   4. Общая чистка ВСЕХ текстовых/jsonb/массивных колонок public и market:
--      e-mail → известная замена или redacted@staging.aistart360.test,
--      телефоны → +70000000000, исходные ФИО и названия компаний → «Пользователь N» и т.п.
--   5. Проверка: при остатке ПДн — EXCEPTION (вся транзакция откатывается).

\set ON_ERROR_STOP 1
RESET ROLE;
SET search_path = public, extensions, pg_temp;
-- Триггеры (updated_at, неизменяемость журналов, аудит) при обезличивании не нужны.
SET session_replication_role = replica;

DO $$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'anonymize.sql: нужен суперпользователь (supabase_admin)';
  END IF;
  IF coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database'), '')
     <> 'aistart360-staging' THEN
    RAISE EXCEPTION 'anonymize.sql: база не помечена как staging (COMMENT ON DATABASE … ''aistart360-staging'') — стоп';
  END IF;
END $$;

-- ─── 0. Вспомогательное (только во временной схеме сессии) ──────────────────

-- Пользователи: N по порядку регистрации.
DROP TABLE IF EXISTS pg_temp._u;
CREATE TEMP TABLE _u AS
SELECT id,
       row_number() OVER (ORDER BY created_at NULLS LAST, id)::int AS n,
       lower(email::text) AS old_email
FROM auth.users;
ALTER TABLE _u ADD COLUMN new_email text;
UPDATE _u SET new_email = CASE
  WHEN old_email LIKE '%@dev.aistart360.test' OR old_email LIKE '%@staging.aistart360.test' THEN old_email
  ELSE 'user-' || n || '@staging.aistart360.test' END;
CREATE UNIQUE INDEX ON _u (id);

-- Компании: N по порядку создания.
DROP TABLE IF EXISTS pg_temp._c;
CREATE TEMP TABLE _c AS
SELECT id, row_number() OVER (ORDER BY "createdAt" NULLS LAST, id)::int AS n, name AS old_name, user_id
FROM public.companies;
CREATE UNIQUE INDEX ON _c (id);

-- Карта e-mail: старый (нижний регистр) → новый.
DROP TABLE IF EXISTS pg_temp._em;
CREATE TEMP TABLE _em (old text PRIMARY KEY, new text NOT NULL);
INSERT INTO _em SELECT old_email, new_email FROM _u WHERE old_email IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO _em
SELECT lower(p.email), 'profile-' || row_number() OVER (ORDER BY p.created_at, p.id) || '@staging.aistart360.test'
FROM public.profiles p
WHERE p.email IS NOT NULL AND p.email NOT LIKE '%@staging.aistart360.test' AND p.email NOT LIKE '%@dev.aistart360.test'
  AND NOT EXISTS (SELECT 1 FROM _u WHERE _u.id = p.id)
ON CONFLICT DO NOTHING;
INSERT INTO _em
SELECT lower(x.email), 'legacy-user-' || row_number() OVER (ORDER BY x.id) || '@staging.aistart360.test'
FROM public.users x
WHERE x.email NOT LIKE '%@staging.aistart360.test' AND x.email NOT LIKE '%@dev.aistart360.test'
ON CONFLICT DO NOTHING;
INSERT INTO _em
SELECT lower(x.email), 'lead-' || row_number() OVER (ORDER BY x."createdAt", x.id) || '@staging.aistart360.test'
FROM public.mini_gri_leads x
WHERE x.email NOT LIKE '%@staging.aistart360.test'
ON CONFLICT DO NOTHING;
INSERT INTO _em
SELECT lower(x.email::text), 'market-user-' || row_number() OVER (ORDER BY x.created_at, x.id) || '@staging.aistart360.test'
FROM market.users x
WHERE x.email::text NOT LIKE '%@staging.aistart360.test' AND x.email::text NOT LIKE '%@dev.aistart360.test'
ON CONFLICT DO NOTHING;

-- Карта имён: исходная строка → замена. ci = без учёта регистра.
-- Значения, уже похожие на замену («Пользователь 5»), в карту не попадают (идемпотентность).
DROP TABLE IF EXISTS pg_temp._nm;
CREATE TEMP TABLE _nm (old text PRIMARY KEY, new text NOT NULL, ci boolean NOT NULL);
CREATE OR REPLACE FUNCTION pg_temp.is_placeholder(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT s ~ '^\s*(Пользователь|Компания|Контакт|Клиент|Организация|Пациент|Персона)( [0-9A-Za-z-]+)?\s*$'
      OR s ~* '^\s*\[(имя|обезличено|заметка обезличена)\]\s*$'
$f$;
CREATE OR REPLACE FUNCTION pg_temp.stopword(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT lower(s) = ANY (ARRAY[
    'пользователь','компания','контакт','клиент','организация','пациент','персона','эксперт','админ',
    'администратор','менеджер','тест','тестовый','демо','супер','admin','test','user','expert','client',
    'demo','super','manager','staff','owner','guest','tester','support','aistart','aistart360','company',
    'группа','group','центр','center','сервис','service','холдинг','holding','казахстан','kazakhstan',
    'алматы','астана','almaty','astana','shop','store','market','маркет','магазин','студия','studio'])
$f$;

-- Полные строки: ФИО профилей и legacy-пользователей, контакты компаний.
INSERT INTO _nm
SELECT DISTINCT ON (btrim(p.full_name)) btrim(p.full_name), 'Пользователь ' || coalesce(u.n::text, 'P'), true
FROM public.profiles p LEFT JOIN _u u ON u.id = p.id
WHERE length(btrim(coalesce(p.full_name, ''))) >= 4 AND NOT pg_temp.is_placeholder(p.full_name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(x.name), 'Пользователь', true FROM public.users x
WHERE length(btrim(coalesce(x.name, ''))) >= 4 AND NOT pg_temp.is_placeholder(x.name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(c.contact_name), 'Контакт ' || _c.n, true FROM public.companies c JOIN _c ON _c.id = c.id
WHERE length(btrim(coalesce(c.contact_name, ''))) >= 4 AND NOT pg_temp.is_placeholder(c.contact_name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(sa.answer->>'value'), 'Контакт', true FROM public.survey_answers sa
WHERE sa.question_key = 's1_contact_name' AND jsonb_typeof(sa.answer->'value') = 'string'
  AND length(btrim(sa.answer->>'value')) >= 4 AND NOT pg_temp.is_placeholder(sa.answer->>'value')
ON CONFLICT DO NOTHING;
-- Названия компаний: полностью и «ядро» без формы собственности и кавычек.
INSERT INTO _nm
SELECT DISTINCT ON (btrim(_c.old_name)) btrim(_c.old_name), 'Компания ' || _c.n, true FROM _c
WHERE length(btrim(coalesce(_c.old_name, ''))) >= 4 AND NOT pg_temp.is_placeholder(_c.old_name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(sa.answer->>'value'), 'Компания', true FROM public.survey_answers sa
WHERE sa.question_key = 's1_company_name' AND jsonb_typeof(sa.answer->'value') = 'string'
  AND length(btrim(sa.answer->>'value')) >= 4 AND NOT pg_temp.is_placeholder(sa.answer->>'value')
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(o.name), 'Организация', true FROM public.organizations o
WHERE length(btrim(coalesce(o.name, ''))) >= 4 AND NOT pg_temp.is_placeholder(o.name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(p.organization), 'Организация', true FROM public.profiles p
WHERE length(btrim(coalesce(p.organization, ''))) >= 4 AND NOT pg_temp.is_placeholder(p.organization)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT btrim(c.name), 'Клиент', true FROM public.clients c
WHERE length(btrim(coalesce(c.name, ''))) >= 4 AND NOT pg_temp.is_placeholder(c.name)
ON CONFLICT DO NOTHING;
INSERT INTO _nm
SELECT DISTINCT core, 'Компания', true FROM (
  SELECT btrim(regexp_replace(regexp_replace(old, '^\s*(ТОО|ИП|АО|ООО|ОАО|ЗАО|ПК|КХ|LLP|LLC|TOO|IP|JSC)\s+', '', 'i'),
                              '[«»"“”„'']', '', 'g')) AS core
  FROM _nm WHERE new LIKE 'Компания%' OR new LIKE 'Организация%'
) s
WHERE length(core) >= 4 AND NOT pg_temp.stopword(core) AND NOT pg_temp.is_placeholder(core)
ON CONFLICT DO NOTHING;
-- Отдельные слова ФИО (с заглавной буквы, ≥ 4 букв, не служебные) — с учётом регистра.
INSERT INTO _nm
SELECT DISTINCT w, '[имя]', false FROM (
  SELECT regexp_split_to_table(old, '[\s,.;:()«»"]+') AS w FROM _nm
  WHERE new LIKE 'Пользователь%' OR new LIKE 'Контакт%'
) s
WHERE length(w) >= 4 AND w ~ '^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі''-]+$' AND NOT pg_temp.stopword(w)
ON CONFLICT DO NOTHING;
-- Строки, целиком состоящие из служебных слов («Owner», «Test User»), не считаем именами.
DELETE FROM _nm WHERE NOT EXISTS (
  SELECT 1 FROM regexp_split_to_table(old, '[\s,.;:()«»"-]+') w WHERE length(w) >= 3 AND NOT pg_temp.stopword(w));
ALTER TABLE _nm ADD COLUMN re text;
UPDATE _nm SET re = '(^|[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі0-9_])('
  || regexp_replace(old, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
  || ')(?=$|[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі0-9_])';
-- Для финальной проверки: исходные полные строки (не отдельные слова).
DROP TABLE IF EXISTS pg_temp._orig;
CREATE TEMP TABLE _orig AS SELECT old FROM _nm WHERE ci AND length(old) >= 5;

-- Перехеширование с солью (своя на каждый прогон): формат sha256-hex (64 символа) сохраняется
-- (CHECK-ограничения), связи внутри таблицы — тоже; исходный хэш восстановить нельзя.
DROP TABLE IF EXISTS pg_temp._salt;
CREATE TEMP TABLE _salt AS SELECT encode(extensions.gen_random_bytes(16), 'hex') AS s;
CREATE OR REPLACE FUNCTION pg_temp.rehash(h text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN h IS NULL THEN NULL
              ELSE encode(extensions.digest(h || (SELECT s FROM pg_temp._salt), 'sha256'), 'hex') END
$f$;

-- Регулярки ПДн (те же — в verify-pii.sql).
CREATE OR REPLACE FUNCTION pg_temp.re_email() RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' $f$;
CREATE OR REPLACE FUNCTION pg_temp.re_phone() RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT '(\+\d[\d\s()-]{8,16}\d)|((^|[^\d.,])8[\s(-]?7\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}($|[^\d]))|((^|[^\d.,])7[07]\d{9}($|[^\d]))' $f$;

-- Текст: e-mail → карта / redacted, телефоны → +70000000000, имена → замены.
CREATE OR REPLACE FUNCTION pg_temp.scrub(t text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE s text := t; r record; m text[]; lo text;
BEGIN
  IF s IS NULL OR s = '' THEN RETURN s; END IF;
  IF strpos(s, '@') > 0 THEN
    FOR m IN SELECT regexp_matches(s, pg_temp.re_email(), 'g') LOOP
      lo := lower(m[1]);
      IF lo LIKE '%@staging.aistart360.test' OR lo LIKE '%@dev.aistart360.test' THEN CONTINUE; END IF;
      s := replace(s, m[1], coalesce((SELECT new FROM _em WHERE old = lo), 'redacted@staging.aistart360.test'));
    END LOOP;
  END IF;
  IF s ~ '\d{7}|\d[\s()-]\d' THEN
    s := regexp_replace(s, '\+\d[\d\s()-]{8,16}\d', '+70000000000', 'g');
    s := regexp_replace(s, '(^|[^\d.,])8[\s(-]?7\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?=$|[^\d])', '\1+70000000000', 'g');
    s := regexp_replace(s, '(^|[^\d.,+])7[07]\d{9}(?=$|[^\d])', '\1+70000000000', 'g');
  END IF;
  lo := lower(s);
  FOR r IN SELECT old, new, ci, re FROM _nm ORDER BY length(old) DESC LOOP
    IF (r.ci AND strpos(lo, lower(r.old)) > 0) OR (NOT r.ci AND strpos(s, r.old) > 0) THEN
      s := regexp_replace(s, r.re, '\1' || replace(r.new, '\', '\\'), CASE WHEN r.ci THEN 'gi' ELSE 'g' END);
      lo := lower(s);
    END IF;
  END LOOP;
  RETURN s;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.scrub_j(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE out jsonb; k text; v jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(j)
    WHEN 'string' THEN RETURN to_jsonb(pg_temp.scrub(j #>> '{}'));
    WHEN 'object' THEN
      out := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(j) LOOP out := out || jsonb_build_object(k, pg_temp.scrub_j(v)); END LOOP;
      RETURN out;
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(pg_temp.scrub_j(e) ORDER BY o), '[]'::jsonb) INTO out
      FROM jsonb_array_elements(j) WITH ORDINALITY a(e, o);
      RETURN out;
    ELSE RETURN j;
  END CASE;
END $f$;

-- Ответ анкеты в конверте { value, … }: заменить value, остальное сохранить.
CREATE OR REPLACE FUNCTION pg_temp.set_value(a jsonb, v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN a IS NULL THEN NULL
              WHEN jsonb_typeof(a) = 'object' THEN jsonb_set(a, '{value}', coalesce(v, 'null'::jsonb), true)
              ELSE jsonb_build_object('value', coalesce(v, 'null'::jsonb)) END
$f$;

-- ─── 1. Очистка (DELETE по явному списку; ссылки из сохраняемых таблиц — в NULL) ─

DO $$
DECLARE lst text; r record; regs regclass[];
BEGIN
  SELECT array_agg(c.oid::regclass ORDER BY c.relname) INTO regs
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (
      c.relname ~ '^(comm_|assistant_|telegram_|whatsapp_|oauth_)'
      OR (c.relname ~ '^omnichannel_' AND c.relname <> 'omnichannel_settings')
      OR c.relname IN (
        'ai_messages', 'ai_conversations', 'bot_ai_messages',
        'ai_journey_messages', 'ai_journey_device_credentials', 'ai_journey_connect_codes',
        'shared_reports', 'pb_invites', 'platform_invitations',
        'user_security', 'webauthn_credentials', 'mcp_tokens', 'staff_telegram_links',
        'myhonor_order_notifications', 'sessions', 'verification_tokens', 'accounts',
        'email_deliveries', 'impersonation_sessions',
        'document_chunks', 'document_summaries',
        'idempotency_records', 'rate_limit_hits'));

  -- Ссылки на очищаемые таблицы из СОХРАНЯЕМЫХ таблиц → NULL (например expert_cases.comm_thread_id).
  FOR r IN
    SELECT k.conrelid::regclass AS src, k.confrelid::regclass AS dst,
           (SELECT string_agg(format('%I = NULL', a.attname), ', ')
              FROM unnest(k.conkey) ck JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ck) AS sets,
           (SELECT string_agg(format('%I IS NOT NULL', a.attname), ' OR ')
              FROM unnest(k.conkey) ck JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ck) AS cond
    FROM pg_constraint k
    WHERE k.contype = 'f' AND k.confrelid = ANY (regs) AND NOT (k.conrelid = ANY (regs))
  LOOP
    EXECUTE format('UPDATE %s SET %s WHERE %s', r.src, r.sets, r.cond);
    RAISE NOTICE 'anonymize: ссылки %.(%) на очищаемую % → NULL', r.src, r.sets, r.dst;
  END LOOP;

  -- TRUNCATE не допускает внешних ссылок на таблицу, поэтому — DELETE (триггеры выключены, ссылки обнулены).
  IF regs IS NOT NULL THEN
    FOR r IN SELECT unnest(regs) AS t LOOP
      EXECUTE format('DELETE FROM %s', r.t);
    END LOOP;
    RAISE NOTICE 'anonymize: очищены %', array_to_string(regs::text[], ', ');
  END IF;

  SELECT string_agg(format('auth.%I', c.relname), ', ' ORDER BY c.relname) INTO lst
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relkind = 'r'
    AND c.relname IN ('sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_challenges', 'mfa_factors',
                      'mfa_recovery_codes', 'mfa_recovery_code_sets', 'one_time_tokens', 'flow_state',
                      'audit_log_entries', 'webauthn_credentials', 'webauthn_challenges',
                      'oauth_authorizations', 'oauth_consents', 'saml_relay_states');
  IF lst IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || lst;
    RAISE NOTICE 'anonymize: очищены %', lst;
  END IF;
END $$;

-- ─── 2. auth ─────────────────────────────────────────────────────────────────

UPDATE auth.users a SET
  email = u.new_email,
  phone = NULL,
  phone_change = '',
  phone_change_token = '',
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  confirmation_token = '',
  recovery_token = '',
  reauthentication_token = '',
  -- случайный пароль, никому не известный: вход в staging — только через dev-панель
  encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf', 8)),
  raw_user_meta_data = (
    SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(coalesce(a.raw_user_meta_data, '{}'::jsonb)) e(k, v)
    WHERE k IN ('role', 'vertical', 'locale', 'email_verified', 'phone_verified', 'tier')
  ) || CASE WHEN a.raw_user_meta_data ? 'email' THEN jsonb_build_object('email', u.new_email) ELSE '{}'::jsonb END
    || CASE WHEN a.raw_user_meta_data ?| ARRAY['full_name', 'name'] THEN jsonb_build_object('full_name', 'Пользователь ' || u.n) ELSE '{}'::jsonb END,
  raw_app_meta_data = pg_temp.scrub_j(a.raw_app_meta_data)
FROM _u u WHERE u.id = a.id;

UPDATE auth.identities i SET
  provider_id = CASE WHEN i.provider = 'email' THEN i.user_id::text
                     WHEN i.provider_id LIKE 'staging-%' THEN i.provider_id
                     ELSE 'staging-' || i.provider || '-' || u.n || '-' || x.rn END,
  identity_data = jsonb_build_object(
    'sub', CASE WHEN i.provider = 'email' THEN i.user_id::text
                WHEN i.provider_id LIKE 'staging-%' THEN i.provider_id
                ELSE 'staging-' || i.provider || '-' || u.n || '-' || x.rn END,
    'email', u.new_email,
    'email_verified', coalesce((i.identity_data->>'email_verified')::boolean, i.provider <> 'email'),
    'phone_verified', false)
FROM _u u,
     (SELECT id, row_number() OVER (PARTITION BY user_id, provider ORDER BY created_at, id) AS rn FROM auth.identities) x
WHERE u.id = i.user_id AND x.id = i.id;

-- ─── 3. public: точечно ──────────────────────────────────────────────────────

UPDATE public.profiles p SET
  email = coalesce(u.new_email, (SELECT new FROM _em WHERE old = lower(p.email)), p.email),
  full_name = CASE WHEN p.full_name IS NULL THEN NULL ELSE 'Пользователь ' || coalesce(u.n::text, 'P') END,
  organization = CASE WHEN p.organization IS NULL THEN NULL ELSE 'Организация ' || coalesce(u.n::text, 'P') END,
  avatar_url = NULL, phone = NULL,
  telegram_chat_id = NULL, telegram_link_code = NULL, telegram_user_id = NULL, telegram_username = NULL,
  telegram_linked_at = NULL, telegram_link_token_hash = NULL, telegram_link_token_expires_at = NULL
FROM public.profiles p2 LEFT JOIN _u u ON u.id = p2.id
WHERE p2.id = p.id;

UPDATE public.users x SET
  email = coalesce((SELECT new FROM _em WHERE old = lower(x.email)), x.email),
  name = CASE WHEN x.name IS NULL THEN NULL ELSE 'Пользователь' END,
  image = NULL, "avatarUrl" = NULL,
  "passwordHash" = CASE WHEN x."passwordHash" IS NULL THEN NULL
                        ELSE extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf', 8)) END;

UPDATE public.companies c SET
  name = 'Компания ' || _c.n,
  contact_name = NULL, contact_phone = NULL, contact_email = NULL, contact_position = NULL,
  notes = NULL, domain = NULL
FROM _c WHERE _c.id = c.id;

UPDATE public.clients x SET name = 'Клиент ' || s.n, website = NULL, notes = NULL
FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) n FROM public.clients) s WHERE s.id = x.id;
UPDATE public.organizations x SET name = 'Организация ' || s.n, slug = 'org-' || s.n
FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) n FROM public.organizations) s WHERE s.id = x.id;
UPDATE public.report_documents SET client_name = 'Клиент';
UPDATE public.crm_clients x SET name = 'Клиент ' || s.n, phone = NULL, phone_raw = NULL, email = NULL, note = NULL
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) n FROM public.crm_clients) s WHERE s.id = x.id;
UPDATE public.sales SET manager_name_snapshot = NULL, negative_margin_comment = NULL;

UPDATE public.mini_gri_leads x SET email = coalesce((SELECT new FROM _em WHERE old = lower(x.email)), 'lead@staging.aistart360.test');
UPDATE market.users x SET email = coalesce((SELECT new FROM _em WHERE old = lower(x.email::text)), x.email::text);

UPDATE public.user_notes SET author_email = coalesce((SELECT new FROM _em WHERE old = lower(author_email)), author_email),
                             body = '[заметка обезличена]';

-- Журналы: строки сохраняем (нужны для разработки аудита), IP и user-agent — в NULL.
UPDATE public.admin_audit_log SET ip_address = NULL, user_agent = NULL WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;
UPDATE public.activity_log SET ip_address = NULL, user_agent = NULL WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;
UPDATE public.audit_logs SET "ipAddress" = NULL WHERE "ipAddress" IS NOT NULL;
UPDATE public.financial_audit_events SET ip_address = NULL, user_agent = NULL WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;
UPDATE market.audit_log SET ip = NULL, user_agent = NULL WHERE ip IS NOT NULL OR user_agent IS NOT NULL;

-- Документы: строки и пути оставляем (файлов в staging нет), извлечённый текст — убираем.
UPDATE public.documents SET parsed_data = NULL WHERE parsed_data IS NOT NULL;
UPDATE public.ai_extractions SET raw_excerpt = NULL WHERE raw_excerpt IS NOT NULL;
UPDATE public.point_a_values SET source_fragment = NULL WHERE source_fragment IS NOT NULL;

-- Пациенты/покупатели: имена → «Пациент N», хэши → перехеш с солью.
UPDATE public.patient_segments x SET display_name = CASE WHEN x.display_name IS NULL THEN NULL ELSE 'Пациент ' || s.n END,
  patient_hash = pg_temp.rehash(x.patient_hash)
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) n FROM public.patient_segments) s WHERE s.id = x.id;
UPDATE public.ecommerce_orders SET customer_hash = pg_temp.rehash(customer_hash);

-- Секреты интеграций (зашифрованы прод-ключом; в staging заводятся заново).
UPDATE public.crm_integrations SET "accessToken" = 'staging-redacted', "refreshToken" = NULL, "webhookUrl" = NULL, "isActive" = false;
UPDATE public.crm_provider_connections SET access_token = 'staging-redacted', is_active = false;
UPDATE public.integration_connections SET secret_ciphertext = NULL, refresh_ciphertext = NULL, account_label = NULL,
  status = CASE WHEN auth_kind = 'file' THEN status ELSE 'disconnected' END;
UPDATE public.ai_credentials SET secret_ciphertext = 'v1:staging-redacted', secret_hint = NULL, enabled = false;
UPDATE public.ai_journey_workspaces SET access_token_hash = pg_temp.rehash(access_token_hash);
UPDATE market.forecasts SET share_token = NULL, is_public = false WHERE share_token IS NOT NULL;

-- Рынок: компании из госреестра — названия оставляем, людей (учредители/руководители) и контакты убираем;
-- БИН у ИП = ИИН человека → NULL.
UPDATE market.companies SET founders = NULL, directors = NULL, email = NULL, phone = NULL, raw = NULL,
  bin = CASE WHEN legal_form ~* '(^|\s)(ИП|ип|индивидуальн)' THEN NULL ELSE bin END;
UPDATE market.persons x SET full_name = 'Персона ' || s.n, name_normalized = 'персона ' || s.n,
  iin = NULL, contacts = NULL, raw = NULL, role_history = NULL
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) n FROM market.persons) s WHERE s.id = x.id;

-- ─── 4. Анкета: контакты по ключу вопроса (lib/survey/questions.ts, шаг 1) ──

UPDATE public.survey_answers sa SET answer = pg_temp.set_value(sa.answer, CASE sa.question_key
    WHEN 's1_company_name' THEN to_jsonb(coalesce(
      (SELECT 'Компания ' || n FROM _c WHERE _c.id = sa.company_id),
      (SELECT 'Компания ' || min(n) FROM _c WHERE _c.user_id = sa.user_id),
      'Компания U' || coalesce((SELECT n::text FROM _u WHERE _u.id = sa.user_id), '?')))
    WHEN 's1_contact_name' THEN to_jsonb('Пользователь ' || coalesce((SELECT n::text FROM _u WHERE _u.id = sa.user_id), '?'))
    WHEN 's1_contact_email' THEN to_jsonb(coalesce((SELECT new_email FROM _u WHERE _u.id = sa.user_id), 'redacted@staging.aistart360.test'))
    ELSE 'null'::jsonb END)
WHERE sa.question_key IN ('s1_company_name', 's1_contact_name', 's1_contact_email', 's1_contact_phone', 's1_website', 's1_social_media');

UPDATE public.survey_answer_history SET
  old_value = CASE WHEN old_value IS NULL THEN NULL ELSE pg_temp.set_value(old_value, to_jsonb('[обезличено]'::text)) END,
  new_value = CASE WHEN new_value IS NULL THEN NULL ELSE pg_temp.set_value(new_value, to_jsonb('[обезличено]'::text)) END
WHERE question_key IN ('s1_company_name', 's1_contact_name', 's1_contact_email', 's1_contact_phone', 's1_website', 's1_social_media');

-- ─── 5. Общая чистка всех текстовых/jsonb/массивных колонок public и market ──

DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col, c.data_type AS dt, c.udt_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema IN ('public', 'market')
      AND c.table_name NOT IN ('spatial_ref_sys', 'schema_migrations')
      AND c.is_generated = 'NEVER'
      AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json') OR c.udt_name IN ('citext', '_text', '_varchar'))
      -- не трогаем первичные id и хэши; остальные колонки чистятся только там, где нашлось совпадение
      AND c.column_name !~* '(^id$|hash$|checksum$|sha256$|fingerprint$)'
      -- перечислимые технические колонки (роль, статус, тип…) — не ПДн
      AND c.column_name !~* '^(role|status|type|kind|channel|source|scenario|tier|segment|stage|level|priority|severity|category|mode|state|vertical|currency|unit|provider|action|operation|event_type|entity_type|actor_kind|actor_role|author_role|staff_role|permission|decision|capability|surface|direction|doc_type|parse_status|security_status)$'
    ORDER BY 1, 2, 3
  LOOP
    IF r.dt IN ('jsonb') THEN
      EXECUTE format('UPDATE %1$I.%2$I x SET %3$I = v.nv FROM (SELECT ctid AS tid, pg_temp.scrub_j(%3$I) AS nv FROM %1$I.%2$I WHERE %3$I IS NOT NULL) v
                      WHERE x.ctid = v.tid AND x.%3$I IS DISTINCT FROM v.nv', r.s, r.t, r.col);
    ELSIF r.dt = 'json' THEN
      EXECUTE format('UPDATE %1$I.%2$I x SET %3$I = v.nv::json FROM (SELECT ctid AS tid, pg_temp.scrub_j(%3$I::jsonb) AS nv FROM %1$I.%2$I WHERE %3$I IS NOT NULL) v
                      WHERE x.ctid = v.tid AND x.%3$I::jsonb IS DISTINCT FROM v.nv', r.s, r.t, r.col);
    ELSIF r.udt_name IN ('_text', '_varchar') THEN
      EXECUTE format('UPDATE %1$I.%2$I x SET %3$I = v.nv FROM (SELECT ctid AS tid,
                        ARRAY(SELECT pg_temp.scrub(e) FROM unnest(%3$I) WITH ORDINALITY a(e, o) ORDER BY o) AS nv
                      FROM %1$I.%2$I WHERE %3$I IS NOT NULL) v
                      WHERE x.ctid = v.tid AND x.%3$I::text[] IS DISTINCT FROM v.nv', r.s, r.t, r.col);
    ELSE
      EXECUTE format('UPDATE %1$I.%2$I x SET %3$I = v.nv FROM (SELECT ctid AS tid, pg_temp.scrub(%3$I::text) AS nv FROM %1$I.%2$I WHERE %3$I IS NOT NULL) v
                      WHERE x.ctid = v.tid AND x.%3$I::text IS DISTINCT FROM v.nv', r.s, r.t, r.col);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      total := total + n;
      RAISE NOTICE 'anonymize: %.%.% — изменено строк: %', r.s, r.t, r.col, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'anonymize: общая чистка — всего изменено значений: %', total;
END $$;

SET session_replication_role = origin;

-- ─── 6. Проверка (тот же код — в verify-pii.sql); остаток ПДн → EXCEPTION ────
\ir verify-pii.sql
