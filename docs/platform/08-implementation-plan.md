# 08 — План реализации (фазы 1–13 из ТЗ)

Назначение: порядок работ, статус, критерии приёмки и тест-план каждой фазы. Нумерация фаз — как в исходном ТЗ (§28).
Обновлено: 2026-10-06

Процесс (решение владельца): фазы по порядку; после каждой — тесты; коммиты по фазам в `claude/cool-brown-lf74zk`; draft PR в `main`. Проверка БД — на локальном зеркале прод-схемы (`npm run test:db:setup && npm run test:db`); прод из контейнера недоступен, применение миграций — владельцем (⛔ B1 в [README](README.md)).
Статусы: ✅ сделано и проверено тестами · 🔄 в работе · ⬜ план · ⛔ заблокировано внешним действием.

## Сводка

| # | Фаза (ТЗ §28) | Миграции / код | Статус |
|---|---|---|---|
| 0 | Окружение: локальная прод-копия БД, базовая линия тестов | `scripts/test-db/*` | ✅ |
| 1 | Аудит репозитория | `docs/platform/00–09` | ✅ |
| 2 | Архитектура + БД | `083`–`087`, `lib/tenancy` | ✅ код · ⛔ применение в прод |
| 3 | Точка А | `lib/point-a/overview.ts`, движок v1, UI Overview | 🔄 |
| 4 | Метрики | таксономия, каталог, история, `088` | 🔄 |
| 5 | Файлы и обработка документов | `089`, агент `document_intelligence` | ⬜ |
| 6 | Отчёты | `report_versions` (`085`), агент `report` | ⬜ |
| 7 | Инфраструктура агентов | `086`, `lib/agents/*`, `lib/ai/gateway.ts`, Inngest | 🔄 ядро ✅ · агенты v1 ⬜ |
| 8 | Admin Agent Control Center | GIGA «ИИ-агенты» | ⬜ |
| 9 | API / MCP / интеграции | [06](06-integrations.md) | ⬜ |
| 10 | Telegram: уведомления и одобрения | `087` | ⬜ |
| 11 | Безопасность + наблюдаемость | [09](09-security.md), health, логи | ⬜ (P0 ✅ в `083`) |
| 12 | Тестирование | CI, RLS-матрица, E2E | 🔄 (DB-тесты есть, CI нет) |
| 13 | Production hardening | вывод legacy, env, деплой | ⬜ |

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

## Phase 3 — Точка А 🔄
Задачи:
1. Движок v1 на текущие ключи анкеты; проверки, которые анкета не собирает, исключаются из знаменателя; нет баллов за длину текста в числовых критериях.
2. `GET /api/v1/point-a/overview` + `lib/point-a/overview.ts` по контракту `types/point-a-overview.ts`: балл, зрелость, статус диагностики, полнота данных и пробелы, проблемные зоны, ключевые риски, сильные стороны, критические gaps, дата расчёта, число обработанных источников.
3. Компонент Executive Overview (L1) сверху `/point-a`, `/client/point-a`, клиентского `/dashboard`.
4. Удалить фейки: `current_state`-тексты кейс-компании, «5 Потерь», дата «сегодня», бесконечный спиннер, 404 Intelligence без компании; подключить или скрыть мёртвые кнопки инсайтов.

Приёмка: клиент с полной текущей анкетой может набрать ≥85 в каждом блоке, который анкета покрывает; Overview показывает все элементы контракта из реальных строк; ни одна клиентская страница не показывает данные кейс-компании.
Тесты: unit `calculatePointA` (полная / пустая / частичная / старые ключи), `buildPointAOverview` (пустая компания, stale), компонентные тесты состояний Overview.

## Phase 4 — Метрики 🔄
Задачи: `lib/metrics/taxonomy.ts` (13 категорий, 11 целей роста из Metrics.docx), обогащение каталога (категория, описание, метод расчёта, цель, бенчмарк с подписью, delta/тренд из истории, статус, период, дата обновления, provenance), реальные сортировки по динамике, `GET /api/v1/metrics` с реальными данными, прогресс цели по выручке из своей метрики, материализация через service role после авторизации + `088_metrics_provenance_guard.sql` (владелец не пишет `metrics` напрямую).
Приёмка: у каждой метрики категория; фильтры работают на всём наборе; статус «нет цели» без цели; тренд из истории; «главные KPI» показывают значения при наличии данных; провенанс нельзя подделать.
Тесты: unit таксономии (100 %), статус-функции, адаптеров; DB-тест запрета прямой записи `metrics` владельцем.

## Phase 5 — Файлы ⬜
Задачи: `089`: колонки документа (путь, размер, sha256, sniffed MIME, security_status, стадия, попытки, session_id, updated_at), guard `parsed_data`, расширение CHECK `doc_type`; один приватный бакет; серверный finalize (путь под папкой вызывающего, лимит, magic bytes, zip/XML-bomb — обобщить `lib/journey/file-safety.ts`, дедуп по sha256); `FILE_UPLOADED` → агент `document_intelligence` (асинхронно, retry, DLQ, reaper); OCR (растеризация → tesseract) или `needs_ocr`; реальные статусы в UI; удаление каскадом; заменить мёртвую Inngest-функцию `parse-document`.
Приёмка: файл из любого входа доходит до `parsed` / `error` / `needs_ocr`, не зависает; чужой путь отклоняется; «Обработан» — только при извлечённых полях; извлечённые данные попадают в метрики и Точку А.
Тесты: unit preflight (валидные, переименованные, zip-bomb, XML-bomb, PDF со скриптом); DB-тесты finalize и guard; e2e загрузка → статус.

## Phase 6 — Отчёты ⬜
Задачи: агент `report` → `report_versions` (снимок + provenance: агент, модель, промпт-версия, источники, инструменты, run ids, время); PDF из снимка; публикация клиенту после проверки; shared-ссылки на версию; убрать коллизию `diagnostics.ai_analysis`.
Приёмка: опубликованная версия не меняется при изменении данных; в PDF дата, источники и пометка AI-контента.
Тесты: DB-тесты версионирования и RLS (клиент видит только `published`), снапшот рендера.

## Phase 7 — Инфраструктура агентов 🔄
Сделано (✅): `lib/ai/gateway.ts` (уровни моделей, приватность OpenRouter, токены и стоимость, retry, Zod, ограждение недоверенного текста); `lib/agents/*` (права с потолками, инструменты с привязкой к компании, раннер, очередь, одобрения, бюджеты на запуск/агента/компанию/платформу); `lib/events/platform.ts` (outbox + подписки); Inngest `agents-task-requested`, `agents-maintenance`; `/api/cron/agents`; агент `monitoring`; исправлен триггер retention, удалена мёртвая `calculate-gri`. Тесты: 11 DB-сценариев + 16 unit.
Осталось (⬜): агенты v1 — `diagnostic_orchestrator`, `data_collection`, `data_quality`, `metrics`, `diagnostic`, `benchmark`, `recommendation`, `report`, `admin_assistant`; подписки событий; события из живых путей (анкета, документы, диагностика); перевод остальных LLM-вызовов на gateway.
Приёмка: завершение анкеты запускает диагностику до `ready` без ручных шагов; каждая находка с provenance, confidence, evidence; стоимость диагностики видна и в пределах бюджета; документ с инструкциями не меняет набор инструментов агента.

## Phase 8 — Admin Agent Control Center ⬜
Задачи: права `agents.view` / `agents.run` / `agents.manage` / `approvals.decide`; группа «ИИ-агенты» в GIGA; страницы: агенты, задачи, запуски (с tool calls и событиями), ошибки, одобрения, расписания, права, стоимость и токены, производительность, события платформы, здоровье интеграций ([07](07-admin-control-center.md)); API `/api/giga-admin/agents/**` с `requireGiga` + `recordAdminAction`.
Приёмка: роль без права не видит пункт и получает 403; каждая мутация в `admin_audit_log`; выключение агента останавливает новые задачи.

## Phase 9 — API / MCP / интеграции ⬜
Задачи: шифрование токенов CRM (`lib/crypto/secrets.ts`), SSRF-allowlist и без эха ответа апстрима, throttle по лимитам провайдеров, здоровье интеграций, `INTEGRATION_FAILED`; read-only MCP-сервер для персонала (P1); приоритетные интеграции по матрице [06](06-integrations.md).
Приёмка: нет plaintext-токенов; сбой синка виден в админке и в уведомлении; запрос на внутренний адрес отклоняется.

## Phase 10 — Telegram ⬜
Задачи: `notifyAdmins` → `notification_events` + маршрутизация (уровень × канал, тихие часы, дедуп, rate limit); вебхук: секрет обязателен, constant-time, дедуп `update_id`, `callback_query`; привязка Telegram к сотруднику (`staff_telegram_links`, хэш кода + TTL); карточки одобрения (Одобрить / Отклонить) с подписью и сроком; редактирование карточки после решения.
Приёмка: без секрета вебхук отвечает 401; кнопка от непривязанного или неуполномоченного не меняет статус; двойное нажатие — одно решение; INFO по умолчанию не уходит в Telegram.

## Phase 11 — Безопасность + наблюдаемость ⬜
Задачи: оставшиеся P1/P2 из [09](09-security.md) (MFA для API GIGA, legacy `/api/v1/admin/*`, demo-access, секреты cron в query, утечки `error.message`, fallback на anon-ключ); `/api/health` без выдуманных цифр; health агентов, очереди, БД, интеграций; структурные логи без секретов.

## Phase 12 — Тестирование ⬜
Задачи: CI (`tsc`, `lint`, unit, DB-тесты на временном Postgres); RLS-матрица; тесты prompt injection; E2E Playwright: клиент → анкета → файл → обработка → диагностика → метрики → Точка А → отчёт → действия агентов → уведомление.

## Phase 13 — Production hardening ⬜
Задачи: вывод legacy (`/admin`, `/owner`, `/api/admin`, NextAuth, мок `/users`); `assertServerEnv`; дополнить `.env.example`; чек-лист деплоя и применения миграций; нагрузочные проверки очереди.
