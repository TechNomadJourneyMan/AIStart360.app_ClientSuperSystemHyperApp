# Анкета — MVP, волна 1 (пункты 3, 4, 5, 6, 9, 10, 11 аудита): план реализации

**Goal:** снизить когнитивную нагрузку анкеты без решений PO: «Не знаю / примерно» вместо выдуманных цифр, удобный ввод чисел без «тихого нуля», честный прогресс («минимум для Точки А» + «глубина»), строка «зачем спрашиваем», годы относительно текущей даты, человеческие формулировки, базовая доступность.

**Spec:** `docs/superpowers/specs/2026-10-22-survey-audit.md` §7 (MVP 3, 4, 5, 6, 9, 10, 11). Не делаем: 1 (удаление вопросов), 2/7/8 (зеркала, противоречия, «Снимок бизнеса») — ждут ответов PO. Карточки загрузки шага 1 и загрузка скриптов шага 6 не трогаем (параллельно их переносит другой агент, миграция 133).

## Решения

- **Формат «не знаю» и «примерно» (один и тот же объект в БД и в состоянии мастера).**
  - «Не знаю / не считаем»: `{ value: null, unknown: true }`.
  - «Примерно»: `{ value: <середина, целое>, approx: true, range: [min, max] }`, `0 ≤ min ≤ max`, `value = round((min + max) / 2)`; одно число («около 5 млн») → `range: [x, x]`.
  - Обычный ответ хранится как раньше: `{ value }`.
  - Почему так: почти все читатели делают `answer.value` → для «не знаю» получают `null` («нет данных», не 0), для «примерно» — число-середину. Отдельно правим только тех, кто показывает ответ человеку («Не знаю», «≈ 5 500 000 ₸ (5–6 млн)») и тех, кто откатывается на весь объект (`?.value ?? row.answer`).
  - В состоянии мастера (плоская карта ключ → значение) отмеченный ответ лежит этим же объектом; при сохранении он уходит как есть (`toAnswerEnvelope`), остальное оборачивается в `{ value }`. GET анкеты отдаёт отметки обратно (`fromAnswerEnvelope`).
  - «Не знаю» засчитывается как ответ для прогресса (шаг начат, глубина, минимум) и попадает в «карту слепых зон» (`blindSpots(answers)`). Подсказки из документов для таких ключей показываются (документы знают то, чего не знает владелец).
  - «Не знаю» есть у числовых и метрических вопросов, кроме «знает всегда» (сотрудники, лет на рынке, отделы, продукты) и целей (цель — решение, а не знание). «Примерно» — у денежных вопросов (₸), включая цели.
- **Ввод чисел.** Один компонент `NumberField` (+ чистый контроллер `lib/survey/number-input.ts`): `type="text"`, `inputMode="decimal"` (целые — `numeric`), пробелы-разделители тысяч при вводе с сохранением позиции курсора, пустое → `null` (никогда 0), единица справа, шрифт 16 px. Старые строковые ответы (`«около 60 %»`) показываются как есть до правки. Телефон — `type="tel"`. Ячейки таблиц (`DynamicTable`, таблица метрик шага 8): пустое → `null`, `inputMode="decimal"`.
- **Расходы шага 9** переводим в число с единицей **«₸ в год»**, а не «₸/мес», как в аудите: все читатели (`finmodel/sources.ts`, `metrics/formulas.ts`, `data-layer/survey-periods.ts`) считают эти ответы годовыми. Точка безубыточности остаётся текстом: движок Точки А понимает «не знаю» в ней как «не знает безубыточность».
- **Честный прогресс.**
  - «Глубина: X %» = отвеченные поля / все поля мастера, без 3 авто-полей «год = месяц × 12» (171 поле). Отвечено: непустое значение или «не знаю»; таблица — только если есть строка хотя бы с двумя заполненными ячейками (предзаполненные 15 категорий карты влияния и нули шаблона метрик не считаются).
  - «Минимум для Точки А: X из N» выводится из `CHECK_INPUTS` движка v4 (`lib/point-a/v4/check-inputs.ts`): берутся проверки, у которых есть хотя бы один ключ текущего мастера (N = 15); проверка закрыта по тем же правилам, что `isAnswered` (ключ отвечен, `positive`-ключи > 0, переключатель закрыт сохранённым шагом). Таблица ключей выносится в `check-input-keys.ts` без тяжёлых импортов, чтобы не тянуть движок в браузер.
  - `surveyProgressFromRows` (кабинет, GIGA, статус, бот, выгрузка) использует те же правила: `percent` = глубина (было «доля начатых шагов»), добавлены `answered`, `total_fields`, `minimum`; `completed` / `is_complete` по-прежнему считают начатые шаги (от них зависят события завершения).
  - Время: у шага в `step-config` — оценка в минутах по инвентаризации; на вкладке и в шапке шага — «~4 мин», для начатого шага — «осталось ~2 мин» (пропорционально незаполненным полям).
- **«Зачем спрашиваем → что получите»:** поле `why` у каждого шага в `step-config.ts`; заметки у деликатных вопросов (`FIELD_NOTES`: прозрачность, долги, прибыль, налоговые проверки, проблемы) с «можно пропустить».
- **Годы:** чистый помощник `yearLabel(year, now)` → «2025 · последний полный год», «2024 · позапрошлый год», «2023 · 3 года назад». Год в подписи берётся **из ключа** (`s3_deals_2024` → 2024): движки и слой данных относят `s9n_revenue_2024` к 2024 году (`survey-periods.ts`, `point-a-engine.ts`), поэтому подпись «последний полный год (2025)» над ключом 2024 испортила бы данные. Ключи не меняются.
- **Строка автора:** нет автора → строки нет (`formatAttribution` → `null`); «ИИ (из документов)» по `answer.source` остаётся.
- **Формулировки:** «человеческий вопрос (термин)» + подсказка-термин (`TermHint`, `title` + `aria-describedby`) для УТП, NPS, ABC/RFM, no-show, ROI, CJM, EDM/ERP/BI; шаг 6 «CJM» → «Путь клиента» (вместе с `SURVEY_STEP_LABELS`, тест требует совпадения; выгрузка в Sheets позиционная — смена текста заголовка безопасна); «Кто виноват» → нейтрально, ключ прежний.

## Задачи

### Task 1: Формат ответа «не знаю / примерно» и схема
- Create `lib/survey/answer-value.ts`: `UnknownAnswer`, `ApproxAnswer`, `isUnknownAnswer`, `isApproxAnswer`, `isMarkedAnswer`, `unknownAnswer()`, `approxAnswer(min,max)`, `toAnswerEnvelope`, `fromAnswerEnvelope`, `unwrapAnswer`, `answerNumber`, `parseLooseNumber`, `parseApproxRange`, `formatMarkedAnswer`, `blindSpots`.
- Modify `lib/survey/schema.ts` (конверт допускает `unknown` / `approx` + `range` с проверкой согласованности).
- Test `tests/unit/survey/answer-value.test.ts`, дополнить `schema-progress.test.ts`.

### Task 2: Читатели ответов
- Modify `lib/survey/progress.ts` (`hasAnswerValue`: «не знаю» = ответ, правило строк таблиц), `lib/survey/steps.ts` (`rowHasValue` через тот же помощник), `lib/point-a-engine.ts` (`present`: отметка «не знаю» не ответ — страховка), `app/api/v1/onboarding/survey/route.ts` (GET отдаёт отметки; режим эксперта/админа передаёт отметку целиком), `lib/admin/survey-admin.ts` (конверт через `toAnswerEnvelope`), `app/api/v1/assistant/validate/route.ts` (черновик разворачивается до значения), откаты `?.value ?? row.answer` → `unwrapAnswer` (`psych-profile`, `nba`, `clients/[id]/analysis/point-b`, `giga-admin/requests/[id]/survey`, `PointALegacyPage`), показ: `lib/survey-labels.ts` (`formatSurveyValue`: «Не знаю», «≈ … (… – …)»), `lib/survey/export.ts` (Google Sheets), GIGA `users/[id]/survey`, `surveys/[userId]/preview`, `users/[id]/profile`, кабинет `app/client/home/page.tsx`, `lib/user-dashboard/summary.ts` (герой не показывает «Не знаю» вместо выручки), `components/onboarding/DocumentSuggestions.tsx` (для «не знаю» подсказка видна).
- Test `tests/unit/survey/unknown-readers.test.ts`: прогресс/шаги, `present`, Точка А v4 (`answeredSteps`/`isAnswered`), резолвер метрик (`surveyAnswers` с `null`), входы Точки Б (`finmodelFromSurvey`, `readNumberAlias`), цели (`syncGoalsFromSurvey` → «нет данных», «примерно» → середина), GRI reality-check, выгрузка («Не знаю»), правила ассистента (`null` не срабатывает как 0), `blindSpots`.

### Task 3: `NumberField` и замена числовых полей
- Create `lib/survey/number-input.ts` (форматирование с курсором, разбор, отображение значения), `components/onboarding/shared/NumberField.tsx` (чипы «Не знаю / не считаем», «Примерно»), экспорт в `shared/index.ts`.
- Modify шаги 1 (числа, авто-год без нуля, телефон `tel`; карточки загрузки не трогаем), 4, 5, 7, 9 (расходы → ₸ в год), 10; `DynamicTable` (пусто → `null`, `inputMode`), `Step8MetricsForm` (пусто → `null`).
- Test `tests/unit/survey/number-input.test.ts` (чистые функции), `tests/unit/survey/number-field-render.test.ts` (`renderToStaticMarkup`: `inputMode`, единица, `aria-pressed` чипов, «Не знаю» отключает поле).

### Task 4: Честный прогресс
- Create `lib/point-a/v4/check-input-keys.ts` (таблица `CHECK_INPUTS`, `check-inputs.ts` реэкспортирует), `lib/survey/point-a-minimum.ts`, `components/onboarding/SurveyProgressHeader.tsx`.
- Modify `lib/survey/progress.ts` (`surveyDepth`, авто-поля исключены, `stepTimeLeft`), `lib/survey/steps.ts` (`surveyProgressFromRows`: глубина, минимум), `components/onboarding/constants/step-config.ts` (`minutes`), `app/client/onboarding/page.tsx`, `components/onboarding/SurveyReview.tsx`, `lib/comm/bot.ts` (текст «N из 12 шагов, глубина X %»).
- Test `tests/unit/survey/progress-honest.test.ts` (+ обновить `steps.test.ts`, `schema-progress.test.ts`): один переключатель не даёт «шаг готов» в глубине, 15 строк карты влияния без имён не считаются, минимум = N из `CHECK_INPUTS`, согласованность мастера и `surveyProgressFromRows`.

### Task 5: «Зачем спрашиваем»
- Modify `step-config.ts` (`why` у 12 шагов, `FIELD_NOTES`), Create `components/onboarding/StepHeader.tsx` (шапка шага: заголовок, подсказка, «зачем → что получите», время), `components/onboarding/shared/FieldNote.tsx`; заметки у деликатных полей (шаги 1, 9, 10).
- Test `tests/unit/survey/step-why.test.ts` (у каждого шага есть `why`, заметки ссылаются на существующие ключи, рендер шапки).

### Task 6: Годы и строка автора
- Create `lib/survey/year-labels.ts`; Modify шаги 5, 8, 9 (подписи), `lib/survey/attribution-label.ts` (`null` без автора), `components/onboarding/SurveyFieldLayer.tsx` (нет текста → нет строки), прочие вызовы `formatAttribution`.
- Test `tests/unit/survey/year-labels.test.ts`, обновить `attribution-label.test.ts`.

### Task 7: Человеческие формулировки
- Create `components/onboarding/shared/TermHint.tsx`; Modify `step-config.ts` + `lib/survey-labels.ts` (шаг 6 «Путь клиента», подписи с термином), `lib/assistant/sections.ts` (подпись раздела), шаги 3, 5, 6 (только подписи), 7, 10, 12.
- Test `tests/unit/survey/plain-wording.test.ts` (нет «Кто виноват», шаг 6 «Путь клиента», у терминов есть пояснение).

### Task 8: Доступность
- Modify `BoolToggle` (`role="switch"`, `aria-checked`, `aria-labelledby`), встроенные переключатели шагов 7 и 12 → `BoolToggle`, `MultiSelect` и чипы регионов / барьеров (`aria-pressed`, группа с подписью), `DynamicTable` (подписи ячеек), таблица метрик шага 8 (подписи ячеек).
- Test `tests/unit/survey/a11y-render.test.ts` (`renderToStaticMarkup`).

### Task 9: Превью и экран проверки
- Modify `app/dev/survey-preview/{fixture.ts,SurveyPreviewClient.tsx,page.tsx}` (вариант `unknown`: «Не знаю» и «примерно» в ответах; общий `SurveyProgressHeader` / `StepHeader`), `components/onboarding/SurveyReview.tsx` (список слепых зон).
- Test `tests/unit/survey/preview-fixture.test.ts` (все варианты × все шаги рендерятся через `renderToStaticMarkup` без исключений; в `unknown` есть отметки; список слепых зон на экране проверки).

## Проверка
`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, eslint по изменённым файлам, `npx vitest run tests/unit/survey tests/unit/goals tests/unit/point-a-v4 tests/unit/point-a tests/unit/point-b tests/unit/api tests/unit/metrics tests/integration/survey*` + новые тесты. Миграции не нужны (формат живёт внутри `answer jsonb`).
