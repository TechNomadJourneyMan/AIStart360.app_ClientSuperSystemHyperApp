# Точка Б — Ф6b (пересчёт по расписанию, план-факт, ежемесячная сверка, сравнение версий): план реализации

**Goal:** План эксперта сверяется с фактом: раз в месяц и при каждом пересчёте строится чекпойнт «план · факт · прогноз» с вердиктом «на курсе / риск / отстаём / нет данных» и явной причиной; у каждой цели виден путь «база → факт → цель», доля пути и доля времени, прогнозная дата. Пересчёт идёт 2 раза в неделю (настройка) и по кнопке персонала, не нагружая БД; при материальном отклонении появляется черновик-предложение новой версии (никогда не одобряется сам) и эксперт получает уведомление. Клиент раз в месяц получает приглашение внести «Факт за месяц»; эксперт видит, у кого сверки не было. Версии плана сравниваются.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` §6, §12.1, §13, §14, §15.2, §16. Предыдущие планы: Ф5, Ф6a.

## Решения

- **Где хранить «Факт за месяц».** Проверено: `metric_overrides` (миграция 110) — значение периода с наивысшим приоритетом, и резолвер Точки А берёт значение самого свежего периода как ТЕКУЩЕЕ. Месячная выручка `2026-09` для годовой метрики `biz.finansy.vyruchka_god` стала бы «годовой выручкой» Точки А (×12 ошибки), а приоритет был бы выше анкеты (спека §13: «приоритет как у анкеты»). Поэтому — **отдельная таблица `pb_monthly_facts`** (источник `monthly_reconciliation`, «ежемесячная сверка»), которую читает только план-факт Точки Б; Точка А не меняется. В модели месячная выручка сверки подмешивается в историю выручки только в расчёте план-факта (без изменения `history.ts`).
- **Расписание из настройки.** Inngest регистрирует cron статически, поэтому функция просыпается раз в час (`0 * * * *`), читает `pb_recompute_cron` (по умолчанию `0 22 * * 1,4`) и работает, только если текущий час совпадает. Это и есть «страховочный проход не чаще раза в час».
- **Изменился ли `inputs_hash`.** Хэш входов модели + фактов сверки + id одобренной версии + периода хранится в строке чекпойнта (`pb_checkpoints.inputs_hash`). Совпал и чекпойнт есть → компания пропускается.
- **Кнопка «Пересчитать».** Считает одну компанию прямо в запросе (бюджет 45 с), запись в `pb_runs` (`manual`), не чаще раза в 10 минут на компанию (проверка по `pb_runs`, иначе 429 с временем следующей попытки). Событие `point-b/recompute.requested` с `companyId` принимает та же функция (для других источников).
- **Материальное отклонение** = общий вердикт чекпойнта последнего завершённого месяца «отстаём». Тогда, если у плана нет открытой версии, создаётся черновик (`author_kind = 'system'`, копия одобренной, причина «Предложение пересмотра: …»); эксперту — уведомление (назначенному, иначе всем с `clients.review`), дедуп по компании и месяцу. Одобрение — только людьми (поток Ф1).
- **Вердикт по KPI:** выше-лучше для выручки, лидов, конверсии, чека, кассы; `факт/план ≥ 1 − допуск «на курсе»` (5%) → на курсе; `≥ 1 − допуск «риск»` (15%) → риск; иначе отстаём; нет факта или плана → нет данных. Общий — худший из KPI с данными, причина — по худшим (до двух): «конверсия 11% при плане 13%». Допуски — настройка `pb_verdict_tolerances`.
- **Прогресс цели:** база (из снимка цели) → факт (последний факт сверки/фактов; для выручки — месячная × 12) → цель; доля пути и доля времени отдельно, прогнозная дата по тренду модели (только выручка; иначе «нет прогноза»). Сводного процента нет.

## Задачи

### Task 1: Миграция 132, настройки, тестовая БД
- Create `supabase/migrations/132_point_b_checkpoints_runs.sql` (НЕ применять): `pb_checkpoints` (company_id, plan_id, version_id, period, planned/actual/forecast/verdict jsonb, overall CHECK, reason, inputs_hash, computed_at, unique (version_id, period)), `pb_runs` (kind, started_at, finished_at, companies, ai_calls, cost, errors, triggered_by, company_id, status), `pb_monthly_facts` (company_id, period, metric, value, source `monthly_reconciliation`, entered_by, entered_role, note, unique (company_id, period, metric)); RLS как 129: клиент читает свою компанию (`can_read_company`), запись — service role; `pb_runs` — только service role.
- Modify `lib/settings/registry.ts`: `pb_recompute_cron`, `pb_verdict_tolerances` (группа «Точка Б»).
- Modify `tests/unit/point-b/_pbdb.ts` (аддитивно: три таблицы, уникальности).
- Test `tests/unit/point-b/migration-132.test.ts`, дополнить `settings-registry`-проверки.

### Task 2: Чистое ядро план-факта
- Create `lib/point-b/planfact/{types,kpis,verdict,planned,progress,checkpoint,diff,cron}.ts`.
- Test `tests/unit/point-b/planfact-core.test.ts`: вердикт на границах допусков (95% / 94,9%, 85% / 84,9%), «нет данных», причина с числами; плановые значения из траектории и рампы; прогресс (доля пути, доля времени, прогнозная дата, нет данных); сборка чекпойнта; сравнение версий (цели, темп, допущения, итоги траектории, узлы стратегии добавлены/удалены, причина); совпадение cron.

### Task 3: Хранилище, пересчёт компании, правила инвайтов
- Create `lib/point-b/planfact/{store,actuals,recompute,insights}.ts`; Modify `lib/point-b/invites/run.ts` (необязательный `extra` — кандидаты правил план-факта), `lib/point-b/plan/store.ts` (автор черновика может быть без id — системный).
- Правила: `plan_deviation` (отклонение факта от плана), `checkpoint_due` (контрольная точка стратегии наступила за последние 14 дней).
- Test `tests/unit/point-b/planfact-recompute.test.ts`: сохранение факта (источник «ежемесячная сверка», валидация, мат), пропуск при неизменном хэше, чекпойнт и устаревшие рекомендации, отклонение → черновик (никогда не одобрен) + уведомление, без одобренного плана — ничего.

### Task 4: Inngest и ежемесячная сверка
- Create `lib/functions/point-b.ts` (`pb-recompute`: cron ежечасно + события, партия ≤ 10, шаг на компанию ≤ 45 с, `step.sleep`, concurrency 1, продолжение событием; `pb-monthly-checkpoint`: 1-го числа, сообщение клиенту через `notifyClient` по его настройкам + задача эксперту «проверить сверку»), `lib/point-b/planfact/monthly.ts`; Modify `app/api/inngest/route.ts`.
- Test `tests/unit/point-b/planfact-functions.test.ts` (фейковый `step`).

### Task 5: Маршруты и состояние страницы
- Create: `app/api/giga-admin/users/[id]/point-b/recompute/route.ts`, `…/plan-fact/route.ts` (GET), `…/monthly-facts/route.ts` (PUT), `app/api/expert/clients/[id]/point-b/plan-fact/route.ts` (GET / POST пересчёт / PUT факт), `app/api/v1/point-b/monthly-facts/route.ts` (PUT клиента), `app/api/giga-admin/point-b/reconciliation/route.ts` (кто без сверки), `lib/point-b/planfact/load.ts`, `lib/point-b/planfact/route.ts`.
- Modify `lib/point-b/model/types.ts` (`PointBState.planFact`), `lib/point-b/model/load.ts` (минимальный аддитивный вызов — файл параллельно правит W4).
- Test `tests/unit/point-b/routes-planfact.test.ts`: 401/403 клиенту на маршрутах персонала, 402 без PRO, «от имени» — только чтение, 429 кнопки, эксперт чужого клиента — 403.

### Task 6: Клиент — вкладка «План-факт и история»
- Create `components/point-b/planFactModel.ts`, `components/point-b/monthlyFactController.ts`, `components/point-b/tabs/PlanFactTab.tsx`, `components/point-b/VersionCompare.tsx`.
- Modify `overviewModel.ts` (вкладка `history`), `PointBContainer.tsx`, `pointBStateController.ts`, `lib/point-b/fixtures.ts`, `app/dev/point-b-preview/page.tsx` (`?tab=history`, `?planfact=empty`).
- Test `tests/unit/point-b/planfact-ui.test.ts` (`renderToStaticMarkup`, контроллер формы с двойником `fetch`).

### Task 7: Персонал — пересчёт, план-факт, сверка
- Create `components/giga-panel/user360/point-b/PlanFactPanel.tsx`, `planFactPanelController.ts`; Modify GIGA `PointBTab.tsx`, `components/expert/tabs/PointBTab.tsx`, `PointBQueuePage.tsx` (клиенты без сверки).
- Test `tests/unit/point-b/planfact-panel.test.ts`.

### Task 8: Закрытие
- `npx vitest run tests/unit/point-b tests/unit/api tests/unit/popups` + новые, полный `npx tsc --noEmit -p tsconfig.json`, eslint по своим файлам. Миграцию 132 применяет ведущий.

## Порядок
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8; коммит на задачу (`(Ф6b)`).

## Итог реализации (2026-10-22)

Задачи 1–7 выполнены отдельными коммитами `(Ф6b)`; `tsc` по проекту — 0 ошибок, eslint по файлам фазы — чисто, полный `vitest` — падают только известные окружению (`tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` ×2, интеграционные `point-a-aggregate` / `ai-features` с реальной БД).

Решения по ходу (на подтверждение PO):
- **Клиент и прежние версии.** RLS миграции 125 и тест Ф1 «заменённая версия клиенту не показывается» запрещают отдавать клиенту содержание заменённых версий. Поэтому клиент видит список версий (номер, статус, кто и когда одобрил, причина изменений), а сравнение с заменённой версией показывает причины изменений по словам эксперта, без старых чисел. Полное сравнение (цели, темп, допущения, итоги, узлы стратегии) — у эксперта и админа в «План-факт и пересчёт».
- **Кнопка «Пересчитать»** считает компанию сразу в запросе (бюджет 45 с) и всегда принудительно; событие `point-b/recompute.requested` принимает отдельная функция `pb-recompute-company` (rateLimit 1 / 10 мин на компанию).
- **Факт после сохранения формы** пересчитывает только чекпойнты (без инвайтов и черновиков) — они появятся при плановом пересчёте или по кнопке.
- **Не более одного предложения пересмотра в месяц** на план (по префиксу причины системной версии).
- Настройки `pb_recompute_cron` и `pb_verdict_tolerances` есть в реестре, но на странице настроек GIGA (собрана вручную) их пока нет — как и настроек всплывающего слоя Ф1б.
