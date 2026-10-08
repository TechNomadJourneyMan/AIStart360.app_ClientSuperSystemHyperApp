-- =============================================================================
-- Ревизия привилегированных аккаунтов (аудит 2026-09-23, S1 / F-001).
-- ТОЛЬКО ЧТЕНИЕ. Ничего не меняет — решение по каждой строке принимает владелец.
--
-- Показывает:
--   1) все профили с role <> 'client' (включая оставшиеся 'owner', если 084 ещё
--      не применена) + их строку staff_roles;
--   2) все строки staff_roles, чей профиль остаётся 'client' (персонал GIGA-CRM);
--   3) auth-метаданные, в которых кто-то прислал role/status при регистрации
--      (след попытки эксплуатировать старый handle_new_user).
--
-- Единственный ожидаемый super_admin — technomadjourneyman@gmail.com.
-- =============================================================================

-- 1) Профили не-клиентов
SELECT
  p.id,
  p.email,
  p.full_name,
  p.role                       AS profile_role,
  p.status,
  sr.role                      AS staff_role,
  sr.granted_by,
  sr.granted_at,
  p.last_seen_at,
  p.created_at,
  u.last_sign_in_at,
  u.banned_until,
  (lower(p.email) = 'technomadjourneyman@gmail.com') AS is_expected_owner
FROM public.profiles p
LEFT JOIN public.staff_roles sr ON sr.user_id = p.id
LEFT JOIN auth.users u          ON u.id = p.id
WHERE p.role <> 'client'
ORDER BY (p.role = 'super_admin') DESC, p.role, p.created_at;

-- 2) Персонал через staff_roles при profiles.role = 'client'
SELECT
  sr.user_id,
  p.email,
  p.full_name,
  sr.role        AS staff_role,
  p.role         AS profile_role,
  p.status,
  sr.granted_by,
  sr.granted_at,
  p.last_seen_at,
  p.created_at
FROM public.staff_roles sr
LEFT JOIN public.profiles p ON p.id = sr.user_id
WHERE p.role IS NULL OR p.role = 'client'
ORDER BY sr.role, p.created_at;

-- 3) Кто при регистрации прислал role/status в метаданных
SELECT
  u.id,
  u.email,
  u.raw_user_meta_data ->> 'role'   AS meta_role,
  u.raw_user_meta_data ->> 'status' AS meta_status,
  p.role                            AS profile_role,
  p.status                          AS profile_status,
  u.created_at,
  u.last_sign_in_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE (u.raw_user_meta_data ->> 'role') IS NOT NULL
  AND (u.raw_user_meta_data ->> 'role') <> 'client'
ORDER BY u.created_at DESC;
