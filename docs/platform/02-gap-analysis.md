# 02 — Gap analysis

Назначение: единая таблица разрывов между текущим кодом и целевой платформой, с приоритетом, решением и фазой; плюс инвентарь mock/demo/TODO.
Обновлено: 2026-10-06

Приоритеты: **P0** — эксплуатируемо или ломает данные клиентов сейчас; **P1** — обязательно до запуска агентов; **P2** — гигиена/долг.
Фазы — по [08-implementation-plan.md](08-implementation-plan.md). Безопасность подробно — [09-security.md](09-security.md).

## 1. Сводная таблица

| Область | Текущее состояние | Проблема | Приор. | Решение | Фаза |
|---|---|---|---|---|---|
| Auth (AuthN) | Supabase Auth — единственный живой источник (`lib/current-user.ts:3-11`); NextAuth смонтирован (`app/api/auth/[...nextauth]`), 8 маршрутов на нём | P0 signup-эскалация (`002:13-20`); MFA только для страниц (`verifyStepUp` 0 вызовов); `demo-access` выдаёт одобренные аккаунты без auth; NextAuth Google-хендлер жив | P0 / P1 | 083 (✅ код, ⛔ прод); MFA step-up в `requireGiga` для мутаций; demo-access под `registration_mode` + cron очистки; удалить NextAuth | 2, 13 |
| RBAC | 4 системы ролей: `profiles.role`, `staff_roles` (GIGA, 7×32), Prisma `UserRole`, ad-hoc наборы (`lib/api-identity.ts:12`, `lib/expert-auth.ts:9`) | Legacy `/api/v1/admin/*` без проверки статуса/ранга: admin может заблокировать super_admin (`approve-user/route.ts:16-30`); analyst пишет чужие анкеты через `api-identity`; эксперт видит всех клиентов | P1 | GIGA RBAC — канон; SQL-хелперы `is_platform_staff()`, `can_read_company()`; legacy-API → 410/редирект; эксперт ограничен через членство/партнёра | 2, 13 |
| Тенантность | Тенант = auth-пользователь; `companies` 1:1 (`013:21-23`); `profiles.organization` — свободный текст; Prisma `organizations` — legacy | Нет команд, мульти-доступа, партнёров/агентств | P1 | 084: `partner_organizations`, `partner_members`, `companies.partner_id`, `company_members` + backfill owner; аддитивные SELECT-политики | 2 |
| БД / миграции | 86 файлов + 083; Prisma без истории; применение вручную `scripts/apply-migration.js` | Дубли номеров (035, 036, 069×3, 070×3, 071, 072, 073); 001/004/009/010 не перезапускаемы; drift (TEXT vs UUID, фантомный триггер 077, нет DDL `report_documents`/`crm_integrations`) | P1 | ✅ леджер `schema_migrations` (083); ✅ локальное зеркало + drift-правила (`scripts/test-db/setup.mjs`); уникальные номера с 084; CI собирает тестовую БД | 0, 2, 13 |
| Онбординг | 12 шагов, автосейв, история, прогресс по 174 ключам (`lib/survey/steps.ts`) | Нет события завершения как триггера пайплайна; балл не пересчитывается при сохранении шага; e-com/medical интейки не оцениваются | P2 | `emitPlatformEvent(ONBOARDING_COMPLETED / QUESTIONNAIRE_COMPLETED)` → orchestrator | 7 |
| Анкета → данные | Резолвер берёт ответ целиком (`source-adapters.ts:109-140`) | Строка с «%» → null; табличные ответы (`s8n_metrics_table`) → null; текст с цифрами → склейка цифр | P1 | Типизированные парсеры по ключам, разбор таблиц, единицы; тесты на `coerceNumeric` | 4 |
| Тесты / GRI | GRI 67 критериев, версии, TOP-5, план 90 дней — REAL | AI-вкладка при прямом заходе шлёт `DEFAULT_SCORES` (`GriPageShell.tsx:45,148-152`); у экспертов фейковые баллы GRI (`expert/clients/[id]/gri/route.ts:21,29`); mini-GRI не привязывается; GRI не влияет на Точку А; `computeDataConfidence` мёртв | P1 | Сидировать из `gri_assessments` до рендера AI-вкладки; пусто → empty state; GRI как источник Overview; привязка mini-GRI по email | 3 |
| Балл Точки А | v1 `calculatePointA`, только анкета (`lib/point-a-engine.ts:544-579`) | 7 legacy-ключей недоступны в анкете → смещение у всех клиентов; баллы за длину текста (`:301`, `:334`); `data_gaps` просит невозможное (`:480`) | P0 | Перевести на текущие ключи, сохранить 5 блоков, кормить метриками где есть (D9); удалить проверки длины текста | 3 |
| Executive Overview | Отсутствует как компонент; на `/point-a` и `/dashboard` нет балла; стадия и `data_gaps` не выводятся | Клиент не видит итог; `/client/point-a` показывает сегодняшнюю дату вместо даты расчёта | P1 | L1-компонент по D9 (балл, стадия, зоны, риски, сильные стороны, пробелы, полнота, дата, источники) | 3 |
| Каталог метрик | 126 метрик в коде (`registry.ts`; комментарии говорят «122»); KPI-неймспейс под FMCG-кейс | 67 фейковых `current_state`; нет категорий Автоматизация / AI-зрелость / Digital / Управление | P0 (фейки) / P1 | Удалить `current_state` из UI; файл таксономии метрика→категория (13 категорий); бенчмарки в коде с источником | 3, 4 |
| История метрик | `public.metrics` upsert по 7-колоночному ключу (080) | Значения перезаписываются; timeseries фильтрует по `recorded_at`, который upsert не обновляет → ≈1 точка | P1 | 085: `metric_value_history` (AFTER INSERT/UPDATE trigger при изменении значения); периодизация | 2, 4 |
| API метрик | `GET /api/v1/metrics` → всегда `[]` (`route.ts:35-37`); catalog — реальный | KeyMetricsHero пуст; GrowthSnapshotHero ждёт другую форму ответа; `/[id]/goals` знает только `revenue`; trend-сортировки — TODO | P1 | Реализовать `/api/v1/metrics` поверх `metrics` + history + targets; delta/trend в catalog | 4 |
| Цели и статус метрик | Цели только `companies.target_revenue_12m/3y_kzt` | MetricZonesGrid: любое значение = «зелёная зона» (`MetricZonesGrid.tsx:82-103`) | P1 | 085: `metric_targets`; статус = f(value, target, benchmark); без цели — «нет цели», не «зелёный» | 2, 4 |
| Загрузка файлов | 6 клиентских путей, 4 бакета + локальный диск (`app/actions/reports.ts:86-95`) | Нет серверной проверки размера/MIME/magic bytes; `file_url` не проверяет владельца (`lib/upload-url.ts:29-36`); публичные URL; signed URL на 1 год в БД; `doc_type` из FileArea не проходит CHECK | P1 | 088: серверный finalize, один приватный бакет, путь под папкой вызывающего, лимит, sniff, zip/XML-bomb (обобщить `lib/journey/file-safety.ts`), sha256-дедуп | 5 |
| Обработка файлов | Inline-запрос до 300 c; Inngest `parse-document` без триггера | B/C висят в `queued`; `processing` не сбрасывается; staff-rebind через user-клиент → 0 строк, `ok:true`; полный текст отбрасывается (2500 символов) | P1 | `FILE_UPLOADED` → задача `document_intelligence` (async, retry, DLQ, reaper); стадии в `processing_stage`; UI показывает реальный статус | 5 |
| OCR | `lib/documents/ocr.ts` есть, `ocrPdfBuffer` не вызывается; передаёт PDF в tesseract без растеризации | Сканы → пустой текст и статус `parsed` | P2 | Растеризация → tesseract, если выполнимо на Vercel; иначе статус `needs_ocr` (D6) | 5 |
| Embeddings / RAG | Prisma `DocumentSummary.clientId` NOT NULL → путь не выполняется (`process/route.ts:115-119`); 0 чанков (`054:4-8`) | Чат по отчётам без документов; дубликаты summary при переобработке; нет удаления | P2 | Решение после Phase 5: `clientId` nullable + `user_id/company_id`, эмбеддинг как стадия `document_intelligence`, каскадное удаление | 8 (опц.) |
| Отчёты | PDF на лету (`app/api/export/report/route.ts`), не сохраняется; shared-ссылка → живые данные | Нет версий и provenance; `diagnostics.ai_analysis` пишут два разных формата (коллизия); Reports Hub пишет на диск Vercel | P1 | 085/088: `report_versions` (снимок + provenance), shared-ссылка на версию; агент `report`; удалить Reports Hub-запись на диск | 6 |
| AI gateway / стоимость | `chatWithOpenRouter` и `generateObjectViaOpenRouter`; модели вперемешку (Opus 4.8, GPT-4o, Gemini raw fetch) | `usage` отбрасывается; токены/стоимость не пишутся; нет дневных бюджетов; Langfuse только в мёртвом коде; нет ретраев транспорта | P1 | `lib/ai/gateway.ts`: tier→модель, `usage.cost`, бюджеты (run/агент/компания/платформа), редакция; перевести все вызовы | 7 |
| Агенты | Нет. Есть агенто-подобные: ассистент «Гри», omnichannel-ответчик, генератор инсайтов, персоны | Нет реестра, задач, запусков, tool calls, прав, одобрений | P1 | 086 + `lib/agents/*` по D3 | 7 |
| Admin Control Center | GIGA-CRM канонический; нет раздела агентов; дубли `/admin`, `/owner`, `/api/admin`, `/api/v1/admin` | Наблюдать и управлять AI нечем; 3 бэкенда одобрения заявок с разными guard-ами | P1 / P2 | Группа «ИИ-агенты» в GIGA (D8); legacy — вывести | 8, 13 |
| Уведомления | `app_notifications` (лента клиента), `notifyAdmins` (email + Telegram env) | Нет уровней; админские не сохраняются; дедуп в памяти; нет ленты персонала; `user_registered` не срабатывает | P1 | 087: `notification_events` (5 уровней), `notification_deliveries`, маршрутизация уровень×канал, антиспам | 10 |
| Telegram | Бот: только `/start <code>`; userbot (MTProto) раз в сутки | Секрет вебхука опционален, `!==`; нет `update_id`-дедупа; код привязки 48 бит без TTL в plaintext; нет callback-кнопок; chat id админов — строки env без связи с персоналом | P1 | Секрет обязателен, constant-time, дедуп; `staff_telegram_links` (хэш кода + TTL); callback с HMAC + срок + право + аудит | 10 |
| События / фон | 3 рантайма (Inngest, Vercel Workflow, DB-очередь); 3 из 7 Inngest-функций мертвы | Нет шины событий; side-effects вызываются напрямую из маршрутов | P1 | `platform_events` outbox + Inngest; исправить/удалить мёртвые функции; fallback `/api/cron/agents` | 7 |
| Интеграции | CRM Bitrix24/amoCRM: ручной синк; омниканал/MyHonor/Kaspi — реальны; 19–20 e-com адаптеров и 4 эквайринга — заглушки | SSRF с отражением 200 байт (`lib/crm/bitrix24.ts:24-33`, `amocrm.ts:21-23`); токены plaintext (`046:16`); health проверяет не ту переменную Sheets | P1 | Allowlist хостов CRM, без эха ответа; шифрование через `lib/crypto/secrets.ts`; health по интеграциям; n8n — опц. | 2 (SSRF), 12 |
| Вебхуки | Meta/WA-bridge/Kaspi/MyHonor — сильные (HMAC, constant-time, fail-closed) | Telegram fail-open; cron принимает `?secret=` и сравнивает `===` (`crm-digest/route.ts:106-108`) | P2 | Шаблон Meta для Telegram; секрет только в заголовке, constant-time | 10, 13 |
| Наблюдаемость / health | `/api/giga-admin/system/health` — проверки env/таблиц/бакетов; публичный `/api/health` | `/api/health` выдаёт выдуманный uptime (`route.ts:21,53-54`) и имена отсутствующих env; логи только `console.*`; нет здоровья интеграций | P2 | Убрать фейки из `/api/health` (или закрыть); агент `monitoring` (cron 15 мин); страница «Интеграции/здоровье» | 7, 8, 13 |
| Права на данные (RLS) | 083 закрыл Prisma-таблицы и view | Клиент может подделать `metrics.source/confidence/provenance`, `parsed_data`, тип инсайта, `gri_index`, `market_analysis_answers.status` (R5); `diagnostics` без UPDATE-политики → тихие no-op (R8); `point_b_versions` без фильтра `is_approved` | P1 | Guard-триггеры на provenance (085, 088); запись диагностик через service role + partial unique `is_current`; фильтр `is_approved` | 2, 5 |
| Код ↔ схема | — | Код читает несуществующие колонки: `metrics.value_numeric/value_text` (`lib/insights/ai-generator.ts:109`), `diagnostics.created_at` (`giga-admin/clients/route.ts:46`), `companies.employee_count/regions/contact_position` | P1 | Исправить запросы; проверить по прод-схеме (B1) | 2 |
| Безопасность (прочее) | См. [09](09-security.md) | Публичный бакет `documents` [verify live]; 44 файла отдают `error.message`; 22 файла падают на anon-ключ; нет `server-only`; in-memory rate limit без вытеснения | P1 / P2 | По списку 09 | 2, 5, 13 |
| Тесты / CI | Vitest 2018 кейсов; 13 кейсов реального RLS (083); Playwright только Journey | Нет CI; coverage считает только `app/actions` и `middleware.ts`; нет e2e клиентского пути; нет тестов изоляции тенантов для 084+ | P1 | Минимальный CI (tsc, lint, vitest) сразу; CI с тестовой БД и RLS-матрицей; e2e онбординг→Overview | 2, 13 |
| Деплой / env | Vercel + Railway (WA-bridge); 131 переменная в `.env.example` | `assertServerEnv()` без вызовов; preview открывает анонимный Journey (`middleware.ts:60-63`); 5 используемых переменных не задокументированы | P2 | Проверка env при старте; preview без прод-ключей; дополнить `.env.example` | 13 |
| Mock / demo | См. §2 | Фейковые данные в реальных клиентских и staff-экранах | P0 (клиенту) / P2 | Удалить или маркировать; empty state вместо фейков | 3, 13 |

## 2. Инвентарь mock / demo / TODO

Скан (аудит 05 §9): `app components lib hooks stores services middleware.ts`, 468 строк по ключевым словам (demo 176, seed 82 — в основном стадия `'seed'`, stub 66, sample 56, mock 40, placeholder 30, TODO 12, hardcoded 10, fake 3). Ниже — значимые находки (аудит 02 §6 + 05 §9), разложенные по классам.

### 2.1 Допустимые dev fixtures и маркированные демо (оставить)

| Где | Что | Условие |
|---|---|---|
| `lib/ai/structured.ts:44` | `JOURNEY_FORCE_DEMO=1` выключает OpenRouter | только `NODE_ENV!=='production'` |
| `components/journey/runtime.ts:9-14`, `lib/journey/demo.ts` | локальное демо Journey | non-prod или `NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO` |
| `app/api/dev/*` | dev-регистрация | `NODE_ENV!=='production' && ENABLE_DEV_AUTH_ROUTES==='1'` |
| `components/gri/assessment/GRIAssessment.tsx:130-137,605-623` | DEMO-радар до теста | подписан «пример / Иллюстрация» |
| `components/dashboard/GRIAssessmentRadarWidget.tsx:131,368` | полигон «Эталон 8.0» | подписан |
| `lib/gri/benchmarks.ts:1-8` | экспертные отраслевые бенчмарки GRI | помечены как экспертная оценка |
| `components/dashboard/TopSalesTable.tsx:270-279` | футер «Демо-данные» | таблица и так `sr-only` |
| `components/point-a/v2/MarketAnalysisCard.tsx:30-46,97` | `source:'mock'` = флаг пустого состояния (показывает «—») | переименовать флаг |
| `lib/point-a/v3/aggregator-v3.ts:8`, `lib/metrics/anomalies.ts`, `forecast-ensemble.ts` | слово «sample» в статистике | не данные |

### 2.2 Тестовые данные (не должны попадать в прод-поток)

| Где | Что | Риск / действие |
|---|---|---|
| `lib/realtime/__mocks__/supabase.ts:1-60` | тестовый мок лежит в `lib/` | импортов из приложения нет; перенести в `tests/` |
| `prisma/seed.ts:9-13` | `deleteMany` по `pulse_metrics`, `gri_reports`, `clients`, `users`, `organizations` без проверки окружения | против той же БД — добавить guard (R16) |
| `tests/e2e/journey.spec.ts` + `playwright.config.ts:19-24` | e2e с `JOURNEY_FORCE_DEMO=1` | ок |
| `scripts/ai-smoke.test.ts`, `ai-probe.test.ts` | живые LLM-вызовы | только вручную (B3) |

### 2.3 Реальные product flows с фейковыми данными (исправить)

| Где | Что видит пользователь | Кто видит | Фаза |
|---|---|---|---|
| `lib/metrics/descriptions.ts` — 67 `current_state` (`:78`, `:846`, `:896`…) → `MetricDrillDownModalV2.tsx:637-642`, `MetricsPageClient.tsx:501-505,623-636` | «Текущее состояние: ₸84.2М при цели ₸110М», «Команда 2.55/10 — критический уровень», «Факт ~90 млрд ₸» | каждый клиент | 3 |
| `components/point-a/v2/MetricZonesGrid.tsx:82-103` | «Зелёная зона — в плане» для любой метрики со значением | клиент | 3 |
| `GriPageShell.tsx:45,148-152` + `lib/gri-calculator/gri-data.ts:21-29` | AI-стратегия по баллам 5/4/3/6/2/5/4 | клиент | 3 |
| `app/api/expert/clients/[id]/gri/route.ts:21,29` | те же дефолтные баллы GRI | эксперт | 3 |
| `components/point-a/v2/PointAQuickPills.tsx:95,183` | всегда «5 Потерь» | клиент | 3 |
| `app/client/point-a/page.tsx:253,366-369` | дата отчёта = сегодня | клиент | 3 |
| `app/client/dashboard-ecommerce/page.tsx:10,18-60` | «Demo Shop», выручка 84.2M, воронка, SKU (бейдж только у hero) | клиент e-com | 3 |
| `app/(dashboard)/dashboard/page.tsx:536-541` | «Q1 2026 · Текущий период», «до $2M в год» | персонал | 13 |
| `components/dashboard/GoalsBar.tsx:10-21` | цели «Выйти на $2M ARR», «Маржа 40%+» (Zustand) | персонал | 13 |
| `lib/portfolio-gri.ts:57-66` + `dashboard/page.tsx:518-528` | «GRI»-радар из блоков Точки А (Team=Operations) по всем тенантам | персонал | 13 |
| `dashboard/page.tsx:83-94,161-168` | «GRI анализов» = счётчики `diagnostics.overall_score` | персонал | 13 |
| `app/(dashboard)/intelligence/page.tsx:30-31` | «AI Инсайты 0», «Статус систем Active» — константы | персонал | 13 |
| `app/(expert)/expert/reports/page.tsx:5-11` | список отчётов захардкожен | эксперт | 13 |
| `components/dashboard/admin/AdminClientsList.tsx:56` | менеджер «Марина Р.» | персонал | 13 |
| `app/(dashboard)/users` (`shared/api/users.service.ts:1-4`) | пользователи из localStorage | персонал | 13 |
| `app/api/health/route.ts:21,53-69` | uptime «99.8%», латентности `db*1.6+12` | публично | 13 |
| `lib/point-a/benchmarks.ts:8-10,26-28` | «curated» бенчмарки с синтетическим `sampleSize` (через сиротский `/api/v1/point-a/benchmarks`) | API | 4 |
| `components/clients/ClientsTable.tsx:11` | «maps both mock and real data» (`/pulse`) | персонал | 13 |

Не фейк, но риск: `app/api/auth/demo-access/*` + кнопка на прод-логине — реальная функция, создающая одобренные аккаунты без auth (см. [09](09-security.md)).

### 2.4 Незаконченная функциональность (TODO / мёртвая проводка)

| Где | Состояние | Фаза |
|---|---|---|
| `components/point-a/v2/KeyMetricsHero.tsx:6-16,127-164` | TODO-плитки LTV/CAC/no-show; герой всегда пуст | 4 |
| `app/api/v1/metrics/catalog/route.ts:206,212` | trend-сортировки = сортировка по значению | 4 |
| `lib/point-a/aggregator.ts:77` | `trends: []` | 4 |
| `lib/metrics/source-adapters.ts:206,233` | prisma/external адаптеры — заглушки | 4, 9 |
| `app/(dashboard)/point-a/insights/page.tsx:7,107-121,282` | «mock replies»; композер только в памяти (POST существует) | 3 |
| `components/point-a/v2/InsightItem.tsx:165-197` | кнопки Подтвердить/Уточнить/Запустить AI без обработчиков | 3 |
| `MetricZonesGrid.tsx:250` → `KpiCardsGrid` не рендерится | клик по метрике ничего не делает | 3 |
| `hooks/useMetrics.ts:29-34` | ждёт массив, catalog отдаёт объект — упадёт при монтировании | 4 |
| Сироты: `/api/v1/point-a/{narrative,history,benchmarks,v3,insights/ai-generate}`, `/api/v1/gri/trust`, `/api/v1/metrics/[id]/value` | нет UI-потребителя | 3, 4 |
| `lib/point-a/scoring-v2.ts`, `weights.ts`, `lib/metrics/{trend,seasonality,forecast-ensemble}.ts` | мёртвый код (только тесты) | 3, 4 |
| `lib/documents/ocr.ts`, `classify.ts`, `bind-fields-ai.ts` | не вызываются в проде | 5 |
| `lib/langfuse.ts` | используется только мёртвым `app/actions/diagnostics.ts` | 7 |
| `lib/functions/calculate-gri.ts:12` + `app/api/clients/[id]/gri/calculate` (410) | намеренно бросает | 7 |
| `lib/integrations/ecommerce/index.ts:2,7-47` | 20 адаптеров бросают ошибку | 9 |
| `lib/payments/providers/{stripe,mir,cloudpayments,halyk}.ts:1`; `app/api/checkout/route.ts:135,152,162` | STUB-эквайринг, транзакции `status:'stub'` | 9 |
| `lib/crm/digest-channels.ts:72,87` + `cron/crm-digest/route.ts:278` | SMS-заглушка; WhatsApp-дайджест не отправляется (телефон `null`) | 9 |
| `app/api/v1/assistant/escalate/route.ts:19` | Telegram/Email-адаптеры эскалации — no-op без env | 10 |
| `app/api/admin/requests/[id]/request-info/route.ts:61` | `TODO: trigger email` | 13 |
| `app/(dashboard)/analytics/page.tsx:63`, `reports/page.tsx:48-61` | заглушка графика; фильтры без обработчиков | 13 |
| `app/actions/auth.ts` | единственные триггеры `user_registered/user_login`, вызовов нет | 10 |
| `N8N_WEBHOOK_URL` (`.env.example:66`) | нигде не читается | 9 |
| `components/diagnostics/DocumentUpload.tsx` → `app/actions/diagnostics.ts` | компонент нигде не импортирован | 13 |
