# 00 · Executive summary, аудит, карта идей, MVP

## 1. Executive summary

AIStart360 сегодня — диагностический продукт с сильным «движком» (Точка А с весами и
red-zones, 62-критерийный GRI с историей, Точка Б с goal-driven роадмапом, смарт-ассистент
с анти-галлюцинационной границей) и слабым «выходом»: пользователь получает отчёт и остаётся
один. Аудит кода подтвердил главный тезис ТЗ и добавил конкретики:

1. **RAG построен наполовину.** Пайплайн чанкинга и эмбеддингов есть (`lib/documents/embed.ts`,
   LangChain 1000/200, `openai/text-embedding-3-small` → `document_chunks.embedding vector(1536)`),
   но выключен флагом `ENABLE_DOCUMENT_EMBEDDINGS` и **ни одного retrieval-чтения в кодовой базе нет**
   (ни оператора `<=>`, ни RPC, ни векторного индекса). Достроить чтение дешевле, чем кажется.
2. **`trustScore = 50` — хардкод** (`lib/gri/logic.ts:100-101`) и тянет средний балл Engine A к 50.
   Реальные сигналы для честного расчёта уже есть в данных (полнота анкеты, s5_*-маркетинг,
   секция trust-positioning в GRI-калькуляторе, наличие документов/CRM/истории GRI).
3. **GRI-движков четыре, а не два** (0–100 finance-детерминированный; 0–10 канонический 62-критерийный;
   0–10 калькулятор с целью 8.5; 0–1000 легаси `GriReport` с вечными нулями в блоках). Плюс
   рассинхрон шкал в PDF и **несовпадение формы `top_5_limits`** между продюсером и потребителями.
4. **Ассистент ГРИ — готовая основа для всего AI-пакета.** Уже есть: единый OpenRouter-клиент
   с тир-роутингом (Haiku/Sonnet/Opus), context-builder как единственная граница данных в промпт,
   output-фильтр секретов, PII-маскирование, 3-слойная валидация анкеты, эскалации в 4 канала,
   4 «скина» маскота. Нет: персистентной истории чата, персон (характеров мышления),
   validator-agent для *ответов*, retrieval.
5. **Активация уже наполовину self-serve:** переключатель `open|approval|invite` существует
   (миграция 040, `app/api/giga-admin/settings/registration/route.ts`), одобрение унифицировано
   (`lib/users/approval.ts`). Осталось: режим авто-одобрения с risk-флагами.
6. **Дыры доверия/приватности:** нет таблицы согласий, нет удаления аккаунта/данных, нет страницы
   методологии, бенчмарки показываются без оговорок, у экспертов нет скоупинга по клиентам.

**Что предлагается** (детали в файлах 01–14): достроить путь «отчёт → понимание → одно действие →
привычка → прогресс» на существующем фундаменте. MVP из 8 элементов (см. §5) достижим инкрементально,
без переписывания: ~80% новых функций — это новые файлы `lib/ai/*`, `lib/nba/*`, 6–8 миграций (045+)
и 12–15 API-роутов по уже принятым в проекте паттернам (Supabase-сессия, Zod, rate-limit, честный fallback).

## 2. Ключевая продуктовая логика

```
Понимание → Доверие → Действие → Привычка → Прогресс → Возврат → Монетизация
   A1,B1      B2-B4     A2,A3      C3,C4      A4,C2       C1        G1-G5
   чат        методо-   NBA, 5     стрик,     план 90д,   дайджест  paywall,
   поверх     логия,    ставок     unlock-    re-scan     недели    кредиты,
   отчёта     честный              toasts     праздник              white-label
              trust
```

Каждый модуль обязан отвечать на вопрос пользователя своего этапа:

| Этап | Вопрос пользователя | Модуль-ответ |
|---|---|---|
| Понимание | «Что значит мой отчёт?» | AI-чат поверх отчёта (A1), страница методологии (B1) |
| Доверие | «Почему я должен этому верить?» | честный trustScore (B2), бенчмарки с оговорками (B3), источники (B4), validator-agent (J) |
| Действие | «Что сделать прямо сейчас?» | Next Best Action (A2), 5 ставок (A3) |
| Привычка | «Зачем возвращаться?» | план 90 дней (A4), пульс + стрик (C3), unlock-toasts (C4) |
| Прогресс | «Что изменилось?» | re-scan + празднование (C2), динамика GRI (уже есть в /gri) |
| Возврат | «Напомните мне» | weekly-дайджест (C1) `[DEP: GRI/CRM Фаза 4]` |
| Монетизация | «За что платить?» | paywall-карта (G1), видео-разбор (E2), role-based отчёты (E1) |

Сквозные усилители: Named AI-Agent (H) делает ассистента «живым», психопрофиль (I) — персональным,
validation layer (J) — безопасным, симулятор (K) — «вау»-инструментом перехода А→Б.

## 3. Аудит-чеклист текущего проекта (результаты, файл:строка)

### 3.1 Стек (подтверждено)

| Слой | Факт |
|---|---|
| Frontend/Backend | Next.js `^14.2` App Router, React 18.3, TS 5.4, root-layout (не `src/`) |
| Package manager | npm (`package-lock.json` v3), Node ≥20 |
| DB | Postgres (Supabase) + pgvector; Prisma `^5.10` (30 моделей) **и** Supabase-таблицы с RLS (42 SQL-миграции, `scripts/apply-migration.js`) |
| Auth (боевой) | Supabase SSR (`stores/auth.store.ts`, `middleware.ts` — роли admin/expert/owner/client/super_admin, MFA step-up, giga-cookie HMAC) |
| Auth (остаток) | NextAuth v5 beta — `auth()` ещё вызывается в `lib/api-utils.ts:5`, `app/actions/diagnostics.ts:3`, `app/(dashboard)/{metrics,point-a}/page.tsx` → **вероятно мёртвые/сломанные пути** (логин NextAuth-сессию не создаёт) |
| UI | Tailwind 3.4 + кастомный кит на Radix (`components/ui/*`, teal `#6effc0`, тёмный glassmorphism), sonner, framer-motion, recharts, @dnd-kit |
| AI | **только OpenRouter** (`lib/ai/openrouter.ts`): sonnet=`anthropic/claude-sonnet-4.5`, haiku=`anthropic/claude-haiku-4.5`, opus=`anthropic/claude-opus-4.1`; тир-роутинг по сложности; `generateObjectViaOpenRouter` (Zod, 1 retry); Langfuse-трейсинг. Исключение: `app/api/pulse/*` ходят напрямую в `google/gemini-2.0-flash-001` мимо клиента |
| Embeddings | `openai/text-embedding-3-small`, dim 1536, батч 16, таймаут 20с (`lib/ai/openrouter.ts:179-230`) |
| PDF | pdfkit (`lib/reports/pdf.ts`: renderGriPdf/PointA/PointB/Survey) |
| Email/мессенджеры | Resend (`lib/email.ts`), Telegram/WhatsApp-адаптеры эскалаций (`lib/assistant/escalation/*`) |
| Jobs | Inngest (`app/api/inngest/route.ts`); `[DEP: GRI/CRM]` + Vercel cron 09:00 Алматы |
| Rate limit | Upstash Redis + in-memory fallback (`lib/rate-limit.ts`) |
| Тесты | vitest 4 (73 файла: 61 unit, 12 integration); `npm test && npm run lint` |
| Платежи | осознанные заглушки 5 провайдеров (`lib/payments/providers/*`), `Subscription`/`PaymentTransaction`, `PaymentStatus.stub` — **не баг** |

### 3.2 Существующие-но-неиспользуемые возможности (Часть W)

| # | Артефакт | Статус | Где |
|---|---|---|---|
| W6-8 | `lib/documents/embed.ts`, `vector(1536)`, RAG | **пишется, не читается**; флаг выключен; векторного индекса нет | `embed.ts:61-159`; единственный вызов `app/api/v1/onboarding/documents/[id]/process/route.ts:107-140`; `prisma/schema.prisma:558-573` |
| W9 | `top_5_limits` | детерминирован (не LLM), хранится в `gri_assessments.top_5_limits` (миграция 026); **shape mismatch**: продюсер пишет `criterionId/criterionText/blockId/blockName/score`, потребители читают `title/block/severity/rank` → тихие undefined | `lib/gri-calculator/top5-action-plan.ts:58-100`; читатели `app/(owner)/owner/gri/page.tsx:17`, `app/api/v1/action-plan/route.ts:54`, `app/api/v1/assistant/context/route.ts:58` |
| W10 | `action_plan_90d` | детерминирован; `{days_1_30,days_31_60,days_61_90}` из TOP-5 + сильных блоков; поверх уже есть таблица `action_items` (миграция 030) и `ActionPlanBoard` | `top5-action-plan.ts:128-172`; `components/action-plan/ActionPlanBoard.tsx` |
| W11 | `trustScore = 50` | хардкод-заглушка, 7-й блок Engine A | `lib/gri/logic.ts:100-101,121` |
| W12 | `s9n_*` нули | Point A **исправлен** (COR-01, alias-ридеры `lib/point-a-engine.ts:99-116` + тесты); **Point B ещё сломан** — читает только `s2_*` (`lib/point-b-engine.ts:112-116,212-213`) | подтверждено |
| W13 | Step 10 анкеты | психологический блок `Step10PersonalForm` (`s10_why_opened`, `s10_delegation_ready` 1–10, `s10_hours_on_ops`, `s10_who_to_blame`…), **заголовок шага рассинхронизирован** («Диагностика потерь» vs личный опросник) | `components/onboarding/steps/Step10PersonalForm.tsx`; `constants/step-config.ts:19` |
| W14 | mini-GRI `/gri-free` | 6 вопросов → 3 блока Engine A; лиды в `mini_gri_leads` (миграция 033, поле `converted`); PDF для free нет | `components/mini-gri/MiniGriWizard.tsx`, `lib/gri/mini.ts`, `app/api/public/mini-gri/route.ts` |
| W15 | CRM | в этой ветке — только синк Bitrix24/amoCRM (`crm_integrations`, токены plaintext — P-30); **мини-CRM построена в параллельной ветке** (044: `crm_clients/interactions/reminders`) | `[DEP: GRI/CRM]` |
| W16 | Expert-портал | есть (`app/(expert)/`), но **нет скоупинга по клиентам** — любой эксперт читает всех (`app/api/expert/clients/route.ts:60-62`) | риск для E2 |
| W17 | PDF-отчёты | pdfkit, GRI/PointA/PointB/Survey; смешение шкал 0–10 → 0–100 в `app/api/export/report/route.ts:242-298` | |
| W18 | approval-gate | унифицирован (`lib/users/approval.ts:46` `applyApprovalDecision` → `profiles.status`); режимы регистрации `open|approval|invite` уже есть (миграция 040) | D3 = дёшево |
| W19 | payment/paywall | заглушки осознанные; тарифы `pilot/pro/enterprise`; paywall-логики в продукте нет | |
| — | Бенчмарки | 8 отраслей, hardcoded, `source:'curated'`, `updatedAt='2026-05-19'`; используются только в scoring-v2 Точки А, пользователю как блок не показываются | `lib/point-a/benchmarks.ts:41` |
| — | История GRI | есть: `gri_assessments.is_current` + `?history=1` (последние 20); недельный пульс `gri_pulse_responses` (026/027); **стриков нет нигде** | |
| — | Чат-персистентность | нет таблиц Chat/Message/Conversation; история multi-turn — только клиентская | `app/api/v1/assistant/converse/route.ts:20-25` |
| — | Consent/удаление | нет consent-таблицы, нет удаления аккаунта/данных, `/client/my-data` — редирект-заглушка | риск, см. 12-security |
| — | OG-изображения | нет (`@vercel/og`/satori отсутствуют) | D4 = с нуля |
| — | Лендинг-варианты | в этом репо один `app/page.tsx`; «4 варианта» 2026-06-21 в коде не найдены (вероятно внешние, ср. `in.aistart360.app`) | `ASSUMPTION` |

### 3.3 Версии и deprecated (проверка §2.3 ТЗ)

- Next 14.2 / React 18 — не последние (15/19), но **обновление вне скоупа**: инкрементальность важнее.
  Ничего в спецификации не требует Next 15.
- Модели через OpenRouter актуальны (Sonnet 4.5 / Haiku 4.5). Рекомендация: убрать прямые вызовы
  `google/gemini-2.0-flash-001` из `app/api/pulse/*` в общий клиент (единый таймаут/фолбэк/трейсинг).
- `next-auth@5.0.0-beta` — мёртвый груз; план вывода в §R2 (не блокер, но `requireAuth` в
  `lib/api-utils.ts` надо мигрировать на Supabase-хелпер до расширения API).
- `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` в `.env.example` не читаются кодом — удалить, чтобы не путать.
- pgvector: для 1536-мерных векторов использовать **HNSW** (не ivfflat) — актуальная рекомендация
  Supabase; индекс сейчас отсутствует вовсе.

## 4. Карта 29 идей: приоритет · effort · эффект · зависимости

| ID | Идея | Prio | C | 🔥 | Зависимости / примечание |
|---|---|---|---|---|---|
| A1 | AI-чат поверх отчёта (RAG) | **H1** | M | 🔥🔥🔥 | validator J (MVP-вариант), персистентность чата; RAG-чтение поверх готовой записи |
| A2 | Next Best Action | **H1** | S-M | 🔥🔥🔥 | `[DEP: GRI/CRM]` (crm_reminders), Point A red zones, top_5_limits v2 |
| A3 | «5 решающих ставок» | M2 | S | 🔥🔥 | Фиксит shape mismatch `top_5_limits`; после A2 |
| A4 | Интерактивный план 90 дней | **H1** | M | 🔥🔥🔥 | Расширяет `action_items` (030) + `ActionPlanBoard`; связь с пульсом |
| B1 | Страница «Как считается GRI» | **H1** | S-M | 🔥🔥 | Контент-задача; ссылки из результата/PDF/дашборда/чата |
| B2 | Честный Trust-блок | **H1** | S | 🔥🔥 | Только `lib/gri/logic.ts` + UI; nullable-блоки в Engine A |
| B3 | Бенчмарки «вы vs топ-20%» | M2 | M | 🔥🔥 | Расширить `lib/point-a/benchmarks.ts` (top20 перцентиль), gap-chart, PDF |
| B4 | Источники под рыночными выводами | M2 | M | 🔥🔥 | `market_analysis_answers` уже имеет source/confidence/model — добраить UI-цитаты + as-of дату |
| C1 | Weekly-дайджест | M2 | S* | 🔥🔥 | *поверх Фазы 4 `[DEP: GRI/CRM]`; генератор контента — здесь |
| C2 | Re-scan 90 дней + празднование | M2 | S-M | 🔥🔥 | `gri_assessments` история есть; нужен reminder + milestone-экран |
| C3 | Стрик пульса | L3/M2 | S | 🔥 | `gri_pulse_responses.week_start` — стрик выводим, не храним |
| C4 | «Что разблокировалось» | M2 | S | 🔥 | sonner-toasts + unlock-события в `assistant_events` |
| D1 | Sample-отчёт на лендинге | M2 | S | 🔥🔥 | Обезличенный `renderGriPdf` + блок на `app/page.tsx` |
| D2 | Якорь vs консалтинг + ROI-калькулятор | M2 | S | 🔥🔥 | Чистый фронт; честные диапазоны, дисклеймеры |
| D3 | Self-serve активация | **H1** | S-M | 🔥🔥🔥 | Переоценено вниз: `open|approval|invite` уже есть → добавить `auto`-режим + risk-флаги + audit |
| D4 | Share-картинка GRI (OG) | M2 | S-M | 🔥🔥 | `@vercel/og` с нуля; privacy-safe режим |
| D5 | Отраслевые mini-GRI | L3 | M | 🔥 | Вертикали generic/medical/ecom уже в welcome; прокинуть в `/gri-free` |
| D6 | Валюта по IP | L3 | S | 🔥 | Vercel geo-заголовки; ручной переключатель первичен |
| E1 | Role-based срезы отчёта | M2 | M | 🔥🔥 | `SharedReport.audienceRoles` уже есть; +Investor Summary (LLM) |
| E2 | Видео-разбор эксперта | M2 | S | 🔥🔥 | Процессная; поле ссылки + статусы; риск: нет скоупинга экспертов |
| E3 | Психопрофиль фаундера | H1/M2 | S-M | 🔥🔥 | База — Step 10 (`s10_*`); полный раздел — файл 07 |
| F1 | Conversational intake pilot | H1/M2 | M | 🔥🔥 | Один блок (рекомендация: Step 9 «Финансы»), A/B против формы |
| F2 | Quick-add из буфера | M2 | S | 🔥 | `[DEP: GRI/CRM]` — парсер поверх готового quick-add |
| F3 | Multi-AI cross-validation pilot | M2 | M | 🔥 | Только Точка А summary; бейдж строго при выполненной проверке |
| G1 | Paywall-моменты | M2 | M | 🔥🔥 | `subscriptions.tier` есть; карта лимитов в файле 05 |
| G2 | GRI-кредиты агентств | L3 | M | 🔥 | Новые таблицы; после G1 |
| G3 | White-label | L3 | L | 🔥🔥 | Концепт + риски; не в MVP |
| G4 | Mini-GRI лиды → CRM | M2 | S* | 🔥🔥 | *`[DEP: GRI/CRM]`; giga-раздел «Лиды» уже есть → автокарточка в `crm_clients` + согласие |
| G5 | Симуляция «6 месяцев» | L3 | L | 🔥 | Часть симулятора (файл 09), тип №10 |
| H | Named AI-Agent (8 личностей) | **H1** (база) | M | 🔥🔥🔥 | Поверх `lib/assistant/mascot/*`; персона ⊥ скин |
| I | Психопрофиль (раздел) | **H1** (база из Step 10) | M | 🔥🔥 | Расширенные механики — M2 |
| J | Validation layer | **H1** (базовый) | M | 🔥🔥🔥 | Общая инфраструктура всех AI-ответов |
| K | Бизнес-симулятор | M2 (MVP) / L3 (полный) | L | 🔥🔥 | После A1/J; использует point-b engine + психопрофиль |

## 5. Рекомендуемый MVP (= релиз «AI-1», детали в 14-rollout-metrics.md)

Восемь элементов R1 из ТЗ, с уточнением объёма по аудиту:

1. **AI-чат поверх отчёта с RAG** (A1) — MVP-вариант: без стриминга, retrieval по документам
   пользователя + снапшот отчёта; grounding-блок «использовано».
2. **Next Best Action** (A2) — детерминированный скоринг, LLM только для формулировки (Haiku, с шаблонным фолбэком).
3. **Интерактивный план 90 дней** (A4) — расширение `action_items`, прогресс-бар, «выполнили 3 — переснимите пульс».
4. **Честный Trust-блок** (B2) — формула из реальных сигналов, `null` → «нет данных».
5. **Self-serve активация** (D3) — режим `auto` + risk-флаги + admin override + audit log.
6. **Базовые Named AI-Agent** (H) — 3 персоны в MVP: Базовый ГРИ, Осторожный аналитик, Стратег роста; остальные 5 — фаза AI-2.
7. **Базовый validator-agent** (J) — деterministic-слой на все ответы + LLM-проверка для high-risk категорий и всех ответов чата A1.
8. **Базовый психопрофиль из Step 10** (E3/I) — интерпретация существующих `s10_*` + карточка профиля + скармливание персонализации.

**Не в MVP** (сознательно): симулятор (кроме проектирования схемы), бенчмарк-блок в PDF, дайджест
(ждёт Фазу 4), OG-картинки, role-based отчёты, paywall-включение (ждёт эквайринг).

## 6. Риски и открытые вопросы (T32)

| # | Вопрос / риск | Владелец решения | Блокирует |
|---|---|---|---|
| Q1 | Консолидация GRI-движков: канон = Engine B (0–10, 62 критерия)? Engine A остаётся только для mini-GRI/сканера? Единая шкала наружу — 0–10? | PO | B1 (методологию нельзя писать про 4 движка), B3 |
| Q2 | Порядок мержа: ветка GRI/CRM → main → эта работа. Конфликтов по файлам почти нет (разные зоны), но нумерация миграций и `vercel.json` пересекутся | dev | всё `[DEP]` |
| Q3 | Психопрофиль: где граница согласия? Предлагаю: интерпретация Step 10 — с явным opt-in чекбоксом при первом открытии раздела; расширенные механики — отдельное согласие | PO | I |
| Q4 | Экспертный скоупинг (W16): до запуска E2 (видео-разборы) нужна привязка эксперт↔клиент, иначе любой эксперт видит всех | PO+dev | E2 |
| Q5 | `pulse/*` на Gemini мимо общего клиента — мигрировать на `chatWithOpenRouter` (унификация фолбэков/трейсинга)? Рекомендую да | dev | нет |
| Q6 | NextAuth-остаток: `requireAuth`/`requireRole` из `lib/api-utils.ts` используются API-роутами, но сессии NextAuth не создаются → эти роуты либо мертвы, либо 401. Инвентаризация + миграция на Supabase-хелпер | dev | расширение API |
| Q7 | Хранение AI-диалогов: ретеншн 90 дней (как `assistant-events-retention` в Inngest)? Предлагаю 180 дней + удаление вместе с аккаунтом | PO | A1 |
| Q8 | Бенчмарки: юридическая формулировка «кураторские оценки, не статистика» до живой базы | PO | B3 |
| Q9 | Валюта биллинга USD vs отображение KZT (`FX_RATE_USD_KZT=450` хардкод) — при включении эквайринга источник курса? | PO | G1 |
| Q10 | Лендинг-варианты вне репо (`in.aistart360.app`) — D1/D2 применять к `app/page.tsx` или к внешнему лендингу? Спека пишется для `app/page.tsx` | PO | D1, D2 |
| Q11 | **Модель владения документами (блокер RAG).** `document_summaries` скоупится по `clientId`, а владелец хранится как `clients.managerId` (семантически — менеджер, не пользователь), и код сам помечает связь как ненадёжную (`process/route.ts:112-118`). До решения (добавить `user_id`/`company_id` в `document_summaries` и бэкфилл? или чинить linkage?) миграцию 046 и RAG-чтение писать нельзя — иначе retrieval либо пуст, либо выдаёт чужие документы. Найдено при реализации 2026-07-09 | PO+dev | A1 RAG (046), retrieval |

Продуктовые риски и mitigation — в 12-security.md (threat model) и в каждом разделе.

## 7. Список файлов/модулей: создать или изменить (T33)

### Новые миграции (после 044 из ветки GRI/CRM)

| Миграция | Что |
|---|---|
| 045_ai_conversations.sql | `ai_conversations`, `ai_messages`, RLS self+staff, retention-индексы |
| 046_document_chunks_retrieval.sql | HNSW-индекс на `document_chunks.embedding`, RPC `match_user_document_chunks`, колонки скоупинга (при отсутствии) |
| 047_founder_psych_profile.sql | `founder_psych_profiles`, `user_consents` |
| 048_next_best_action.sql | `nba_log` (выполнено/скрыто/показано) |
| 049_action_plan_interactive.sql | расширение `action_items`: `status/completed_at/snoozed_until/replaced_by/comment/week_no` |
| 050_gri_trust_signals.sql | `gri_trust_signals` (материализованные сигналы честного trustScore) — опционально, MVP считает на лету |
| 051_registration_auto_mode.sql | `registration_mode='auto'`, `risk_flags` в `admin_requests.payload` — если нужна колонка |
| 052_simulations.sql | `business_simulations` (+`simulation_scenarios` при нормализации) |
| 053_report_slices_expert_reviews.sql | `report_slices`, `expert_reviews` (E1/E2, фаза AI-2) |
| 054_unlock_paywall_events.sql | `unlock_events`, `paywall_events` (или переиспользуем `assistant_events` — решение в 10-architecture) |

### Новые модули

```
lib/ai/personas/            — 8 персон: типы, реестр, prompt-блоки (06-named-agents)
lib/ai/validation/          — validator-agent: deterministic + LLM, шаблоны ответов (08)
lib/ai/retrieval/           — embed-query, match_user_document_chunks, сборка grounding (01)
lib/ai/report-chat/         — контекст-билдер чата поверх отчёта, персистентность (01)
lib/nba/                    — сигналы, скоринг, выбор Next Best Action (02)
lib/psych/                  — интерпретатор Step 10, механики, схема профиля (07)
lib/simulator/              — детерминированное ядро + LLM-обвязка сценариев (09)
lib/gri/trust.ts            — честный trustScore (03)
lib/benchmarks/             — top-20% слой + приватность (03)
lib/paywall/                — карта лимитов, checkEntitlement (05)
lib/registration/risk.ts    — risk-флаги авто-одобрения (04)
app/api/v1/ai/chat/*        — чат (создать/продолжить/история/feedback)
app/api/v1/nba/*            — GET current, POST done/dismiss/why
app/api/v1/action-plan/*    — PATCH задач (расширение существующего)
app/api/v1/psych-profile/*  — GET/POST/DELETE
app/api/v1/simulator/*      — CRUD симуляций + generate
app/api/og/gri/route.tsx    — OG-картинка (D4, @vercel/og)
app/(dashboard)/methodology/page.tsx — «Как считается GRI» (B1)
app/(dashboard)/simulator/page.tsx   — симулятор (K)
app/(dashboard)/profile/psych/page.tsx — психопрофиль (I)
components/nba/, components/report-chat/, components/psych/, components/simulator/
```

### Изменяемые существующие файлы (ключевые)

- `lib/gri/logic.ts` — trustScore: честная формула, nullable-блоки (B2)
- `lib/gri-calculator/top5-action-plan.ts` — `Top5Limit v2` (A3, фикс shape mismatch)
- `lib/point-b-engine.ts` — s9n_*-алиасы (fix, «долг» из аудита)
- `lib/assistant/mascot/system-prompt.ts` — компоновка persona-блока (H)
- `lib/assistant/context.ts` — +психопрофиль, +NBA, +план 90д в снапшот (границу не расширять бесконтрольно — см. 08)
- `app/api/v1/assistant/{ask,converse,insight}` — прогон через validation layer (J)
- `app/api/pulse/*` — перевод на общий OpenRouter-клиент (Q5)
- `app/api/export/report/route.ts` — шкалы, ссылка на методологию, бенчмарк-блок (B1/B3)
- `app/api/giga-admin/settings/registration/route.ts` + `lib/settings/system-settings.ts` — режим `auto` (D3)
- `lib/users/approval.ts` — авто-решение + risk-флаги + audit (D3)
- `components/onboarding/constants/step-config.ts` — фикс заголовка Step 10 (гигиена)
- `.env.example` — удалить мёртвые ANTHROPIC/OPENAI ключи, добавить новые флаги

## 8. Минимальный MVP и расширенная версия (T34)

**Минимальный MVP (релиз AI-1, ~4–6 недель одного разработчика):** §5 выше. Критерий выхода:
пользователь с готовым отчётом видит NBA-блок, кликает «Объясни с ГРИ» → чат отвечает,
опираясь на его данные и документы, с блоком «использовано»; план 90 дней кликается и
считает прогресс; trustScore либо честный, либо «нет данных»; новый self-serve пользователь
проходит без ручного одобрения; все ответы проходят validator.

**Расширенная версия (AI-2/AI-3):** остальные 5 персон + переключатель, полный психопрофиль
с 5 механиками, симулятор (9+ типов), бенчмарк-блок + PDF, дайджест, re-scan-празднование,
OG-share, role-based отчёты, видео-разбор, conversational intake pilot, cross-validation pilot,
paywall при включении эквайринга, кредиты/white-label — последними. Полная последовательность
и release-критерии — 14-rollout-metrics.md.
