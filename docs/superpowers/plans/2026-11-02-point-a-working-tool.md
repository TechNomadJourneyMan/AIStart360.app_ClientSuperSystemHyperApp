# Точка А как рабочий инструмент — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Точка А показывает балл, которому можно верить, и только после полной анкеты; правки анкеты сразу пересчитывают её; AI-разбор снова работает.

**Architecture:** Правки в движке v1-проверок (`lib/point-a-engine.ts`), который читают и v1, и v4; флаг «анкета отправлена» входит в снимок (`lib/point-a/snapshot.ts`) и делает оценку `preliminary` — без общего балла, стадии и чисел у блоков, а строка `diagnostics` получает `NULL` вместо балла. Страница v4 в режиме `preliminary` показывает «Снимок бизнеса»: находки и что заполнить, с окнами-редакторами ответов. Роутинг AI — отдельная задача в своём worktree.

**Tech Stack:** TypeScript 5, Next.js 14 App Router, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-point-a-test-audit.md` (§3 — проблемы, §6 — решения PO).

## Global Constraints

- Тексты интерфейса — на русском; бренд `#6effc0`, тёмная тема; поля ввода ≥ 16px.
- Клиентские компоненты не импортируют `lib/point-a/v4/engine` (node:crypto ломает `next build`).
- Новые страницы `/client/*` — с `loading.tsx`.
- «Анкета отправлена» = `public.survey_completed_at(user) IS NOT NULL` (миграция 090), не `steps >= 12`.
- Миграции — со следующего свободного номера (137+), применяются при пуше в main.
- Не трогать Гри.

## Review Focus

1. Клиент, отправивший полную анкету, но с полнотой < 40% в блоке — блок без балла, общий балл есть (`overall` по блокам с баллом).
2. Экспресс-клиент правит ответ в окне-редакторе — снимок пересчитывается, страница обновляется без перезагрузки.
3. Старые снимки без `assessment` (до этой правки) читаются как `full`, если в них есть `overall`.
4. «Не знаю» кнопкой (`{value:null, unknown:true}`) и «не знаю» текстом ведут себя одинаково — нет данных.
5. Потребители `diagnostics.overall_score` (Точка Б, бот, `/client/home`) не падают на `NULL`.

---

### Task 1: Текстовые ответы «не знаю» / «ничего» (К2)

**Files:** Modify `lib/point-a-engine.ts` (NO_ANSWER_RE, UNKNOWN_RE, namesSomething, knowsBreakeven, crmState, проверки audience/usp/main_pain/growth_blockers/competitors), `lib/point-a/v4/extra-blocks.ts`. Test: `tests/unit/point-a-v4/text-answers.test.ts`.

**Interfaces — Produces:** `export function textAnswerKind(v: unknown): 'empty' | 'unknown' | 'none' | 'named'` in `lib/point-a-engine.ts`.

- [ ] Тест: `textAnswerKind` — «не знаю», «Пока не считали», «нет данных», «затрудняюсь ответить» → `unknown`; «Ничего», «нет», «пока нет», «в тетради» → `none`; «Не хватает заявок» → `named`.
- [ ] Тест: `pointAChecks` — `s6_main_pain: 'не знаю'` → main_pain `missing`, не answered; `s5n_moat: 'Ничего'` → 0 и issue; `s9n_breakeven_point: 'пока не считали'` → breakeven `missing`; `s12_crm_tool: 'excel'` → crm 8/20 с issue «CRM в таблицах».
- [ ] Реализация, тесты зелёные, существующие тесты point-a / point-a-v4 зелёные.

### Task 2: Выручка — годы, знак, сезонность, документы (В1, В2, В4, В5)

**Files:** Modify `lib/point-a-engine.ts` (revenue, financeChecks growth/revenue_trend, salesChecks deals/rejections, newVsRepeat), `lib/metrics/source-adapters.ts` (`parsePercentChange`), `lib/point-a/resolved-inputs.ts`. Test: `tests/unit/point-a-v4/revenue-checks.test.ts`.

- [ ] `parsePercentChange`: «снизилась на 8%», «упала на 8», «минус 8%», «-8%» → −8; «±15%» → null.
- [ ] growth — последняя пара полных лет (2025/2024, иначе 2024/2023), иначе заявленное изменение; текст «Нет данных по выручке за два последних года». Run-rate (`s1_current_revenue_year`) годом 2025 не считается.
- [ ] revenue_trend — текущий темп (run-rate) против последнего полного года; issue только при падении > 10%: «Текущий темп выручки ниже {год} на N%».
- [ ] Сделки и отказы — последний год с данными (2025 → 2024 → 2023, таблица тем же порядком); повторные продажи — сначала y2025.
- [ ] `resolved-inputs`: выручка по годам из `biz.finansy.vyruchka_god` (period year) в `resolved.revenue`.

### Task 3: Маржа, NPS, переключатели, индекс здоровья (В3, В6, В7, В8)

**Files:** Modify `lib/point-a-engine.ts` (margin), `lib/point-a/v4/extra-blocks.ts` (nps), `lib/point-a/v4/check-inputs.ts` (toggle), `lib/point-a/v4/engine.ts` (health_index). Test: `tests/unit/point-a-v4/scoring-fixes.test.ts`.

- [ ] Чистая маржа (`s9n_net_margin`) — свои пороги (временные, на утверждение эксперту): ≥15 → 15/15, ≥8 → 10/15, >0 → 5/15 + issue «Чистая маржа N% — ниже 8%», ≤0 → 0 + issue. Валовая — прежние пороги, текст issue «<15%».
- [ ] NPS: 0..10 — оценка по 10-балльной шкале (≥9 полный балл, 7–8 половина + issue, <7 — 0 + issue); вне 0..10 — шкала NPS как сейчас.
- [ ] Переключатель засчитывается по сохранённому шагу только при `surveyComplete`; иначе — только сохранённый ключ самого переключателя. `isAnswered(..., opts: { surveyComplete: boolean })`.
- [ ] health_index: бонусы 20/10/10 нормируются по блокам finance/sales/operations, у которых есть балл; нет ни одного — health = overall.

### Task 4: Оценка только после полной анкеты (К1, решение PO №1)

**Files:** Modify `lib/point-a/v4/engine.ts` (V4Input.surveyComplete, PointAV4.assessment), `lib/point-a/snapshot.ts` (rpc `survey_completed_at`, inputs, запись), `lib/point-a/diagnostic-row.ts` (NULL-балл), `lib/point-a/v4/state.ts` (assessment в view), `lib/point-a/v4/primary.ts` (статус `preliminary`). Test: `tests/unit/point-a-v4/preliminary.test.ts`, существующие тесты снимка.

**Interfaces — Produces:** `PointAV4.assessment: 'full' | 'preliminary'`; `PointASnapshotView.assessment`; `PointAStatus` + `{ kind: 'preliminary' }`.

- [ ] Тест: `calculatePointAV4({ …, surveyComplete: false })` → overall/stage/health = null, assessment 'preliminary', блоки и чек-лист посчитаны.
- [ ] Снимок: `surveyComplete` в `inputs` (смена — новый снимок); `preliminary` → строка diagnostics с `overall_score/health_index/stage = NULL`, блоки `NULL`, риски/быстрые шаги — только по отвеченным проверкам.
- [ ] `pointAStatus` → `{ kind: 'preliminary' }` при assessment 'preliminary'; старые снимки без поля — по `overall`.

### Task 5: Пересчёт после каждой правки анкеты (К3, В11)

**Files:** Modify `app/api/v1/onboarding/survey/route.ts` (событие и при autosave), `lib/survey/admin-edit*.ts` (`adminEditSurvey` — событие), `app/api/v1/diagnostics/point-b/current-revenue/route.ts`. Test: существующие тесты роутов + новый кейс autosave.

- [ ] `SURVEY_ANSWER_CHANGED` при любом сохранении с изменёнными ключами (dedupe по минуте уже есть, очередь склеивает за 20 с).
- [ ] `adminEditSurvey` и current-revenue отправляют то же событие.

### Task 6: Страница — «Снимок бизнеса» без чисел и окна-редакторы (решения PO №1, №2)

**Files:** Modify `components/point-a-v4/{PointAV4Page,PointAHeader,BlocksSection,BlockDetailPanel,OverviewSection,AttentionPanel,SideCards}.tsx`, `lib/user-dashboard/point-a-hint.ts`, `components/onboarding/express/BusinessSnapshot.tsx`. Create `components/point-a-v4/AnswerEditDialog.tsx`, `lib/point-a/v4/check-questions.ts`. Test: `tests/unit/point-a-v4/check-questions.test.ts`.

**Interfaces — Produces:** `questionsForCheck(block: BlockKey, checkId: string): SurveyQuestion[]`, `questionsForBlock(block: BlockKey): SurveyQuestion[]` (по `CHECK_INPUTS` + реестру `lib/survey/questions.ts`).

- [ ] preliminary: шапка «Снимок бизнеса · предварительно» вместо балла и стадии + «Отправьте полную анкету — появится оценка»; у блоков нет баллов, бенчмарков и «сильнее/слабее всего N»; находки, цифры клиента, что заполнить — остаются.
- [ ] Окно-редактор: из пункта «что заполнить» и из «Ответить в анкете» в блоке открывается диалог с вопросами проверки/блока (`AnswerInlineEditor`/`QuestionInput`), сохранение — POST `/api/v1/onboarding/survey` `{ autosave:false, via:'full' }`, затем refetch состояния.

### Task 7: AI-роутинг Claude → Alem/Qwen (решение PO №4) — отдельный worktree

Откат на 402 и на 400 «модель/формат», повышение уровня модели при битом JSON, миграция 137 (маршруты: premium Sonnet, standard Haiku, light Qwen; исправление id `Claude`), заметка о гибкой настройке ИИ-агентов. Патч вливается сюда.

### Task 8: Отрасли бенчмарков и пороги на утверждение (С1, решение PO №5)

**Files:** Modify `lib/point-a/benchmarks.ts` (`normalizeIndustry` — соответствие названий анкеты). Create `docs/superpowers/specs/2026-11-02-point-a-thresholds-proposal.md`. Test: `tests/unit/point-a/benchmarks-industry.test.ts`.

- [ ] Каждая отрасль из `INDUSTRIES` анкеты находит бенчмарк или явно «нет данных» («Строительство», «Финансы», «Медицина», «Логистика», «Агро», «Медиа», «Другое» → null).
- [ ] Таблица порогов: текущее значение → предложение → почему, по отраслям; колонка «утверждено экспертом».

### Task 9: Проверка

- [ ] `npx vitest run` (без `.env.local`), `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] `/dev/point-a-preview` в обоих режимах (полная / предварительная) на десктопе и 375 px.
