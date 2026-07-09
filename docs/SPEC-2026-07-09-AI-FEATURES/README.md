# Спецификация улучшений AIStart360 — AI-функции, доверие, retention, монетизация

**Дата:** 2026-07-09 · **Ветка:** `claude/aistart360-improvements-e4b021` · **Статус:** спецификация (код не менялся)

Эта серия документов — полная проработка 29 продуктовых идей и 4 больших функций
(Named AI-Agent, психопрофиль фаундера, conversational intake / AI validation layer,
бизнес-симулятор), приземлённая на **реальный код** портала. Каждое утверждение о
текущем состоянии проекта подтверждено аудитом кода (файл:строка); всё, что не удалось
подтвердить, помечено `ASSUMPTION`.

## Как читать

| Файл | Содержание | Разделы Части T |
|---|---|---|
| [00-executive-summary.md](00-executive-summary.md) | Executive summary, продуктовая логика, аудит-чеклист, карта 29 идей, рекомендуемый MVP, риски и открытые вопросы, список файлов | T1–T5, T32–T34 |
| [01-ai-chat-rag.md](01-ai-chat-rag.md) | AI-чат поверх отчёта + retrieval-пайплайн (RAG) | T6 |
| [02-next-best-action-plan.md](02-next-best-action-plan.md) | Next Best Action, «5 решающих ставок», интерактивный план 90 дней | T7–T9 |
| [03-trust-methodology.md](03-trust-methodology.md) | Страница «Как считается GRI», честный trustScore, бенчмарки, источники рыночных выводов | T10 |
| [04-retention-funnel-reports-input.md](04-retention-funnel-reports-input.md) | Retention (дайджест, re-scan, стрик, unlock-toasts), верх воронки (sample, ROI, self-serve, share, отраслевые mini-GRI, валюта), отчёты (role-based, видео-разбор), ввод без боли (conversational intake pilot, quick-add, cross-validation) | T11–T14 |
| [05-monetization.md](05-monetization.md) | Paywall-карта, GRI-кредиты, white-label, mini-GRI-лиды → CRM | T15 |
| [06-named-agents.md](06-named-agents.md) | Named AI-Agent: 8 личностей ГРИ, таблицы, промпты, адаптивная персонализация | T16 |
| [07-psych-profile.md](07-psych-profile.md) | Психопрофиль фаундера: блоки, механики, JSON-схема результата | T17 |
| [08-validation-layer.md](08-validation-layer.md) | Conversational intake / validator-agent: pipeline, категории, 17 шаблонов ответов, hard rules | T18 |
| [09-business-simulator.md](09-business-simulator.md) | Бизнес-симулятор: типы, правила прогнозов, JSON-схема | T19 |
| [10-architecture-db-api.md](10-architecture-db-api.md) | Backend-архитектура, схема БД (все сущности), API endpoints, UX-паттерны | T20–T23 |
| [11-llm-orchestration.md](11-llm-orchestration.md) | 12 LLM-вызовов: промпты, схемы, structured output, retry/логирование | T24–T26 |
| [12-security.md](12-security.md) | Threat model, mitigations, consent/retention/deletion | T27 |
| [13-testing.md](13-testing.md) | Тест-план + 29 обязательных тестов → конкретные vitest-файлы | T28 |
| [14-rollout-metrics.md](14-rollout-metrics.md) | Phased rollout (синхронизирован с роадмапом GRI/CRM), метрики, acceptance criteria | T29–T31 |

## Критические зависимости

1. **Параллельная ветка GRI/CRM** (`claude/gri-pulse-crm-improvements-a0017a`, ведётся в другом чате):
   миграции **043** (сессии калькулятора) и **044** (`crm_clients` / `crm_interactions` / `crm_reminders`),
   `/api/v1/crm/*`, экран «Кому звонить сегодня», quick-add, cron-дайджест (`vercel.json`, 09:00 Алматы),
   туториал-движок, раздел «Лиды» в giga-panel. **Эта спецификация строится поверх той ветки.**
   Всё, что зависит от неё, помечено меткой `[DEP: GRI/CRM]`. Нумерация миграций здесь начинается с **045**.
2. **Фаза 4 роадмапа** (Email/Telegram-каналы, план `docs/superpowers/plans/2026-07-09-phase4-channels.md`
   в параллельной ветке) — weekly-дайджест C1 встраивается в неё, не дублирует.
3. `OPENROUTER_API_KEY` обязателен для всех AI-функций (уже так; деградация — честный fallback, не фейк).

## Конвенции

- Приоритеты: **H1 / M2 / L3**; effort **S / M / L**; эффект **🔥…🔥🔥🔥**.
- Все пользовательские тексты — русские; идентификаторы кода — английские.
- `ASSUMPTION:` — обоснованное предположение, требует подтверждения PO/кодом.
- Схемы БД даны как SQL-миграции Supabase (паттерн проекта: plain SQL + `node scripts/apply-migration.js`)
  и/или Prisma-модели — по тому, где живёт соответствующий слой сегодня.
