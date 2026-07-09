# Merge readiness — AI-1 (ветка `claude/aistart360-improvements-e4b021`)

Обновлено 2026-07-09.

## Статус

- **18 коммитов** поверх `main`; `main` не двигался → слияние **без конфликтов** (fast-forward).
- **Секреты не закоммичены**: `.env` / `.env.local` в `.gitignore`, в трекинге только `*.env.example`.
- **Тесты зелёные**: 737 unit + 6 integration (против реального Supabase, эфемерные фикстуры).
- **Type-check + lint** чистые на всех новых файлах.

## Миграции — УЖЕ ПРИМЕНЕНЫ на prod (проверено)

Применены через `node scripts/apply-migration.js` и проверены запросами к `information_schema`:

| Миграция | Объекты | Статус |
|---|---|---|
| 045_ai_conversations | `ai_conversations`, `ai_messages` (+RLS owner) | ✅ применено |
| 046_document_retrieval | `document_summaries.user_id`, HNSW-индекс, RPC `match_user_document_chunks` | ✅ применено |
| 047_founder_psych_profile | `founder_psych_profiles` (self-only), `user_consents` | ✅ применено |
| 048_next_best_action | `nba_log` | ✅ применено |
| 049_action_plan_interactive | `action_items` +6 столбцов | ✅ применено |

> **Порядок с веткой GRI/CRM:** её миграции 043/044 (`crm_clients` и др.) **уже применены на prod**
> (проверено — таблицы существуют). Файлы 043/044 живут в ветке GRI/CRM, не в этой. Номера 045–049
> не конфликтуют; таблицы независимы — порядок слияния веток не важен.

## Env для prod (Vercel) — проверить наличие

Уже используются существующим кодом, новыми фичами тоже нужны:
- `OPENROUTER_API_KEY` — для AI-чата (A1). Без него `/api/v1/ai/chat` честно отвечает шаблоном.
- `SUPABASE_SERVICE_ROLE_KEY` — для RAG-retrieval (RPC вызывается service-role).
- `ENABLE_DOCUMENT_EMBEDDINGS=true` — чтобы RAG начал индексировать документы (иначе чат работает
  без документов; retrieval возвращает пусто, это ок).

## Что заработает сразу после мержа + деплоя

- `GET/POST /api/v1/ai/chat` — AI-чат поверх отчёта (проверен вживую на реальном LLM).
- `GET /api/v1/nba`, `POST /api/v1/nba/event` — Next Best Action (по GRI-ограничению/плану/пульсу).
- `GET/PUT /api/v1/consents` — журнал согласий.
- `GET /api/v1/gri/trust` — «доверие к данным».
- Честный `trustScore` (null вместо 50) в mini-GRI / ai-scanner.
- Point B корректно читает `s9n_*` (выручка/маржа для новой анкеты).

## Ещё НЕ подключено к UI (роуты готовы, нужен фронт)

- Кнопка/панель чата на страницах результата (панель ассистента уже есть — добавить surface).
- Блок NBA на дашборде; виджет data-confidence; переключатель персон; раздел психопрофиля.
- Роуты психопрофиля / интерактивного плана / симулятора (ядра готовы и покрыты тестами).

## Follow-ups (не блокеры мержа)

- Ротировать секреты, которые засветились в чате (DB-пароль, service-role, OpenRouter) — см. память.
- `prisma generate` локально падает на Node 24 (Prisma 5.10) — на Vercel (Node 20) ок; при желании
  обновить Node-пин для локальной разработки.
- Подключить CRM-сигнал S1 и Point-A red-zone в NBA (после мержа ветки GRI/CRM в main).
