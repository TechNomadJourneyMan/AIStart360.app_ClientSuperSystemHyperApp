# Анкета, три режима — Ф1 «Основа, просмотр и выбор режима»: план реализации

**Spec:** `docs/superpowers/specs/2026-10-23-survey-three-modes-design.md` (§5, §6, §10–§14, §16 строка Ф1, §18.3 — ответы PO важнее предложений спеки). Опора: аудит `2026-10-22-survey-audit.md`, MVP `2026-10-22-survey-mvp-wave1.md` (конверт «не знаю»/«примерно», `NumberField`, честный прогресс, строка автора W5).

**Цель Ф1:** единый реестр 174 вопросов, один путь записи, путь ответа (`updated_via`) в БД и в строке автора, экран выбора режима (режимы 2 и 3 — за флагом), «Мои ответы» для клиента и тот же просмотр у персонала (GIGA, кабинет эксперта с правкой своих клиентов — §18.3 п. 3).

**Параллельно в той же ветке:** Ф3 (`lib/survey/calcs/**`, `FieldCalc` в формах шагов) и контент «где взять» (`lib/survey/where-to-find.ts`). Реестр коммитится первым — на нём строят оба. Формы шагов трогаем минимально и только перечитав перед правкой.

## Решения

- **Реестр — данные, не генератор.** `lib/survey/questions.ts`: `SURVEY_QUESTIONS: Record<key, SurveyQuestion>` и `SURVEY_QUESTION_LIST` в порядке полной анкеты. Поля: `key`, `step`, `label` (самостоятельная подпись для просмотра, вне контекста формы), `formLabel` (как в форме; `null`, если подпись в форме вычисляется — годы через `yearLabel`), `plain?`, `type`, `unit?`, `options?`, `allowUnknown`, `allowApprox`, `express?: {screen}`, `block` (`express` | `b1`…`b15` по приложению А), `why?` (из `FIELD_NOTES` / `STEPS.why`), `whereToFind?` (сливается из `lib/survey/where-to-find.ts`), `term?`, `twin?`, `delicate`, `chat: 'ask'|'form_only'|'skip'`, `auto` (3 ключа «год = месяц × 12»), `minimum: [{block, check}]` — **вычисляется** из `CHECK_INPUTS` (`lib/point-a/v4/check-input-keys.ts`), а не пишется руками. Плюс `SURVEY_BLOCKS` (15 блоков: название, время, «зачем → что даст») и `EXPRESS_SCREENS` (15 экранов: вопрос простыми словами).
- Формы 12 шагов не переписываем (спека §3). Тесты-сторожа сверяют реестр с формами: ключи и шаги = `SURVEY_KEY_STEP`; `formLabel` встречается в файле формы шага; значения `options` встречаются в форме или в `constants/options.ts`; числовые поля формы (`NumberField`) ↔ числовые типы реестра; экспресс = 29 ключей приложения А, блоки = 145, у каждого ключа ровно одно место; экспресс закрывает все 15 проверок минимума; `delicate` = ключи `FIELD_NOTES`; `whereToFind` только у существующих ключей.
- **`lib/survey/where-to-find.ts`** пишет другой агент. Если файла нет в момент коммита реестра — создаём пустой `export const WHERE_TO_FIND: Record<string, string> = {}` и сообщаем лиду.
- **Один путь записи** `lib/survey/write.ts`: `prepareSurveyWrite` (чистая: допустимые ключи, конверт, шаг, авто-год, мат) + `writeSurveyRows` (upsert с автором и путём, откат без новых колонок до миграций 131/134) + `syncGoalsAfterWrite`. Используют: `POST /api/v1/onboarding/survey` (мастер и «Мои ответы»), `adminEditSurvey` (GIGA и правка в кабинете эксперта). События `QUESTIONNAIRE_*`, зеркало Sheets и аудит остаются в своих маршрутах (они разные по смыслу); синхронизация целей и `SURVEY_ANSWER_CHANGED` — общие.
- **Путь ответа** `updated_via`: `full | express | chat | helper | document | staff | system`. Клиент присылает `via` в теле POST (`full|express|helper`; `document` выводится из `origins`), персонал всегда `staff`. До миграции 134 запись повторяется без колонки (как для 131).
- **Миграция 134** (не применяем): колонка + CHECK; триггер 131 дополнен — пользовательский JWT может записать только `full|express|helper|document` (иначе `NULL`), `chat`/`staff` — только доверенный писатель; доверенная запись без отметки обнуляет путь вместе с автором; `survey_answer_history.via` + триггер истории пишет `NEW.updated_via`; CHECK-и `ai_conversations.surface` + `survey`, `ai_pending_actions.kind` + `set_survey_answer`. Статический тест SQL (как `migration-131.test.ts`).
- **Строка автора с путём:** `formatAttribution` учитывает `updatedVia` (таблица §5.4): «Заполнил: вы (быстрый старт)», «Заполнил: вы (через ИИ-помощника)», «Заполнил пользователь Имя (экспресс)», «Изменил эксперт Имя». Имя владельца для персонала — из `viewer.ownerName` (не грузим имена клиентов в `attribution`). Сводка «кто заполнял» — `summarizeAuthors`.
- **Правка эксперта (§18.3 п. 3):** роль `expert` (профиль) правит ответы **назначенных** клиентов: `GET/PATCH /api/expert/clients/[id]/survey` — `resolveExpert` + `guardExpertClient` (админ — любой клиент, эксперт — только по `user_assignments`), запись через `adminEditSurvey` (аудит с причиной, автор `expert`, путь `staff`, история — триггером), уведомление клиенту «Эксперт Имя изменил ответы анкеты» (`notifyClient`, с ключом дедупликации), синхронизация целей. Тесты: назначенный — 200, чужой — 403, `admin` — любой.
- **Режимы:** `lib/survey/modes.ts` — `SurveyMode = 'full'|'express'|'chat'`, доступность из `NEXT_PUBLIC_SURVEY_MODES` (по умолчанию только `full`): в Ф1 режимы 2 и 3 не построены, поэтому экран выбора у клиентов **не показывается**, пока флаг не включит хотя бы ещё один режим (иначе выбор из одного варианта). Решение «кого куда» — чистая `resolveSurveyEntry({pref, answeredCount, available})`: есть ответы и нет выбора → полная анкета + плашка (если есть другие режимы); новый → экран выбора (если режимов > 1), иначе полная. По §18.3 п. 1 «Анкета заполнена» (`QUESTIONNAIRE_COMPLETED`, бот, комната ожидания) остаётся только за отправкой полной анкеты — код отправки не трогаем. Карточки: «Расширенная полная анкета» (~1,5 ч), «Экспресс + блоки» (7–9 мин), «Диагностическая беседа с ИИ» (10–15 мин); недоступные — «Скоро», без перехода. Запоминаем в `profiles.preferences.survey = {mode, chosen_at, switched_at}` через существующий `PATCH /api/v1/settings/preferences`. Событие `SURVEY_MODE_CHOSEN` (`client: true`, `{mode, previous, from}`), `SURVEY_ANSWERS_VIEWED` (`client: true`).
- **«Мои ответы»** (`/client/onboarding/answers`): общий компонент `SurveyAnswersView` (`mode: 'client'|'staff'`, `canEdit`), логика в чистом `lib/survey/answers-view.ts` (группы по шагам / по блокам, фильтры «пустые», «не знаю / примерно», «ИИ-помощник или документы», «изменено экспертом», «минимум для Точки А», поиск по подписи и ответу, сводка). Правка на месте для коротких типов (`AnswerInlineEditor` по типу из реестра), длинный текст — существующий `AnswerEditorModal`, таблицы и файлы — «Открыть в анкете» (`/client/onboarding?step=N`). Печать — `@media print` (одна колонка, без кнопок, всё развёрнуто). PDF — существующий `GET /api/export/report?type=survey`, `renderSurveyPdf` дополнен строкой автора/пути и сводкой «кто заполнял».
- **Персонал:** GIGA `SurveyTab` — список разделов заменяется на `SurveyAnswersView mode=staff` (правка — через существующий PATCH с причиной; история и «Добавить данные» остаются). Кабинет эксперта, вкладка «Анкета» — вместо `UserDetailPanel readOnly` (старый маршрут без автора) — `SurveyAnswersView` с данными `/api/expert/clients/[id]/survey`, правка при `canEdit`.
- Хук `useSurveyAnswers` (вынос состояния мастера) переносим в Ф2: в Ф1 он не нужен ни одному экрану, а правка `app/client/onboarding/page.tsx` пересекается с Ф3.

## Задачи

### Task 1: Реестр вопросов (первый коммит кода)
- Create `lib/survey/questions.ts`, при необходимости `lib/survey/where-to-find.ts` (пустой).
- Test `tests/unit/survey/questions.test.ts`: 174 ключа = `SURVEY_KEY_STEP`, шаги; приложение А (29 + 145, по блокам); экспресс закрывает 15 проверок минимума; `formLabel` в файле формы; `options` в форме / константах; числовые поля формы ↔ типы; `delicate` = `FIELD_NOTES`; авто-ключи; двойники симметричны; `whereToFind` — только известные ключи.

### Task 2: Миграция 134 и путь ответа в коде
- Create `supabase/migrations/134_survey_answer_via.sql`, test `tests/unit/survey/migration-134.test.ts`.
- Modify `lib/survey/attribution.ts` (`ANSWER_VIA`, `viaFor`, колонки `updated_via`, откат при отсутствии колонки), `lib/survey/attribution-read.ts` (`updatedVia`), `lib/survey/attribution-label.ts` (строка с путём, `ownerName`, `summarizeAuthors`).
- Test: дополнить `attribution.test.ts`, `attribution-label.test.ts`.

### Task 3: `lib/survey/write.ts` — один путь записи
- Create `lib/survey/write.ts` (`prepareSurveyWrite`, `writeSurveyRows`, `syncGoalsAfterWrite`, авто-год `autoYearFor`).
- Modify `lib/survey/schema.ts` (`via`, `origins: 'document'|'chat'`), `app/api/v1/onboarding/survey/route.ts` (тело записи → `write.ts`, `via`, `updatedVia` в ответе), `lib/admin/survey-admin.ts` (строки через `write.ts`, путь `staff`, роль автора `expert` для эксперта), мастер шлёт `via: 'full'`.
- Test `tests/unit/survey/write.test.ts` (чистые функции + in-memory клиент), прогон `tests/unit/api/survey-*`, `tests/integration/survey-route.test.ts`.

### Task 4: Правка ответов экспертом (назначенные клиенты)
- Create `app/api/expert/clients/[id]/survey/route.ts` (GET ответы + автор + история; PATCH правка с причиной), `lib/survey/expert-edit.ts` (уведомление клиенту).
- Test `tests/unit/api/expert-survey-route.test.ts`: назначенный — 200 и строка с автором `expert`/путём `staff`; не назначенный — 403; админ — 200; мат — 400; без причины — 400.

### Task 5: Чистая логика просмотра и режимов
- Create `lib/survey/answers-view.ts` (группы, фильтры, поиск, сводка), `lib/survey/modes.ts` (режимы, доступность, `resolveSurveyEntry`, `surveyPreferencePatch`).
- Modify `lib/events/registry.ts` (`SURVEY_MODE_CHOSEN`, `SURVEY_ANSWERS_VIEWED`).
- Test `tests/unit/survey/answers-view.test.ts`, `tests/unit/survey/modes.test.ts`.

### Task 6: `SurveyAnswersView` и «Мои ответы»
- Create `components/onboarding/answers/{SurveyAnswersView,AnswerRow,AnswerInlineEditor,AnswersFilters}.tsx`, `app/client/onboarding/answers/page.tsx`, стили печати.
- Modify `components/onboarding/SurveyReview.tsx` и шапку мастера (ссылка «Мои ответы») — минимально.
- Test `tests/unit/survey/answers-view-render.test.ts` (`renderToStaticMarkup`: группы, строка автора с путём, фильтры `aria-pressed`, поиск `role="search"`, кнопки правки только при `canEdit`, печатный класс).

### Task 7: Экран выбора режима, переключатель, плашка
- Create `components/onboarding/modes/{SurveyModeChooser,SurveyModeSwitch,SurveyModesBanner}.tsx`.
- Modify `app/client/onboarding/page.tsx` — минимально: перед мастером решение `resolveSurveyEntry`.
- Test `tests/unit/survey/modes-render.test.ts`.

### Task 8: Персонал — GIGA и кабинет эксперта; PDF
- Modify `components/giga-panel/user360/SurveyTab.tsx` (список → `SurveyAnswersView`), `app/(expert)/expert/clients/[id]/page.tsx` (вкладка «Анкета»), `lib/reports/pdf.ts` + `app/api/export/report/route.ts` (автор, путь, сводка).
- Test: render-тест вкладки эксперта не нужен (клиентский компонент с fetch) — покрыто render-тестом `SurveyAnswersView mode=staff`; PDF — тест входных данных `buildSurveyPdfRows`.

### Task 9: Превью
- Modify `app/dev/survey-preview/{page.tsx,SurveyPreviewClient.tsx,fixture.ts}`: `?view=answers` (клиент и персонал), `?view=chooser`.
- Test: дополнить `tests/unit/survey/preview-fixture.test.ts`.

## Проверка
`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, eslint по изменённым файлам, `npx vitest run tests/unit/survey tests/unit/goals tests/unit/giga-crm tests/unit/api tests/unit/point-a-v4 tests/integration/survey*`. Миграцию 134 не применяем (применение — при пуше в main по правилу PO: `node scripts/apply-migration.js supabase/migrations/134_survey_answer_via.sql`).
