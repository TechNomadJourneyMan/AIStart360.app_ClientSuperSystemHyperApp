# Анкета, три режима — Ф3 «Расчёты под полями»: план реализации

**Goal:** под полями с цифрами показывать приблизительный расчёт по цифрам клиента (без сравнения с отраслью), с мини-графиком. Решение PO (дословно): «Давай внизу под графой был график с цифрами клиента без сравнений, сравнения с отраслью будет потом и пусть эксперт их проверит и подтвердит, пока можно писать приблизительные расчеты».

**Spec:** `docs/superpowers/specs/2026-10-23-survey-three-modes-design.md` §9 (правила, 14 расчётов, отображение), §16 строка Ф3, §18.3. Ключи — `docs/superpowers/specs/2026-10-22-survey-audit-inventory.md`.

**Параллельно работают:** агент Ф1 (`lib/survey/questions.ts`, `lib/survey/write.ts`, миграция 134, «Мои ответы», выбор режима, строка автора в формах шагов), контент-агент (`lib/survey/where-to-find.ts`). Их файлы не трогаем; в формы шагов вставляем минимально, перечитав файл прямо перед правкой, и сразу коммитим. `git add` только своими путями.

## Решения

- **Чистые функции** `lib/survey/calcs/*`: вход — плоская карта ответов мастера (`Record<string, unknown>`, как `data` у форм шагов, отметки «не знаю» / «примерно» лежат объектами `lib/survey/answer-value.ts`) и контекст `{ now?, key? }`. Без ИИ, без сети, без БД, без записи — тест-сторож обходит все импорты модуля и падает на supabase / prisma / `next/headers` / `fetch(`.
- **Результат:** `CalcResult = { id, title, lines, chart?, approx, missing, sources, how }` или `null`.
  - `null` — ни одного входа расчёта ещё нет (пустое поле не засоряет форму подсказками).
  - `lines: []` + `missing` — часть входов есть, но нужного нет или «не знаю» → компонент показывает серым «Чтобы увидеть расчёт, укажите: средний чек, …».
  - `lines` — первая строка — главный вывод (крупно), остальные — пояснения; противоречие своих цифр — **вопросом** («… Так и есть (например, абонементы) или где-то опечатка?»).
  - `missing` может быть непустым и при готовом расчёте (например, расходы без «прочих») — тогда «Точнее, когда будет: …».
  - `sources` — «из: выручка в месяц (шаг 1), …» (шаг из `SURVEY_KEY_STEP`); `how` — формула словами для «Как посчитано».
- **«Примерно» во входах.** Число входа = `{ v, lo, hi, approx }` (точный ответ: `lo = hi = v`). Результат считается в середине и на всех углах диапазонов (входов ≤ 4, функции монотонны по каждому входу) → `min/max`. Текст: «≈ 3,6 млн ₸ (диапазон 3,3 – 4 млн ₸)», `approx: true`.
- **«Не знаю»** → вход «нет» (никогда не 0) → расчёт скрыт, вход в `missing`.
- **Переиспользуем:** `computeGap` (`lib/point-b/engine.ts`) — темп к цели; `readMetricsTable` / `metricsTableCell` (`lib/survey/metrics-table.ts`) — таблица шага 8; `parseNumber` (`lib/metrics/numbers.ts`) — старые текстовые ответы («около 60 %», «150 000 в месяц»); `fmtMoney` / `fmtNum` / `fmtTimes` (`lib/point-b/model/format.ts`) — числа; `isUnknownAnswer` / `isApproxAnswer` / `unwrapAnswer`; `SURVEY_KEY_STEP`; `SURVEY_KEY_YEAR` (год расходов и прибыли = год `s9n_revenue_2024`). `assessRealism` не берём: ему нужны баллы Точки А, а расчёт под полем — только цифры клиента.
- **Ключ → расчёты:** `CALCS_BY_KEY` и `calcsForKey(key, answers, ctx)` — одна точка входа для форм шагов, экспресса и блоков (Ф2), «Моих ответов» (Ф1) и карточки беседы (Ф4). `computeCalcs(ids, answers, ctx)` — по списку id.
- **Компонент** `components/survey/FieldCalc.tsx` (путь из задачи; в спеке — `components/onboarding/calcs`): `<FieldCalc forKey="…" answers={data} />` или `<FieldCalc ids={[…]} answers={data} />`. Подпись «Приблизительный расчёт по вашим цифрам», главный вывод, пояснения, мини-график, «из: …», `<details>` «Как посчитано». Пересчёт с паузой 300 мс (первый рендер — сразу). Токены проекта (`text-on-surface`, `primary`, `white/[0.06]`), 375 px — одна колонка, без горизонтальной прокрутки.
- **График** — `components/survey/FieldCalcChart.tsx` на `recharts`, подгружается `next/dynamic({ ssr:false })` → не в первом бандле формы. Высота 120 px, без анимации (и `prefers-reduced-motion`), `aria-hidden`; рядом — скрытая таблица `sr-only` с теми же цифрами (`chartRows`, чистая функция). Доли расходов — простая CSS-полоса (без recharts).
- **Превью** `/dev/survey-preview` рендерит настоящие формы шагов → расчёты появляются сами; тест проверяет, что в `filled`, `half`, `unknown` они есть, а в `unknown` есть скрытые с подсказкой и «≈ … (диапазон …)».
- **Нет сравнения с отраслью** — тест: в текстах нет «отрасл», «норм», «бенчмарк», «рынк», «в среднем по».

## 14 расчётов (спека §9.2) и где показываются

| ID | Входы | Под полем (форма шага) |
|---|---|---|
| `goal_pace` | `s1_current_revenue_month`, `s1_goal_12m_revenue_month`, `s1_goal_3y_revenue_month` (или годовые ÷ 12) | шаг 1, после блока целей |
| `revenue_years` | таблица шага 8 «Сумма продаж», `s9n_revenue_2024`, текущая × 12, цель 12 мес | шаг 8 под таблицей; шаг 9 под выручкой |
| `check_x_sales` | таблица шага 8: средний чек, количество продаж, сумма продаж | шаг 8 под таблицей |
| `margin_check` | `s9n_net_profit`, `s9n_net_margin`, `s9n_revenue_2024` | шаг 9, после маржи |
| `expense_structure` | `s9n_expense_cogs/marketing/rent/other`, `s9n_revenue_2024`, `s9n_net_profit` | шаг 9, после расходов |
| `receivables` | `s9n_debtor_days`, выручка в год | шаг 9, после срока оплаты |
| `funnel` | 7 конверсий шага 5, `s5n_funnel_lead_to_sale`, `s7_leads_per_month` | шаг 5 после воронки; шаг 7 после лидов |
| `leads_to_goal` | `s7_leads_per_month`, цель и текущая в месяц, средний чек (таблица шага 8, иначе `s7_avg_check_target_kzt`), `s5n_funnel_lead_to_sale` | шаг 7 после лидов |
| `refusals_share` | `s3_deals_2023..2025`, `s3_rejections_2023..2025` | шаг 5, после сделок и отказов |
| `revenue_per_employee` | `s1_employee_count`, текущая и цель 3 года | шаг 1, после блока целей |
| `owner_hours` | `s4m_hours_on_ops` / `s10_hours_on_ops` | шаг 4 и шаг 10, после часов |
| `marketing_money` | `s5_marketing_budget_pct`, выручка в год, `s9n_expense_marketing` | шаг 7 после бюджета; шаг 9 после расходов |
| `staff_count` | `s4n_staffing_table` (сумма «Кол-во менеджеров»), `s1_employee_count` | шаг 4, под штатным расписанием |
| `repeat_rate` | `s7_repeat_freq_days`, средний чек | шаг 7, после частоты покупки |

Шаги 2, 3, 6, 11, 12 — без чисел, расчётов нет (как в спеке §6.1: формы 1, 4, 5, 7, 8, 9, 10).

## Задачи

### Task 1: Основа расчётов
- Create `lib/survey/calcs/types.ts` (`CalcId`, `CalcResult`, `CalcChart`, `CalcContext`), `lib/survey/calcs/inputs.ts` (`readNum` → `Num | 'unknown' | null`, `combine` по углам диапазонов, `fmtRange`, подписи входов, `sourcesOf`, `hasAnyInput`, `revenueMonth/Year`), `lib/survey/calcs/chart.ts` (`chartRows` — текстовая альтернатива).
- Test `tests/unit/survey/calcs-inputs.test.ts`: точное / «примерно» / «не знаю» / строка «5 млн» / проценты / отрицательные; `combine` даёт min/max; формат диапазона.

### Task 2: Расчёты по выручке и целям
- Create `lib/survey/calcs/goals.ts`: `goal_pace`, `revenue_years`, `revenue_per_employee`, `leads_to_goal`.
- Test `tests/unit/survey/calcs-goals.test.ts`: фикстура, «примерно» → «≈ … (диапазон …)», «не знаю» → `lines: []` + `missing`, нет входов → `null`, ноль / отрицательное.

### Task 3: Расчёты по продажам и воронке
- Create `lib/survey/calcs/sales.ts`: `check_x_sales`, `funnel`, `refusals_share`, `repeat_rate`.
- Test `tests/unit/survey/calcs-sales.test.ts` (те же пять случаев на каждый).

### Task 4: Финансы и команда
- Create `lib/survey/calcs/finance.ts`: `margin_check`, `expense_structure`, `receivables`, `marketing_money`; `lib/survey/calcs/team.ts`: `owner_hours`, `staff_count`.
- Test `tests/unit/survey/calcs-finance.test.ts`, `calcs-team.test.ts`.

### Task 5: Реестр и сторожа
- Create `lib/survey/calcs/index.ts`: `CALCS`, `CALC_IDS`, `CALCS_BY_KEY`, `calcsForKey`, `computeCalcs`.
- Test `tests/unit/survey/calcs-registry.test.ts`: 14 id; каждый ключ из `CALCS_BY_KEY` есть в `SURVEY_KEY_STEP`; на фикстуре превью «заполнено» все 14 готовы; нет слов про отрасль; функции не меняют ответы (заморожённый объект); статический обход импортов — ни одного DB-клиента / `fetch`.

### Task 6: Компонент `FieldCalc` и ленивый график
- Create `components/survey/FieldCalc.tsx`, `components/survey/FieldCalcChart.tsx`.
- Test `tests/unit/survey/field-calc-render.test.ts` (`renderToStaticMarkup`): подпись, главный вывод, «из: …», «Как посчитано», скрытая таблица `sr-only`, подсказка «укажите …» для скрытого, ничего при `null`; статически: `FieldCalc.tsx` не импортирует `recharts`, график — через `next/dynamic` с `ssr:false`.

### Task 7: Вставка в формы шагов
- Modify (минимально, по одному коммиту): `Step1CompanyForm.tsx`, `Step4OrgStructureForm.tsx`, `Step5ClientBaseForm.tsx`, `Step7MarketingForm.tsx`, `Step8MetricsForm.tsx`, `Step9FinanceForm.tsx`, `Step10PersonalForm.tsx`.
- Test `tests/unit/survey/field-calc-steps.test.ts`: каждая форма на фикстуре «заполнено» показывает свои расчёты; на пустых ответах — ни одного.

### Task 8: Превью
- Modify `tests/unit/survey/preview-fixture.test.ts` (или новый `calcs-preview.test.ts`): расчёты видны в `filled`, `half`, `unknown`; в `unknown` — «≈ … (диапазон …)» и подсказка «укажите …». В шапке превью (`page.tsx`) — строчка про расчёты.

### Проверка
- `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`
- `npx eslint <изменённые файлы>`
- `npx vitest run tests/unit/survey`

Не делаем: сравнение с отраслью и проверку экспертом (§9.4, V2), «Снимок» и экраны экспресса/блоков (Ф2 — им отдаём `calcsForKey`), «Мои ответы» (Ф1 — то же), карточку в беседе (Ф4). Без БД, без миграций, без dev-сервера.
