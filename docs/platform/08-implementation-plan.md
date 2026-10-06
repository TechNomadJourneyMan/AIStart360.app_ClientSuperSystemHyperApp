# 08 — План реализации (фазы 1–13 из ТЗ)

Назначение: порядок работ, статус, критерии приёмки и тест-план каждой фазы. Нумерация фаз — как в исходном ТЗ (§28).
Обновлено: 2026-10-06 (вечер)

Процесс (решение владельца): фазы по порядку; после каждой — тесты; коммиты по фазам в `claude/cool-brown-lf74zk`; draft PR в `main`. Проверка БД — на локальном зеркале прод-схемы (`npm run test:db:setup && npm run test:db`); прод из контейнера недоступен, применение миграций — владельцем (⛔ B1 в [README](README.md)).
Статусы: ✅ сделано и проверено тестами · 🔄 в работе · ⬜ план · ⛔ заблокировано внешним действием.

## Сводка

| # | Фаза (ТЗ §28) | Миграции / код | Статус |
|---|---|---|---|
| 0 | Окружение: локальная прод-копия БД, базовая линия тестов | `scripts/test-db/*` | ✅ |
| 1 | Аудит репозитория | `docs/platform/00–09` | ✅ |
| 2 | Архитектура + БД | `083`–`087`, `lib/tenancy` | ✅ код · ⛔ применение в прод |
| 3 | Точка А | `lib/point-a/overview.ts`, движок v1, Executive Overview | ✅ |
| 4 | Метрики | таксономия (13 категорий), каталог, история, `088` | ✅ |
| 5 | Файлы и обработка документов | `089`, агенты `document_intelligence`, `document_reaper`, загрузчики | ✅ (OCR не проверен вживую — ⛔ B8) |
| 6 | Отчёты | `report_versions` (`085`), `091`, агент `report`, PDF из снимка | ✅ (ссылки на версию — позже) |
| 7 | Агенты: инфраструктура + пайплайн диагностики | `086`, `090`, `lib/agents/*`, `lib/diagnostics/*` | ✅ |
| 8 | Admin Agent Control Center | GIGA «ИИ и автоматизация» | ✅ |
| 9 | API / MCP / интеграции | [06](06-integrations.md), CRM SSRF + шифрование | ✅ (MCP-сервер — позже, P1) |
| 10 | Telegram: уведомления и одобрения | `087` | ✅ код · ⛔ B4 |
| 11 | Безопасность + наблюдаемость | `083`, `092`, [09](09-security.md) | ✅ |
| 12 | Тестирование | CI, DB/RLS, prompt injection, E2E | ✅ (E2E клиентского пути — ⛔ нужен Supabase-стенд) |
| 13 | Production hardening | env, вывод legacy, деплой | 🔄 |

Тестовая база на конец дня: 2559 тестов (unit + DB на зеркале прод-схемы), E2E Control Center 4/4, `tsc` и `lint` — 0 ошибок, CI зелёный на PR.

---

## Phase 0 — окружение ✅
Сделано: `scripts/test-db/setup.mjs` + `supabase-stubs.sql` собирают одноразовую БД из Prisma-схемы и всех `supabase/migrations/*.sql` с явными правилами дрейфа прода (см. [03 «Schema drift»](03-database.md)); `npm run test:db:setup`, `npm run test:db`.
Приёмка: БД собирается без ошибок (одна data-миграция `072_omnichannel_direct_catalog` пропускается — она проверяет прод-строки); 2018 тестов зелёные после установки зависимостей WhatsApp-моста (`npm --prefix services/whatsapp-web-bridge ci`); `tsc` и `lint` — 0 ошибок.

## Phase 1 — аудит ✅
Сделано: 5 отчётов аудита + исследование технологий; документы `00–09`; BLOCKED-таблица в README.
Приёмка: утверждения о коде с `file:line`; решения Use / Do not use / Evaluate later по n8n, Paperclip, OpenClaw, MCP ([06](06-integrations.md)).

## Phase 2 — архитектура + БД ✅ код · ⛔ прод
Сделано:
1. `083_security_hardening.sql` — P0: триггер регистрации доверял `role` из пользовательских метаданных (самоназначение super_admin); guard колонок `profiles` (`tier`, `feature_flags`, `role`, `status`, `approved_*`, привязка Telegram); RLS + REVOKE на 25 Prisma-таблицах; view без обхода RLS; журнал `schema_migrations` (+ запись из `apply-migration.js`).
2. `084_tenancy_partners_members.sql` — партнёры (`partner_organizations`, `partner_members`), `companies.partner_id`, `company_members` (+ backfill и синхронизация владельца), хелперы `can_read_company` / `can_manage_company` / `accessible_company_ids`, аддитивные SELECT-политики на данные компании.
3. `085_diagnostics_provenance_reports.sql` — `diagnostic_sessions`, `diagnostic_findings`, `diagnostic_recommendations` (provenance FACT / CALCULATED / INFERRED / AI_HYPOTHESIS / RECOMMENDATION, confidence, evidence), `metric_value_history` (триггер), `metric_targets`, `report_versions`.
4. `086_agents_runtime.sql` — конфиги, права, очередь задач (lease, backoff, dead-letter), запуски, вызовы инструментов, одобрения, журнал агентов, outbox `platform_events`.
5. `087_notifications_telegram_approvals.sql` — `notification_events` (уровни), `notification_deliveries`, `staff_telegram_links`, `telegram_updates_seen`.
6. `lib/tenancy` — единый резолвер компании и роли для API (с откатом на правило «один владелец», пока `084` не применена).

Приёмка (проверено): регистрация со «своей» staff-ролью → `client/pending_approval`; клиент не меняет тариф и флаги; anon не читает Prisma-таблицы; участник A не видит B; партнёр видит только свои компании и теряет доступ при приостановке; неподтверждённый эксперт не получает доступ; AI-гипотеза не может быть видна клиенту без ревью; очередь: claim/retry/dead/reaper/expiry.
Тесты: `tests/integration/db/{security-hardening,tenant-isolation,diagnostics-agents-schema}.test.ts` (35 кейсов, реальные RLS), `tests/unit/tenancy`.
⛔ Прод: применить `083`–`087` по порядку; проверить настройку регистрации в Supabase Auth и профили с повышенными ролями (B1, B2).

## Phase 3 — Точка А ✅
Сделано: движок v1 пересобран на текущие ключи анкеты (баллы = заработано / возможно, проверки без источника вне знаменателя, без баллов за пропуски и длину текста); значения из документов/CRM используются раньше анкеты; `GET /api/v1/point-a/overview` + `lib/point-a/overview.ts` (балл, зрелость, статус, полнота и пробелы, проблемные зоны, риски/сильные стороны/критические gaps с provenance, дата расчёта, источники); Executive Overview на `/point-a`, `/client/point-a`, клиентском `/dashboard`; убраны тексты кейс-компании, фейковые «5 Потерь», дата «сегодня», бесконечный спиннер.
Приёмка (проверено тестами): полная анкета даёт 100 в каждом блоке; Overview строится только из строк компании; скрытые гипотезы ИИ не попадают клиенту.
Тесты: `tests/unit/point-a/{engine-rebase,overview,resolved-inputs,aggregator}.test.ts`.

## Phase 4 — Метрики ✅
Сделано: `lib/metrics/taxonomy.ts` (13 категорий, цели роста как подкатегории; реестр 148 метрик, у каждой ровно одна категория), обогащение каталога (описание, метод, цель, ориентир с подписью, delta/тренд из истории, статус, provenance), `GET /api/v1/metrics` на реальных данных, прогресс цели по выручке; запись метрик только сервером после проверки тенанта + `088` (клиент не может подделать значение/источник/provenance); графики, прогноз и аномалии читают `metric_value_history`; тест запрещает фильтры по несуществующим ключам метрик.
Тесты: `tests/unit/metrics/*`, `tests/integration/db/metrics-provenance-guard.test.ts`.

## Phase 5 — Файлы ✅
Сделано: `089` (путь, размер, sha256, sniffed MIME, security_status, стадия, попытки, задача-владелец, guard `parsed_data`, дедуп, приватный бакет `client-documents`); серверный finalize `POST /api/v1/documents` (папка вызывающего, лимит 25 МБ, magic bytes, zip/XML-bomb, макросы, скрипты в PDF); агент `document_intelligence` (текст по форматам, извлечение через бюджетный вызов модели, проверка цитат — непроверенные значения не идут в метрики, provenance страница/лист/слайд, явный «прочитан, данных нет»); `document_reaper` (зависшие > 30 мин); все клиентские загрузчики на новом контракте с реальными статусами; ссылки персонала — подписанные.
⛔ B8: OCR сканов выключен по умолчанию — языковые данные tesseract качаются с CDN, из контейнера недоступно; без него — статус `needs_ocr` с объяснением.
Тесты: `tests/unit/documents/*`, `tests/integration/db/documents-pipeline.test.ts` (12 сценариев, в т.ч. изоляция компаний).

## Phase 6 — Отчёты ✅
Сделано: агент `report` (по `DIAGNOSTIC_COMPLETED` или вручную) создаёт замороженную версию `report_versions`. В снимке баллы, риски правил, видимые клиенту выводы и рекомендации; у каждого пункта provenance, confidence, источник и evidence. Непроверенные гипотезы ИИ в снимок не попадают. `data_hash` без даты генерации, поэтому те же данные не создают новую версию. Агент пишет только статус `ready`; публикует, отклоняет и отзывает только сотрудник (право `reports.publish`, аудит обязателен). PDF строится только из снимка, с пометками происхождения. Очередь «Проверка выводов ИИ» (право `insights.moderate`): одобрить, чтобы показать клиенту, или отклонить. Клиент видит опубликованные версии на `/point-a`. Нарратив модели выключен по умолчанию (premium, $1, числа сверяются с данными). Коллизия `diagnostics.ai_analysis` устранена: `091`, отдельная колонка нарратива, анализ сливается без потери ключей. Исправлен футер PDF: раньше каждая страница давала лишнюю пустую.
Осталось: ссылки «поделиться» на конкретную версию; живой вызов модели для нарратива (⛔ B3).
Тесты: `tests/integration/db/{report-agent,diagnostics-ai-narrative}.test.ts`, `tests/unit/reports/*`, `tests/unit/api/{reports-routes,ai-analysis-routes}.test.ts`.

## Phase 7 — Агенты ✅
Сделано: рантайм (`086`: очередь с lease/backoff/dead-letter, права с потолками, инструменты с привязкой к компании, одобрения, бюджеты запуск/агент/компания/платформа, outbox событий, Inngest + cron-fallback); шлюз моделей (3 уровня, приватность провайдера, стоимость из usage, ограждение недоверенного текста). Пайплайн диагностики (`090`, [05 §2.1](05-agents.md)): `diagnostic_orchestrator` → `data_collection` → `metrics` → `data_quality` → `benchmark` → `diagnostic` → `recommendation` → финализация (снимок Overview, `DIAGNOSTIC_COMPLETED`); запуск от анкеты, обработанного документа, ручного пересчёта; одна активная сессия на компанию; модель — только при новых данных и в бюджете; гипотезы ИИ скрыты до проверки. Все остальные вызовы модели (11 мест) получили приватность провайдера, дневной лимит платформы и учёт стоимости (`093`).
Приёмка (проверено DB-тестами): анкета → сессия `ready` без ручных шагов; у каждого вывода provenance, confidence, evidence; повтор на тех же данных не вызывает модель; упавший этап закрывает сессию; документ с «инструкциями» не меняет инструменты агента.
Тесты: `tests/integration/db/{agent-runtime,diagnostic-pipeline,ai-usage-ledger}.test.ts`, `tests/unit/diagnostics/*`, `tests/unit/agents/*`.

## Phase 8 — Admin Agent Control Center ✅
Сделано: права `agents.view` / `agents.run` / `agents.manage` / `approvals.decide`; группа «ИИ и автоматизация» в GIGA: агенты (вкл./выкл., запуск), страница агента (инструменты, матрица прав с потолками, настройки, расписание), задачи и запуски (tool calls, журнал, отмена/повтор), одобрения (история: кто, где, почему), стоимость, события платформы, уведомления + привязка Telegram; здоровье агентов и CRM в «Система». Все мутации — `requireGiga` + аудит.
Тесты: `tests/unit/giga-crm/{agents-ui-model,giga-nav-agents,agents-route-permissions}.test.ts`, `tests/integration/db/agents-admin.test.ts`, E2E `tests/e2e/giga-agents.spec.ts`.

## Phase 9 — API / MCP / интеграции ✅
Сделано: исследование и матрица ([06](06-integrations.md)): n8n — позже, Paperclip/OpenClaw — не используем, MCP — read-only сервер для персонала (P1); CRM: SSRF-allowlist (только облачные домены провайдеров или явно разрешённые, только публичные IP, https), шифрование токенов (`SECRETS_ENCRYPTION_KEY`, скрипт миграции старых), без эха ответа апстрима, `INTEGRATION_FAILED`.
Осталось: MCP-сервер (P1, после решения по OAuth), OAuth-приложения CRM (⛔ B7).

## Phase 10 — Telegram ✅ код · ⛔ B4
Сделано: уровни INFO/SUCCESS/WARNING/CRITICAL/APPROVAL_REQUIRED, маршрутизация по каналам, тихие часы, дедуп и cooldown; вебхук (секрет обязателен, constant-time, дедуп `update_id`); привязка сотрудника кодом (хэш, 15 мин); кнопки «Одобрить / Отклонить» с HMAC-подписью, проверкой права и редактированием карточки после решения.
Тесты: `tests/integration/db/notifications-telegram.test.ts`, unit-тесты уровней и подписи.

## Phase 11 — Безопасность + наблюдаемость ✅
Сделано: P0 (`083`); legacy `/api/v1/admin/*` по статусу и рангу; демо-доступ по политике регистрации; секреты cron только в заголовке; честный `/api/health`; второй фактор обязателен для API персонала (GIGA и legacy), флаги 2FA перенесены в `app_metadata`, который пользователь не может менять (`092`); 22 fallback-а на anon-ключ убраны (fail closed); ~40 ответов больше не отдают тексты ошибок Postgres/Supabase; персональные данные не уходят в модели (`lib/ai/pii.ts`); health агентов, очереди, документов, CRM.
Тесты: `tests/unit/giga-actor.test.ts`, `tests/unit/admin/legacy-admin-guard.test.ts`, `tests/integration/db/{security-hardening,tenant-isolation,mfa-flags}.test.ts`, `tests/unit/security/prompt-injection.test.ts`.

## Phase 12 — Тестирование ✅
Сделано: CI на каждый PR (`tsc`, `lint`, сборка зеркала прод-схемы со всеми миграциями на pgvector, весь Vitest вместе с DB/RLS-тестами); RLS и изоляция тенантов на реальных политиках; prompt injection (ограждение, валидация ответа модели, привязка доказательств); E2E Playwright Control Center на реальной БД.
⛔ E2E полного клиентского пути (регистрация → анкета → файл → диагностика → отчёт) требует стенда Supabase (Auth + Storage): локально нет GoTrue/Storage. Части пути покрыты DB-тестами пайплайнов.

## Phase 13 — Production hardening 🔄
Сделано: `.env.example` дополнен всеми новыми переменными; Control Center показывает конфигурацию; очередь берёт только задачи агентов, известных деплою (безопасный rolling deploy).
Решение: `assertServerEnv` не роняет сервер на старте (это положило бы весь портал из-за одной переменной) — отсутствие критичных переменных видно в `/api/health` и GIGA → Система.
Осталось: вывод legacy-поверхностей (`/admin`, `/owner`, NextAuth, мок `/users`) — только после проверки, что ими никто не пользуется (решение владельца); чек-лист деплоя миграций 083–093 (B1).

