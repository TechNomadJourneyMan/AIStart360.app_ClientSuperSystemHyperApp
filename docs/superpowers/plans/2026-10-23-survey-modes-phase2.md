# Анкета, три режима — Ф2 «Экспресс + Блоки + Снимок бизнеса»: план реализации

**Spec:** `docs/superpowers/specs/2026-10-23-survey-three-modes-design.md` §5, §7, §9, §14, §15, §16 строка Ф2; **§18.3 — ответы PO важнее предложений спеки**. Опора: Ф1 (`lib/survey/questions.ts` — `SURVEY_QUESTIONS`, `EXPRESS_SCREENS`, `SURVEY_BLOCKS`; `lib/survey/write.ts`; миграция 134 `updated_via`; «Мои ответы»; `lib/survey/modes.ts`), Ф3 (`lib/survey/calcs/*`, `calcsForKey`, `components/survey/FieldCalc.tsx`), контент `lib/survey/where-to-find.ts`.

**Параллельно в той же ветке:** агент Ф4 (ИИ-помощник: `lib/survey/assistant/**`, `app/api/v1/survey/assistant/**`, компоненты чата; может добавить кнопку «Помощник» в компоненты полей). Его файлы не трогаем; общие файлы (`app/client/onboarding/page.tsx`, `lib/events/registry.ts`, `components/onboarding/DocumentSuggestions.tsx`, `app/api/v1/onboarding/survey/route.ts`) — перечитать прямо перед правкой, править минимально, коммитить сразу и только своими путями.

## Главное решение PO (§18.3 п. 1)

«Анкета заполнена» = **только полная анкета**. Экспресс никогда не шлёт `final: true` → `QUESTIONNAIRE_COMPLETED`, `ONBOARDING_COMPLETED`, остановка бот-напоминаний и выход из комнаты ожидания остаются за отправкой полной анкеты (код отправки не трогаем). «Готово» в экспрессе = явное сохранение (`via: 'express'`) → `POST /api/v1/survey/express/complete` (событие `SURVEY_EXPRESS_COMPLETED` раз на клиента + уведомление назначенному эксперту «Первичная Точка А готова — проверьте») → `POST /api/v1/diagnostics/recalculate` → «Снимок бизнеса». Тест: контроллер экспресса не умеет отправлять `final`, маршрут `complete` не пишет `QUESTIONNAIRE_COMPLETED`.

## Решения

- **Контроллер ответов** `lib/survey/answers-controller.ts` — чистый (без React, `fetch` и хранилище передаются): состояние (ответы, изменённые ключи, происхождение `document|chat`, время правки ключа), `change`, `save({ via, step, autosave })` — сериализованные сохранения только изменённых ключей, зеркало полей компании в `POST /api/v1/onboarding/company` (как мастер), авто-год «месяц × 12» локально, снятие «изменён» только у ключей, не изменившихся за время запроса, ответ сервера с автором. `final` контроллер не отправляет вообще (только полная анкета).
- **Хук** `hooks/useSurveyAnswers.ts` (вынос из мастера, §13): загрузка (ответы + автор + компания), черновик (400 мс), автосохранение (2,5 с), повторы 4/12/30 с и при `online`, сохранение при `pagehide`, вопрос при закрытии вкладки. Используют экспресс и блоки. Мастер полной анкеты (`app/client/onboarding/page.tsx`) **не переписываем** на хук в Ф2: его параллельно правит Ф4 (кнопка «Помощник» кладёт значение в состояние мастера) — в мастере только минимальные правки (защита черновика, переключатель режимов). Перевод мастера на хук — отдельная задача.
- **Защита от устаревшего черновика (§6.1, §14.2):** черновик v3 хранит у каждого изменённого ключа время правки (`dirtyAt`); `mergeServerAndDraft(server, draft, serverUpdatedAt)` отбрасывает значение черновика, если ответ на сервере изменён позже (другой режим, эксперт, беседа), и возвращает `staleKeys` → плашка «Ответ изменён в другом режиме — показан новый». Черновик v2 (без времени по ключу) сравнивается по `saved_at`. Применяется в мастере и в хуке.
- **Переключение без потерь (§5.1 п. 4):** `switchSurveyMode` — сохранить несохранённое (если не удалось — не уходим), `PATCH preferences.survey`, событие `SURVEY_MODE_CHOSEN {from:'switch'}`, переход; новый режим перечитывает ответы с сервера. Переключатель в шапке мастера получает `onSwitch`.
- **Экспресс** `lib/survey/express.ts` (чистый): экраны из `EXPRESS_SCREENS` + вопросы реестра; на телефоне «один вопрос на экран» для трудных экранов (≥ 3 вопросов или вопрос с выбором из многих) — экран 13 «управление» и 15 «деньги» листаются по вопросу; «Готово — показать снимок» с 5-го экрана (после 4-го), главная кнопка после 15-го; итог экспресса (`answered / unknown / skipped`); расчёты после экранов 5, 11, 14, 15 — `calcsForKey` ключей экрана. Да/нет — две кнопки без значения по умолчанию.
- **Поле по реестру** `components/onboarding/shared/QuestionField.tsx`: выносим `Field` из `AnswerInlineEditor` (Ф1) — тот же рендер в «Мои ответы», экспрессе и блоках; `NumberField` (не знаю / примерно), чипы мультивыбора, да/нет без значения по умолчанию, шкала, длинный текст; «Не считаем» у текстового вопроса с `allowUnknown` (безубыточность); таблицы и файлы — ссылка «Заполнить в полной анкете» `/client/onboarding?step=N`. Подпись + `TermHint`, строка «зачем», короткая подсказка «где взять» (`whereToFind`, раскрывается).
- **Двойники (§7.6):** `lib/survey/twins.ts` — `twinOffer(key, answers)`: поле пустое, у двойника есть ответ → «Вы уже ответили на похожий вопрос: 6 ч/день. Подходит и здесь? [Да] [Изменить]»; запись только по «Да». Компонент `TwinOffer`.
- **Блоки** `lib/survey/blocks.ts`: прогресс блока («Заполнено 6 из 14 · ~4 мин осталось»; таблица/файл — тоже ответ), блок завершён; связь блока анкеты с блоками v4 (`SURVEY_BLOCK_V4`: b11/b10 → finance, b5/b10 → sales, b12/b13 → team, b4/b3/b6 → product, b15 → operations, b8/b9 → marketing, b2 → strategy); **рекомендуемые три** (§7.5): по неоценённым блокам v4 — (вес v4 × ожидаемый прирост покрытия из `upload_checklist`/`needs`, иначе 1 − покрытие) / минуты блока; блоки без связи с неоценёнными — по порядку; при равенстве и без снимка — Б10, Б11, Б5, Б12, Б4, Б2, остальные; уже заполненные блоки не рекомендуем.
- **Первичная Точка А** `lib/point-a/v4/primary.ts`: `isPrimaryPointA(blocks)` — хотя бы один из блоков v4 (не информационный) в `insufficient_data` → метка «Первичная · по быстрым данным» и подпись «Уточните блоки ниже, чтобы оценка стала полной». Показываем в «Снимке» и в шапке Точки А (`PointAHeader`, чип рядом с «Полнота данных»). Нет общего балла v4 → «Данных пока мало для общей оценки» + уже оценённые блоки; **v1-баллы в «Снимке» не показываем** (читаем только снимок v4).
- **Риск v1-нулей (§7.2, §17):**
  1. `lib/point-b/inputs.ts`: блоки без данных берём из блоков снимка v4 и тогда, когда строка `diagnostics` — v1-фолбэк (`engine: 'v1'`, но версия `…|v4`: у v4 нет общего балла). Сейчас в этом случае все пять v1-блоков (неотвеченное = 0) считаются «слабыми» → реалистичность цели падает на ступень.
  2. Reality Check (`/api/v1/gri/reality-check`): контекст строит `lib/assistant/context.ts` («Гри», не трогаем) из строки `diagnostics`, где у блока без v4-оценки лежит v1-блок (`toCompatPointA`). Маршрут дочитывает последний снимок, `computeRealityCheck` получает `blocksWithoutData`: такие блоки не сравниваются с самооценкой, реалистичность пересчитывается тем же `assessRealism` без них, индекс здоровья v1-фолбэка не сравнивается. Тесты на оба места.
- **Уведомление эксперту:** `lib/survey/express-complete.ts` — назначенный эксперт (`user_assignments.assignee_id`), иначе все с `clients.review`; `notifyStaff` уровня INFO, `dedupeKey: survey.express.completed:<user>` (раз на клиента), ссылка на User 360. Никогда не бросает.
- **События (§15):** в словарь — `SURVEY_EXPRESS_STARTED` (client), `SURVEY_EXPRESS_COMPLETED` (server, раз на клиента, `{answered, unknown, skipped, minutes}`), `SURVEY_SNAPSHOT_VIEWED` (client, `{point_a_ready}`), `SURVEY_BLOCK_OPENED` (client, `{block}`), `SURVEY_BLOCK_COMPLETED` (server: маршрут сохранения при `via: 'express'`, когда все ключи блока получили ответ; раз на блок), `SURVEY_CALC_EXPANDED` (client — «Как посчитано» в экспрессе/блоках/снимке).
- **Режимы:** `SURVEY_MODES_BUILT = ['full', 'express']` — карточка «Экспресс + блоки» работает, когда `NEXT_PUBLIC_SURVEY_MODES` включает `express`; без флага у клиентов ничего не меняется.
- **Маршруты:** `/client/onboarding/express`, `/client/onboarding/snapshot`, `/client/onboarding/blocks`, `/client/onboarding/blocks/[block]` — под тем же разделом «Анкета» (`activeClientNavKey` — самый длинный префикс; доступ до одобрения — как у `/client/onboarding/answers`). Своей «липкой» шапки сверху нет (панель кабинета на подпутях липкая) — только нижняя панель «Далее».
- **Превью:** `/dev/survey-preview?mode=express|snapshot|blocks[&screen=N|&block=bN]` на фикстуре, без сети.

## Задачи

### Task 1: Черновик со временем по ключу и защита от устаревания
- Modify `lib/survey/draft.ts` (v3: `dirtyAt`; `mergeServerAndDraft(server, draft, serverUpdatedAt?)` → `staleKeys`), `app/client/onboarding/page.tsx` (минимально: время правки ключа в черновик, сравнение с `attribution.updatedAt`, плашка).
- Test `tests/unit/survey/draft.test.ts`: новее на сервере → берём серверный, ключ в `staleKeys`; черновик новее → остаётся; v2-черновик по `saved_at`; без времени сервера — как раньше.

### Task 2: Контроллер ответов и хук
- Create `lib/survey/answers-controller.ts`, `hooks/useSurveyAnswers.ts`, `lib/survey/mode-switch.ts`.
- Test `tests/unit/survey/answers-controller.test.ts` (in-memory сервер): только изменённые ключи; конверты «не знаю»/«примерно»; `via`; авто-год; зеркало компании; ключ, изменённый во время запроса, остаётся изменённым; ошибка → ключи не теряются; никогда `final`.

### Task 3: Экспресс, двойники, блоки, рекомендации, первичная метка (чистая логика)
- Create `lib/survey/express.ts`, `lib/survey/twins.ts`, `lib/survey/blocks.ts`, `lib/point-a/v4/primary.ts`.
- Test `tests/unit/survey/express.test.ts`, `twins.test.ts`, `blocks.test.ts`, `tests/unit/point-a-v4/primary.test.ts` (экспресс на фикстуре «заполнено» → 15/15 минимума и общий балл v4 по ≥ 3 блокам; «не знаю» маржи/долгов → финансы `insufficient_data`).

### Task 4: v1-нули — Точка Б и Reality Check
- Modify `lib/point-b/inputs.ts`, `lib/gri/reality-check.ts`, `app/api/v1/gri/reality-check/route.ts`; Create `lib/point-a/blocks-without-data.ts`.
- Test `tests/unit/point-a-v4/blocks-without-data.test.ts`, дополнить тесты Reality Check / Точки Б.

### Task 5: Завершение экспресса — событие и уведомление эксперту
- Create `lib/survey/express-complete.ts`, `app/api/v1/survey/express/complete/route.ts`; Modify `lib/events/registry.ts`, `app/api/v1/onboarding/survey/route.ts` (`SURVEY_BLOCK_COMPLETED`).
- Test `tests/unit/api/survey-express-complete.test.ts`: 401 без сессии; событие раз на клиента; уведомление назначенному эксперту с ключом дедупликации; `QUESTIONNAIRE_COMPLETED` не пишется.

### Task 6: Поле по реестру и экраны экспресса
- Create `components/onboarding/shared/QuestionField.tsx` (вынос из `AnswerInlineEditor`), `components/onboarding/express/{ExpressFlow,ExpressScreen,TwinOffer}.tsx`, `app/client/onboarding/express/page.tsx`; Modify `components/onboarding/DocumentSuggestions.tsx` (фильтр по ключам экрана).
- Test `tests/unit/survey/express-render.test.ts`: «шаг 5 из 15», `aria-labelledby`, да/нет без нажатой кнопки, «Не знаю», «зачем», «где взять», расчёт после экрана 5, «Готово» с 5-го экрана, предложение двойника.

### Task 7: «Снимок бизнеса»
- Create `lib/survey/snapshot.ts` (пять цифр, слепые зоны экспресса, что посчитала Точка А), `components/onboarding/express/BusinessSnapshot.tsx`, `app/client/onboarding/snapshot/page.tsx`; Modify `components/point-a-v4/PointAHeader.tsx` (чип «Первичная»).
- Test `tests/unit/survey/snapshot.test.ts`, `snapshot-render.test.ts`: пять цифр и «нет данных · ответить»; «Вы не знаете 3 из 26 цифр…»; «Первичная · по быстрым данным»; «Данных пока мало» без v1-баллов; «Считаем Точку А — до минуты»; три рекомендованных блока.

### Task 8: Блоки углубления
- Create `components/onboarding/blocks/{BlockList,BlockPage}.tsx`, `app/client/onboarding/blocks/page.tsx`, `app/client/onboarding/blocks/[block]/page.tsx`.
- Test `tests/unit/survey/blocks-render.test.ts`: шапка «зачем → что даст», время, прогресс, вопросы блока из реестра, таблица → ссылка на форму, двойник, «Следующий блок».

### Task 9: Режим включён, переключатель, превью, интеграционный тест
- Modify `lib/survey/modes.ts` (`SURVEY_MODES_BUILT` + `express`), `app/client/onboarding/page.tsx` (переключатель с `onSwitch`), `app/dev/survey-preview/*` (`?mode=express|snapshot|blocks`).
- Test `tests/integration/survey-modes-switch.test.ts`: полная → экспресс → полная через контроллер и in-memory сервер — ничего не теряется (включая «не знаю»/«примерно», черновик другого режима не затирает); экспресс + блоки = 174 ключа ровно по разу; превью-тест.

## Проверка
`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, eslint по изменённым файлам, `npx vitest run tests/unit/survey tests/unit/point-a-v4 tests/unit/point-a tests/unit/goals tests/unit/api tests/integration/survey*` + новые. Без БД, без миграций (не нужны: путь `express` уже в миграции 134), без dev-сервера.

## Не делаем в Ф2
Кнопка «Помощник» и беседа (Ф4); перевод мастера полной анкеты на хук (риск конфликта с Ф4 — отдельная задача); значок режима у эксперта и воронка в GIGA (Ф5); таблицы и файлы внутри блоков — ссылка на форму полной анкеты.
