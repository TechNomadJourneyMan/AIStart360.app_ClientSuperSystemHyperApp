# docs/platform — аудит и целевая архитектура AIStart360

Назначение: оглавление пакета документов по аудиту платформы и плану перехода к мультиагентной архитектуре.
Обновлено: 2026-10-06

Ветка: `claude/cool-brown-lf74zk`. База аудита: `c0acee0` (merge PR #17). Ход работ и статусы фаз — в [08](08-implementation-plan.md).
Источник фактов: пять отчётов read-only аудита (data layer, Точка А/метрики, файлы/AI/отчёты, админка/уведомления/интеграции, безопасность/тесты/деплой). Ссылки `file:line` взяты из них и выборочно перепроверены по коду.
Архитектурные решения: ответы владельца + решения ведущего инженера (D0–D9). Документы ниже их не пересматривают.

## Состав

| Файл | Что внутри | Статус |
|---|---|---|
| [00-executive-summary.md](00-executive-summary.md) | Что есть, реальное состояние, сильные стороны, критические проблемы | ✅ |
| [01-architecture-map.md](01-architecture-map.md) | Текущая архитектура (ASCII), целевая архитектура, таблица ответственности | ✅ |
| [02-gap-analysis.md](02-gap-analysis.md) | Сводная таблица разрывов (область → проблема → приоритет → решение → фаза) + инвентарь mock/demo/TODO | ✅ |
| [03-database.md](03-database.md) | Модель данных, RLS, schema drift, миграции 083–089, маппинг сущностей | ✅ |
| [04-point-a.md](04-point-a.md) | Как считается Точка А сейчас; целевой Executive Overview (L1) и раздел «Метрики» (L2); provenance | ✅ |
| [05-agents.md](05-agents.md) | Мультиагентная архитектура: агенты, права, жизненный цикл, события, безопасность, наблюдаемость, стоимость | ✅ |
| [06-integrations.md](06-integrations.md) | Интеграции: текущие, матрица для диагностики, MCP, n8n / Paperclip / OpenClaw — вердикты исследования | ✅ |
| [07-admin-control-center.md](07-admin-control-center.md) | Карта GIGA-CRM, legacy-поверхности, раздел «ИИ-агенты», права, Telegram-одобрения | ✅ |
| [08-implementation-plan.md](08-implementation-plan.md) | Фазы 1–13 из ТЗ: задачи, статус, критерии приёмки, тест-план | ✅ |
| [09-security.md](09-security.md) | Риски P0/P1/P2 со статусом, prompt-injection, план тестов изоляции тенантов | ✅ |

## Как читать

1. Руководителю: [00](00-executive-summary.md) → BLOCKED ниже → [08](08-implementation-plan.md).
2. Инженеру БД: [03](03-database.md) → [09](09-security.md) → `scripts/test-db/setup.mjs`.
3. Инженеру AI/агентов: [05](05-agents.md) → [01](01-architecture-map.md) (целевая часть) → [04](04-point-a.md).
4. Продукту: [04](04-point-a.md) → [02](02-gap-analysis.md) → [07](07-admin-control-center.md).

Правила текста:
- «Сейчас» = подтверждено кодом (`путь:строка`). «План» = решение D0–D9, ещё не реализовано.
- «[verify live]» = зависит от настроек прод-проекта Supabase/Vercel, из контейнера не проверяется.
- Приоритет: P0 — эксплуатируемо или ломает данные сейчас; P1 — до запуска агентов; P2 — гигиена.

## Легенда статусов

| Знак | Значение |
|---|---|
| ✅ | сделано (в коде/доках ветки) |
| 🔄 | в работе |
| ⬜ | план |
| ⛔ | BLOCKED — нужен внешний ввод (доступ, ключ, решение владельца) |

## BLOCKED

| # | Что заблокировано | Причина | Нужный ввод | Как разблокировать |
|---|---|---|---|---|
| B1 | Применение миграций 083+ к проду; проверка drift | Прод-БД недоступна из контейнера (сеть/креды). Леджера миграций до 083 не было, состояние прода известно только из комментариев в миграциях | `DIRECT_URL` прод-проекта или исполнение владельцем | Владелец: `node scripts/apply-migration.js supabase/migrations/083_security_hardening.sql`; затем `select * from public.schema_migrations`; сверить `select prosrc from pg_proc where proname='handle_new_user'`, `pg_policies`, `relrowsecurity` для 25 Prisma-таблиц, тип `metrics.company_id`/`documents.user_id` |
| B2 | Подтверждение закрытия P0 (signup → super_admin) | Настройка Supabase Auth «Allow new users to sign up» не хранится в репо | Скриншот/значение настройки + выгрузка профилей с ролью ≠ client/owner | Dashboard → Auth → Providers/Sign-ups. SQL: `select id,email,role,status,created_at from profiles where role not in ('client','owner')` — каждую запись сверить с выдачей через GIGA/`staff_roles` |
| B3 | Живая проверка AI-пути (gateway, usage/cost, агенты) | В контейнере нет `OPENROUTER_API_KEY` и/или исходящего доступа к openrouter.ai | Тестовый ключ OpenRouter с лимитом, разрешённый egress | Ключ в env сессии/preview; прогнать `scripts/ai-smoke.test.ts` через `scripts/vitest.smoke.config.ts`; сверить `usage.cost` с дашбордом OpenRouter |
| B4 | Telegram-уведомления и кнопки Approve/Reject | Нет бота для стенда, секрета вебхука, привязки сотрудников | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (обязателен, fail-closed), список сотрудников для привязки | `setWebhook` с `secret_token`; сотрудник получает код в GIGA → `/start <code>` → строка `staff_telegram_links`; проверить кнопку на тестовом approval |
| B5 | Запуск агентов по событиям/расписанию | Inngest-ключи не подтверждены в проде; 3 из 7 функций сейчас не регистрируют триггер | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (prod + preview) **или** согласие на fallback через Vercel cron | Ключи в Vercel env + sync приложения в Inngest Cloud; иначе `/api/cron/agents` (заголовок `CRON_SECRET`) в `vercel.json` |
| B6 | Приватность хранилища файлов | Флаг public у бакетов `documents`, `user-documents`, `reports` не виден из репо; политики есть только для `client-documents` (015) | Значения `storage.buckets.public` и политики `storage.objects` | SQL: `select id, public, file_size_limit, allowed_mime_types from storage.buckets`. Если `documents` публичный — ссылки на медицинские базы/финансы доступны по URL; закрывается в Phase 5 (один приватный бакет) |
| B7 | Живые CRM-интеграции (Bitrix24/amoCRM и др.) | Нет OAuth-приложений и тестовых порталов; токены сейчас хранятся plaintext | OAuth client id/secret, тестовые аккаунты CRM, `SECRETS_ENCRYPTION_KEY` в проде | Регистрация приложений у провайдеров; после Phase 9 (allowlist хостов + шифрование токенов) — e2e-синк на тестовом портале |

Разблокировка B1 и B2 — обязательна до любых миграций 084+ в проде.

## Связанные файлы вне папки

| Файл | Зачем |
|---|---|
| `supabase/migrations/083_security_hardening.sql` | Закрытие P0/P1 на уровне БД + леджер `schema_migrations` |
| `scripts/test-db/setup.mjs`, `scripts/test-db/supabase-stubs.sql` | Локальное зеркало прод-схемы; правила drift описаны в [03-database.md](03-database.md#2-schema-drift) (комментарий в `setup.mjs` ссылается на старое имя `02-database.md`) |
| `tests/helpers/pg-rls.ts`, `tests/integration/db/security-hardening.test.ts` | Тесты реального RLS под ролями anon/authenticated |
| `docs/AUDIT-2026-09-17-PLATFORM-REDESIGN.md` | Предыдущий аудит (GIGA-CRM, анкета, GRI) |
| `docs/db-ownership.md`, `docs/metrics-data-lineage.md` | Устарели: перечисляют 12 из 74 Supabase-таблиц |
