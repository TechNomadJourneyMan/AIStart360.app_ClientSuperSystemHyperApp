# docs/platform — аудит и целевая архитектура AIStart360

Назначение: оглавление пакета документов по аудиту платформы и плану перехода к мультиагентной архитектуре.
Обновлено: 2026-10-06 (вечер, после зачистки фейковых данных)

Ветка: `claude/cool-brown-lf74zk`. База аудита: `c0acee0` (merge PR #17). Ход работ и статусы фаз — в [08](08-implementation-plan.md).
Источник фактов: пять отчётов read-only аудита (data layer, Точка А/метрики, файлы/AI/отчёты, админка/уведомления/интеграции, безопасность/тесты/деплой). Ссылки `file:line` взяты из них и выборочно перепроверены по коду.
Архитектурные решения: ответы владельца + решения ведущего инженера (D0–D9). Документы ниже их не пересматривают.

## Состав

| Файл | Что внутри | Статус |
|---|---|---|
| [00-executive-summary.md](00-executive-summary.md) | Что есть, реальное состояние, сильные стороны, критические проблемы | ✅ |
| [01-architecture-map.md](01-architecture-map.md) | Текущая архитектура (ASCII), целевая архитектура, таблица ответственности | ✅ |
| [02-gap-analysis.md](02-gap-analysis.md) | Сводная таблица разрывов (область → проблема → приоритет → решение → фаза) + инвентарь mock/demo/TODO | ✅ |
| [03-database.md](03-database.md) | Модель данных, RLS, schema drift, миграции 083–098, маппинг сущностей | ✅ |
| [04-point-a.md](04-point-a.md) | Как считается Точка А сейчас; целевой Executive Overview (L1) и раздел «Метрики» (L2); provenance | ✅ |
| [05-agents.md](05-agents.md) | Мультиагентная архитектура: агенты, права, жизненный цикл, события, безопасность, наблюдаемость, стоимость | ✅ |
| [06-integrations.md](06-integrations.md) | Интеграции: текущие, матрица для диагностики, MCP, n8n / Paperclip / OpenClaw — вердикты исследования | ✅ |
| [07-admin-control-center.md](07-admin-control-center.md) | Карта GIGA-CRM, legacy-поверхности, раздел «ИИ-агенты», права, Telegram-одобрения | ✅ |
| [08-implementation-plan.md](08-implementation-plan.md) | Фазы 1–13 из ТЗ: задачи, статус, критерии приёмки, тест-план | ✅ |
| [09-security.md](09-security.md) | Риски P0/P1/P2 со статусом, prompt-injection, план тестов изоляции тенантов | ✅ |
| [10-bot-and-credentials.md](10-bot-and-credentials.md) | Инструкция владельца: запуск админ-бота и бота экспертов, добавление/замена/удаление ключей ИИ-провайдеров, маршруты, OCR, бюджеты | ✅ |

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
| B1 | Применение миграций 083–098 к проду; проверка drift | Прод-БД недоступна из контейнера (сеть/креды). Леджера миграций до 083 не было, состояние прода известно только из комментариев в миграциях | `DIRECT_URL` прод-проекта или исполнение владельцем | Владелец: по порядку `node scripts/apply-migration.js supabase/migrations/08N_….sql` для 083…098; затем `select * from public.schema_migrations`. До применения `088` нельзя выкатывать код старше этой ветки (старый код пишет метрики через сессию пользователя); `092` переносит флаги 2FA в `app_metadata`; `096` закрывает запись чужого `company_id` — применять вместе с кодом ветки (recalculate пишет диагностику сервисной ролью). Репетиция на локальной копии: 083–098 применены этим инструментом по порядку и повторно, без ошибок (2026-10-06) |
| B2 | Подтверждение закрытия P0 (signup → super_admin) | Настройка Supabase Auth «Allow new users to sign up» не хранится в репо | Скриншот/значение настройки + выгрузка профилей с ролью ≠ client/owner (с W1 `owner` = клиент; регистрация его больше не выдаёт) | Dashboard → Auth → Providers/Sign-ups. SQL: `select id,email,role,status,created_at from profiles where role <> 'client' and id not in (select user_id from staff_roles)` — каждую запись сверить с выдачей через GIGA |
| B3 | Живая проверка AI-пути (gateway, usage/cost, агенты диагностики, извлечение из документов) | В контейнере нет `OPENROUTER_API_KEY` и исходящего доступа к openrouter.ai; всё проверено на заглушке ответа | Тестовый ключ OpenRouter с лимитом, разрешённый egress | Ключ в env preview; запустить диагностику в GIGA → «ИИ-агенты» → «Оркестратор диагностики» → «Запустить»; сверить стоимость в «Стоимость ИИ» с дашбордом OpenRouter |
| B4 | Telegram: бот-панель администратора, бот экспертов, уведомления и кнопки Approve/Reject | Нет ботов для стенда/прода в env, вебхуки не зарегистрированы, сотрудники и эксперты не привязаны; живые вызовы Bot API из контейнера не проверены (нет сети) | Админ-бот: `TELEGRAM_ADMIN_BOT_TOKEN`, `TELEGRAM_ADMIN_BOT_USERNAME` (`Command_panel_aistart360_bot`), `TELEGRAM_ADMIN_WEBHOOK_SECRET`; бот экспертов: `TELEGRAM_EXPERT_BOT_TOKEN`, `TELEGRAM_EXPERT_BOT_USERNAME` (`aist360notificationbot`), `TELEGRAM_EXPERT_WEBHOOK_SECRET`; клиентский бот как раньше: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`. Секреты обязательны (fail-closed: без секрета вебхук отвечает 503). Для ключей ИИ в 🔑 — `SECRETS_ENCRYPTION_KEY`. Миграция `095_telegram_bot_state.sql` | 1) env в Vercel (prod; для preview — только если Deployment Protection отключена или есть bypass: защищённый preview отвечает Telegram 401 и апдейты не доходят); 2) `node scripts/apply-migration.js supabase/migrations/095_telegram_bot_state.sql`; 3) `npx tsx scripts/telegram/set-webhooks.ts https://<прод-домен>` (setWebhook с `secret_token`, `setMyCommands` по-русски, `getWebhookInfo`; `--bots admin`, `--info`); 4) сотрудник: GIGA → «Уведомления» → «Привязать Telegram» → ссылка ведёт в админ-бота (уже привязанным — один раз нажать «Start» в админ-боте); эксперт: кабинет → «Мой профиль» → «Привязать Telegram»; 5) проверить: «📊 Статус», кнопку одобрения на тестовом запросе, добавление ключа в 🔑 (сообщение с ключом удаляется), уведомление эксперту о завершённой диагностике. Меню ↔ права: [07 §7](07-admin-control-center.md#7-telegram-боты-панель-администратора-и-бот-экспертов) |
| B5 | Запуск агентов по событиям/расписанию в проде | Inngest-ключи не подтверждены; Vercel cron в проекте только ежедневный | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (prod + preview) **или** внешний планировщик раз в минуту | Ключи в Vercel env + sync в Inngest Cloud (функции `agents-task-requested`, `agents-maintenance`). Без них задачи всё равно стартуют в фоне запроса, а «добор» — через `GET /api/cron/agents` с `Authorization: Bearer $CRON_SECRET` |
| B6 | Приватность старых бакетов | Новые загрузки идут в приватный `client-documents` (`089`). Старые файлы в `documents` / `user-documents` и вложения анкеты (шаги 1 и 6) остаются там, где были; флаг public у этих бакетов из репо не виден | Значения `storage.buckets.public` | SQL: `select id, public from storage.buckets`. Если `documents` публичный — решение владельца: закрыть бакет (ссылки станут подписанными) и/или перенести вложения анкеты на новый контракт |
| B7 | Живые CRM-интеграции (Bitrix24/amoCRM) | Нет OAuth-приложений и тестовых порталов | OAuth client id/secret, тестовые аккаунты, `SECRETS_ENCRYPTION_KEY` в проде | Регистрация приложений у провайдеров; затем `npx tsx scripts/encrypt-crm-tokens.ts --apply` для старых токенов и e2e-синк на тестовом портале |
| B8 | OCR сканов: живая проверка на Vercel; удалённый движок | Локальный OCR работает офлайн и включён по умолчанию: языковые данные — npm-пакеты `@tesseract.js-data/{rus,eng,kaz}` (LSTM `4.0.0_best_int`, ~7,6 МБ), CDN не нужен; файлы tesseract/pdf-parse/@napi-rs/canvas трассируются в функции агента (`next.config.mjs`). Не проверено на самом Vercel: размер функции (+~50 МБ трассы) и время на страницу. Удалённый движок (DeepSeek OCR через Alem Plus) — только слот `registerRemoteOcr()`, не подключён | Preview-деплой; ключ/маршрут Alem Plus в роутере провайдеров | Локально: `npm run ocr:check`, `npm run ocr:file -- scan.pdf`. На preview: загрузить скан PDF → `parsed_data.source.ocr` (`label` «OCR (tesseract)», `page_details`, `partial`), confidence полей ≤ 0.7. Выключить: `DOCUMENT_OCR_ENABLED=false` → `needs_ocr`. Удалённый: `registerRemoteOcr(fn)` + `DOCUMENT_OCR_ENGINE=auto\|remote`; сбой страницы → локальный tesseract |
| B9 | E2E полного клиентского пути | Нужен стенд Supabase (Auth + Storage), локально его нет | Preview-проект Supabase с тестовым пользователем | Прогнать регистрацию → анкету → загрузку → диагностику → отчёт на preview; Control Center покрыт `tests/e2e/giga-agents.spec.ts` / `giga-providers.spec.ts` (вход через тестовый шов: `E2E_DATABASE_URL` + `E2E_AUTH_SEAM_SECRET` ≥32 символов, только `next dev`) |
| B10 | Вход в GIGA без аварийного пароля (W1) | Break-glass удалён: если личный вход владельца не работает, в панель не попасть никому | Владелец: войти `technomadjourneyman@gmail.com` на preview | До выкатки кода W1 в прод: применить **099** (NOTICE покажет, найден ли аккаунт, прочих super_admin, legacy-`admin` без доступа и число legacy-`owner`), затем `/login?from=/admin-giga-panel` → пароль/ссылка → `/2fa` → панель; проверить «Выйти». Env: `GIGA_ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID/SECRET`, `WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING` удалить из Vercel; `GIGA_COOKIE_SECRET`/`AUTH_SECRET` оставить (подпись staff-cookie, MFA, «от имени»); `E2E_AUTH_SEAM_SECRET` в Vercel не задавать |

Разблокировка B1 и B2 — обязательна до любых миграций 084+ в проде.

## Связанные файлы вне папки

| Файл | Зачем |
|---|---|
| `supabase/migrations/083_security_hardening.sql` | Закрытие P0/P1 на уровне БД + леджер `schema_migrations` |
| `supabase/migrations/099_owner_super_admin.sql`, `tests/integration/db/owner-super-admin.test.ts` | super_admin владельца, отчёт о прочих super_admin, `staff_roles` для legacy-admin, регистрация без `owner` (W1) |
| `scripts/test-db/setup.mjs`, `scripts/test-db/supabase-stubs.sql` | Локальное зеркало прод-схемы; правила drift описаны в [03-database.md](03-database.md#2-schema-drift) (комментарий в `setup.mjs` ссылается на старое имя `02-database.md`) |
| `tests/helpers/pg-rls.ts`, `tests/integration/db/security-hardening.test.ts` | Тесты реального RLS под ролями anon/authenticated |
| `docs/AUDIT-2026-09-17-PLATFORM-REDESIGN.md` | Предыдущий аудит (GIGA-CRM, анкета, GRI) |
| `docs/db-ownership.md`, `docs/metrics-data-lineage.md` | Устарели: перечисляют 12 из 74 Supabase-таблиц |
