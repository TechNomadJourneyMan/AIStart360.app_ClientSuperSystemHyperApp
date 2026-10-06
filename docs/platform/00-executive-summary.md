# 00 — Executive summary

Назначение: что в AIStart360 уже есть, в каком оно реальном состоянии и что мешает перейти к мультиагентной диагностике.
Обновлено: 2026-10-06

Подробности и ссылки на код: [01](01-architecture-map.md), [02](02-gap-analysis.md), [03](03-database.md), [04](04-point-a.md), [09](09-security.md).

## 1. Что есть

| Блок | Состояние |
|---|---|
| Стек | Next.js 14 App Router, TypeScript strict, Supabase (Auth + Postgres + Storage + Realtime), Prisma 5 (только `generate`), OpenRouter, Inngest 4.1, Vercel Workflow, Resend, Upstash |
| Код | ≈271 route-файл API; 86 SQL-миграций до 083 (74 `CREATE TABLE`) + 26 Prisma-моделей; ≈95 таблиц |
| Клиентский путь | Регистрация → одобрение → 12-шаговая анкета → Точка А → GRI → метрики → Точка B |
| Админка | GIGA-CRM `/admin-giga-panel` (22 страницы, 71 API-маршрут, RBAC 7 ролей × 32 права, аудит, MFA для страниц, impersonation, CMS, настройки) |
| Тесты | Vitest: 227 файлов, 2018 кейсов (213 unit-файлов с моками; 14 integration, 10 из них — против локальной БД при `TEST_DATABASE_URL`); Playwright: 1 файл (Journey). `tsc` и `lint` чистые |
| Базовый прогон Phase 0 | 2018 тестов; в логе baseline одно падение — `tests/unit/omnichannel/whatsapp-web-bridge-reliability.test.ts` (процесс bridge не стартует в контейнере; к коду платформы не относится) |

## 2. Сильные стороны (переиспользуем)

| Что | Где | Почему ценно |
|---|---|---|
| GIGA-CRM как единый центр управления | `lib/admin/rbac.ts:23-105`, `lib/admin/giga-actor.ts:127-141`, `lib/admin/audit.ts:46` | `requireGiga` на всех 71 маршрутах, CSRF-проверка Origin, ранги, fail-closed аудит в `admin_audit_log` (append-only) |
| Анкета-визард | `app/client/onboarding/page.tsx`, `lib/survey/steps.ts:29-295` | 12 шагов, автосейв 2,5 с, черновик, retry, история ответов (`survey_answer_history`), прогресс по 174 ключам |
| GRI | `lib/gri-assessment/sections.ts` (7 разделов, **67 критериев**), `lib/gri-assessment/score.ts:13-36` | Версии, `is_current`, черновики, TOP-5 ограничений и план 90 дней считаются на сервере |
| Резолвер метрик с provenance | `lib/metrics/resolver.ts:25-151`, `materialize.ts:143-190`, `source-adapters.ts` | Приоритет источников, confidence, `provenance {picked, considered, notes, raw_value}` |
| Очереди omnichannel | `064_omnichannel_processing_jobs.sql`, `066`, `lib/functions/process-omnichannel-message.ts` | Lease/attempts/dead, fence на исходящих — шаблон для `agent_tasks` |
| Безопасность вебхуков | `app/api/webhooks/meta`, `whatsapp-web`, `kaspi`, `v1/integrations/myhonor/*` | HMAC по сырым байтам, `timingSafeEqual`, fail-closed 503, nonce/timestamp, ротация ключей |
| Модерация AI-инсайтов | `point_a_insights` + `060`, `lib/insights/ai-generator.ts:22,262-269` | `visible_to_user=false` до публикации экспертом; `model` + `prompt_version` — лучший provenance в репо |
| Защита от prompt injection | `lib/documents/extract.ts:251-283`, `lib/journey/prompt.ts:51-60`, `lib/omnichannel/ai.ts` | `<untrusted_*>`-обёртки, экранирование, grounding-проверка |

## 3. Критические проблемы

| # | Проблема | Факт | Статус |
|---|---|---|---|
| 1 | **P0: самоназначение super_admin при регистрации** | `handle_new_user` брал `role/status` из `raw_user_meta_data` (`002_fix_user_trigger_status.sql:13-20`) → прямой GoTrue `/signup` с `{role:'super_admin'}` давал одобренного супер-админа GIGA. Репозиторий публичный | ✅ исправлено в `083` (+ guard колонок `profiles`, RLS на 25 Prisma-таблицах, закрыты RLS-обходящие view, леджер `schema_migrations`); ⛔ не применено к проду (B1, B2) |
| 2 | Балл Точки А смещён | v1-движок читает 7 legacy-ключей, которых нет в текущей анкете (`s2_ltv`, `s2_cac`, `s2_revenue_2023/2025`, `s2_new/repeat_clients_2024`, `s3_has_loyalty`; `lib/point-a-engine.ts:107,147,161,184-186`). Финансы ≤≈50/100, продажи −25, маркетинг −10 у всех текущих клиентов | ⬜ Phase 3 |
| 3 | Нет Executive Overview | `/point-a` и `/dashboard` не показывают общий балл (`point-a/page.tsx:44-45,65,82`; `dashboard/page.tsx:305-306`); стадия зрелости и `data_gaps` хранятся, но не выводятся | ⬜ Phase 3 |
| 4 | `GET /api/v1/metrics` всегда пустой | `app/api/v1/metrics/route.ts:35-37` → «6 главных KPI» всегда «нет данных» | ⬜ Phase 4 |
| 5 | Фейковые «Текущее состояние» | 67 строк `current_state` из кейс-компании (`lib/metrics/descriptions.ts:78,846,896…`) показываются каждому клиенту | ⬜ Phase 3 |
| 6 | Файлы зависают в `queued` | Inngest `parse-document` не регистрирует триггер; загрузки из FileArea/Header не обрабатываются; нет reaper, OCR не вызывается | ⬜ Phase 5 |
| 7 | 3 из 7 Inngest-функций мертвы | `parse-document`, `calculate-gri`, `assistant-events-retention` объявляют `event`/`cron` вне `triggers` — в inngest 4.1 это игнорируется (проверено пробой SDK) | ⬜ Phase 7 |
| 8 | Нет учёта токенов/стоимости | `chatWithOpenRouter` отбрасывает `usage` (`lib/ai/openrouter.ts:188-189`); `ai_messages.tokens_*` не пишутся; Langfuse только в мёртвом коде; нет дневных бюджетов | ⬜ Phase 7 |
| 9 | Нет агентной системы | Нет реестра агентов, задач, запусков, вызовов инструментов, одобрений; tool calling не используется нигде | ⬜ Phase 7, 9 |
| 10 | Нет уровней уведомлений и одобрений | `notifyAdmins` без уровня, дедуп в памяти, нет журнала доставок; Telegram-вебхук понимает только `/start`, секрет опционален (fail-open) | ⬜ Phase 10 |
| 11 | Тенант = пользователь | `companies` 1:1 с пользователем, нет команд, партнёров, членства (`013:21-23`) | 🔄 Phase 2 (миграция 084) |
| 12 | Миграции не воспроизводят прод | `companies.id` TEXT vs UUID-FK в 001; триггер из 077 не создан ни одной миграцией; `report_documents`, `crm_integrations` без DDL; 7 дублей номеров; леджера не было | 🔄 леджер в 083; drift-правила в `scripts/test-db/setup.mjs` |
| 13 | Нет CI | Нет `.github/workflows` в корне, нет husky; `npm test && npm run lint` запускаются вручную | ⬜ Phase 13 (первый шаг — раньше, см. [08](08-implementation-plan.md)) |

Дополнительно P1 (подробно в [09](09-security.md)): MFA только для страниц; SSRF с отражением ответа через `POST /api/v1/crm/connections`; legacy `/api/v1/admin/*` вне RBAC GIGA; вероятно публичный бакет `documents`; анонимная выдача одобренных демо-аккаунтов; токены CRM в plaintext.

## 4. Реальное состояние ключевых функций

| Функция | Вердикт | Комментарий |
|---|---|---|
| Анкета | REAL | Надёжная запись, но балл не пересчитывается на сохранениях шагов |
| GRI-тест | REAL | 67 критериев; AI-вкладка при прямом заходе считает по `DEFAULT_SCORES` |
| Точка А (балл) | PARTIAL | Только анкета, смещение по legacy-ключам; две разные UI (`/point-a`, `/client/point-a`) |
| AI-анализ Точки А | REAL | Только на `/client/point-a`; документы не учитывает; пишет в `diagnostics.ai_analysis` вместе с narrative (коллизия схем) |
| Метрики | PARTIAL | Каталог 126 метрик, резолвер только survey + documents; нет истории, цели, бенчмарка, статуса |
| Загрузка файлов | PARTIAL | 6 клиентских путей, 4 бакета + локальный диск; обрабатывается только путь онбординга |
| RAG | DEAD | Требует Prisma `Client` с `managerId` = загрузчик; 0 эмбеддингов |
| Отчёты | PARTIAL | PDF на лету, без версий и provenance; shared-ссылки показывают «живые» данные |
| Уведомления | PARTIAL | Пользовательская лента есть; админские не сохраняются |
| Интеграции | PARTIAL | Omnichannel/MyHonor/Kaspi — реальные; CRM — ручной синк; e-commerce (19–20 адаптеров) и 4 эквайринга — заглушки |

## 5. Решения, принятые для движения вперёд

Кратко (полностью — в [01](01-architecture-map.md) (часть B) и [05](05-agents.md)):
- Тенантность в 3 уровня: компания, участники компании с ролями, партнёрские организации (миграция 084).
- Собственный агентный runtime на Inngest; БД-леджер (`agent_tasks`/`agent_runs`) — источник истины. Vercel Workflow остаётся для omnichannel. n8n — только опциональный слой внешних коннекторов через подписанный вебхук.
- OpenRouter, 3 уровня моделей (light / standard / premium), бюджеты на запуск / агента / компанию / платформу в день.
- Telegram: уведомления по уровням + кнопки Approve/Reject только для привязанных сотрудников с правом `approvals.decide`.
- Только GIGA-CRM: новый раздел «ИИ-агенты».

## 6. Что нужно от владельца

См. таблицу BLOCKED в [README](README.md#blocked). Первое — применить `083` к проду и проверить настройку регистрации Supabase Auth.
