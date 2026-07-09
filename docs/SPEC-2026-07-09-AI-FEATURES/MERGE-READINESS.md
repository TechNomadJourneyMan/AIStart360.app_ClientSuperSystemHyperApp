# Merge readiness — AI-1 (ветка `claude/aistart360-improvements-e4b021`)

Обновлено 2026-07-09 (после мержа `origin/main` с Фазами 5/6 ветки GRI/CRM).

## Статус

- `origin/main` (70 коммитов Фаз 4B/5/6) **смержен в эту ветку**; конфликты разрешены; объединённый
  набор **954 unit-тестов зелёный**, tsc 0 ошибок, `prisma generate` ок.
- Секреты не в трекинге (`.env`/`.env.local` gitignored).

## Как разрешены пересечения с Фазами 5/6 (обе стороны делали похожие фичи)

| Тема | Их версия (main) | Моя версия | Решение в мерже |
|---|---|---|---|
| Честный trustScore | null + среднее по 6 | null + `computeTrustBlock` + `blocksUsed` | **моя** (надмножество, та же семантика) |
| Self-serve активация | тумблер `auto_approve_clients` (default ON) в режиме `approval` | отдельный режим `auto` + risk-скоринг | **гибрид**: их тумблер + мой `computeRiskFlags` как защита (флагованные → ручная модерация); режим `auto` удалён |
| ai-scanner null-trust рендер | «нет данных» | «нет данных» | их (идентично) |
| Интерактивный план 90д | `gri_plan_progress` (миграция их-047) | расширение `action_items` (моя 057) + PATCH-роут | **сосуществуют** — см. Follow-ups |

## Миграции

**Коллизия нумерации** (обе ветки независимо заняли 045–048) решена переименованием моих файлов;
содержимое не менялось, всё уже применено на prod под исходными именами (idempotent SQL):

| Было (применено на prod) | Стало в репо | Объекты |
|---|---|---|
| 045_ai_conversations | **053**_ai_conversations | ai_conversations, ai_messages |
| 046_document_retrieval | **054**_document_retrieval | document_summaries.user_id, HNSW, RPC |
| 047_founder_psych_profile | **055**_founder_psych_profile | founder_psych_profiles, user_consents |
| 048_next_best_action | **056**_next_best_action | nba_log |
| 049_action_plan_interactive | **057**_action_plan_interactive | action_items +6 столбцов |
| 052_business_simulations | **058**_business_simulations | business_simulations |

Их 043–048 (gri_calc_sessions, crm_clients, profiles_telegram, crm_provider_connections,
gri_plan_progress, access_tiers) — применялись их веткой. **Все мои (053–058) применены и
проверены на prod.**

## Что заработало после мержа в main + деплоя

- AI-чат поверх отчёта (`/api/v1/ai/chat` + панель «Спросить ГРИ об отчёте» на /gri)
- Next Best Action (`/api/v1/nba` + карточка на /client/point-a; сигналы: CRM-просрочки,
  red-zone Точки А, GRI-ограничение, план, пульс, re-scan, психопрофиль, документы)
- Психопрофиль (`/profile/psych`, consent-гейт), согласия (`/api/v1/consents`)
- Data-confidence (`/api/v1/gri/trust`), симулятор (`/api/v1/simulator`)
- Risk-скоринг self-serve поверх тумблера авто-одобрения
- Плюс всё из Фаз 5/6 их ветки

## Follow-ups (не блокеры)

1. **Две реализации интерактивного плана**: их `gri_plan_progress` (галочки по ключам плана) и мой
   `action_items`+PATCH (полноценные задачи). Продуктово выбрать одну; предлагаю мигрировать на
   action_items как более богатую. Пока обе работают, конфликтов нет.
2. Ротировать секреты, засветившиеся в чате: DB-пароль, service-role, OpenRouTER key, Vercel token.
3. `NEXT_PUBLIC_MARKET_APP_URL`/`MARKET_API_URL` — прод-чеклист «Рынка» (из их роадмапа).
4. Удалить дубли-ключи в Vercel env (`Open_Router_API`, `Supabase_Site_URL` — похожи на случайные).
