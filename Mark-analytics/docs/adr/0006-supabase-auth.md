# ADR-0006: Supabase Auth как единый identity provider

- Status: Accepted (2026-05-24)
- Related: [ADR-0003](0003-supabase-postgres-primary-store.md)

## Контекст

Frontend на Vercel уже использует Supabase Auth (email/password + OAuth + magic links). Backend FastAPI должен идентифицировать пользователя по тому же токену, без дублирования auth-flow.

## Решение

Единственный identity-источник — **Supabase Auth**. Backend **не выдаёт собственные токены**, только проверяет Supabase JWT.

### Поток

1. Frontend получает JWT от Supabase (anon-flow): email/password, OAuth, magic-link, OTP.
2. Frontend шлёт API-запросы с `Authorization: Bearer <supabase_jwt>`.
3. Backend FastAPI middleware:
   - Получает JWKS публичные ключи с `${SUPABASE_URL}/auth/v1/keys` (кэш 1 час).
   - Верифицирует подпись JWT (`PyJWT` или `python-jose`).
   - Проверяет `aud=authenticated`, `iss=${SUPABASE_URL}/auth/v1`, `exp`.
   - Извлекает `sub` (user_id), `email`, `role`, `app_metadata`, `user_metadata`.
4. Если пользователь не существует в нашей таблице `users` → upsert по `sub` (lazy provisioning).

### Что хранится локально

В нашей `users` таблице — расширение supabase-юзера для бизнес-полей: `plan`, `org_id`, `usage_quota`, `created_at`. Главный ключ `id UUID = supabase_user_id`. Email синхронизируется при логине.

### Sign-up

Frontend сам зовёт Supabase Auth. Если нужны post-signup действия (provision Stripe customer, отправить welcome email) — Supabase webhook → наш endpoint `/api/v1/internal/webhooks/auth`.

### Service-role доступ

Backend для writes в общую БД использует Supabase service-role ключ (DATABASE_URL c service-role паролем). RLS обходится — backend отвечает за авторизацию сам.

### RLS-стратегия

- Таблицы, которые читает фронт напрямую (например `companies` для browse): RLS enabled, `policy: true USING (true)` для public read, или `auth.uid() = ...` для приватных.
- Таблицы, которые читает только backend (`ai_call_log`, `domain_events`, `pages`, `crawl_jobs`): RLS enabled, **нет публичных политик** — фронт не может их достать.
- Таблица `users` extension: RLS, `SELECT WHERE auth.uid() = id`.

## Последствия

**Плюсы**:
- Один auth-flow на всю систему.
- Frontend получает realtime + auth + storage с минимумом кода.
- Backend не несёт ответственности за password storage, email verification, OAuth callbacks.
- Поддержка MFA, social login — из коробки.

**Минусы**:
- Зависимость от Supabase (mitigation: JWT — стандартный формат, при необходимости миграция возможна).
- Невозможно делать backend-initiated session reset без admin-API Supabase (mitigation: для этого есть Supabase Admin SDK с service-role key).
- Refresh-token живёт у Supabase — мы не контролируем TTL (mitigation: согласовать с фронтом политику refresh).

## Когда пересматривать

- Если потребуется кастомный auth (например, SAML SSO для корпоративных клиентов и Supabase Pro не подходит) → возможен переход на собственный сервис типа Ory/Authentik.
- При мульти-тенанте (Phase 4) — оценить Supabase Teams / Organizations.

## Реализация в коде

См. `backend/app/core/security.py` — функция `verify_supabase_jwt(token) -> SupabaseUserClaims`.
См. `backend/app/core/deps.py` — FastAPI dependency `current_user`.
