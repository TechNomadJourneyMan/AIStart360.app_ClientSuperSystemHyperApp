# Анкета, три режима — Ф4 «ИИ-помощник»: план реализации

**Spec:** `docs/superpowers/specs/2026-10-23-survey-three-modes-design.md` — §5.4, §8 (всё), §12, §13, §14, §15, §16 строка Ф4; **§18.3 (ответы PO) важнее предложений спеки**. Опора Ф1: реестр `lib/survey/questions.ts` (`chat: ask|form_only|skip`), `lib/survey/write.ts` (единый путь записи), миграция 134 (`updated_via` с путями `chat` / `helper`; `ai_conversations.surface` + `survey`; `ai_pending_actions.kind` + `set_survey_answer`). Контент «где взять» — `lib/survey/where-to-find.ts` (`whereToFindFor`).

**Параллельно в той же ветке:** Ф2 (экспресс, «Снимок», блоки, `useSurveyAnswers`, защита черновика). Файлы Ф2 не трогаем; общие (`lib/survey/modes.ts`, `lib/events/registry.ts`, `app/client/onboarding/page.tsx`, превью) — перечитываем перед правкой, правки минимальные, коммит только своих путей.

## Решения PO (зафиксированы)

- Беседа — чат: задаёт вопросы, объясняет вопрос, задаёт уточняющий вопрос на неконкретный ответ. Может вести **экспресс-набор или всю анкету — выбор в начале беседы**.
- **Бюджет:** новые и бесплатные — потолок **$0,5 на клиента** (сумма `ai_usage.cost_usd` с `feature='survey_assistant'`, настройка `survey_ai_budget_usd_per_client`); **PRO — без лимита, пока полная анкета не отправлена** (`isSurveyCompleted` по маркеру / событию `QUESTIONNAIRE_COMPLETED`); после отправки — обычный дневной лимит PRO (`assertAiBudget`). Персонал — обычный дневной лимит. Исчерпание — понятный русский текст, HTTP 200, режимы 1/2 и объяснения из реестра работают.
- Переписку читают назначенный эксперт и персонал с `survey.view`.

## Решения исполнителя

- **Ход беседы — сервер** (`lib/survey/chat/*`):
  - `next.ts` — очередь: экспресс в порядке экранов → (для «вся анкета») блоки в порядке Б10, Б11, Б5, Б12, Б4, Б2, остальные (детерминированный порядок §7.5 без снимка v4); пропуск отвеченных (и «не знаю»), пропущенных в беседе, `chat !== 'ask'`; `form_only` — один раз на блок ссылка «удобнее в форме». Переключение блока (`switch_block`) ставит блок первым.
  - `ask.ts` — вопрос шаблоном из реестра (`plain` / `label`, единица, варианты, «зачем»), без ИИ. Объяснение и «где взять» — из реестра (`why`, `term`, `whereToFindFor`), без ИИ.
  - `model.ts` — схема ответа модели (Zod + JSON Schema): `intent ∈ answer|unknown|approx|vague|question|switch_block|skip|escalate|off_topic`, `numbers[{raw, scale, period}]`, `options`, `bool`, `text`, `clarify`, `reply`, `block`. Вызов `chatWithOpenRouter` (`feature: 'survey_assistant'`, `complexity: 'low'` → уровень `light`, `jsonSchema` strict, таймаут 20 с, `privacySensitive`); не прошёл схему → один повтор `complexity: 'high'` (уровень `standard`). Стоимость пишет `chatWithOpenRouter` в `ai_usage`.
  - `guard.ts` — **проверка чисел**: число из ответа модели допустимо, только если его каноническая форма (`canonicalNumber`, плюс простые числительные «пять», «двадцать пять», «полтора») есть в сообщениях клиента по этому вопросу; масштаб (тыс/млн/млрд) — только если слово стоит в тексте клиента; период месяц↔год — только для `*_month`-ключей и при слове «год» в тексте (÷12 с пояснением в карточке). Числа в `reply`/`clarify` — `foreignNumbers` против чисел клиента, реестра и предложенного значения; чужое → шаблон.
  - `value.ts` — значение собирает сервер по типу из реестра: числа/деньги/% (диапазон → `approxAnswer` только у `allowApprox`), выбор — только из `options` реестра, да/нет, текст — **слова клиента как есть**; «не знаю» → `unknownAnswer()`. Проверка конверта той же схемой, что сохранение (`surveySaveBodySchema`), мат — `hasProfanity`.
  - `turn.ts` — один ход: быстрые действия и стандартные вопросы («что это?», «где взять?», «не знаю», «пропустить») без ИИ; иначе модель → намерение → детерминированная реакция (§8.2). Одно уточнение на поле; второе неконкретное → кнопки «примерно / не знаю / пропустить».
  - `budget.ts` — правило PO (выше), зависимости внедряются (тесты без БД).
  - `store.ts` — `ai_conversations` (`surface='survey'`, активная = последняя; «Начать заново» = новая), `ai_messages` (в `grounding`: ключ, намерение, вид сообщения, результат проверки чисел, область «экспресс/вся», блок), `ai_pending_actions` (`set_survey_answer`, `payload {question_key, envelope, via:'chat'}`, `preview {title, after, before, note, quote}`). Состояние беседы (область, пропуски, уточнения, текущий ключ) выводится из `grounding` сообщений — без новой колонки.
  - `apply.ts` — «Записать»: атомарный `claim`, повторная проверка конверта (или `edited_value` «Исправить» той же схемой поля), запись через `lib/survey/write.ts` (автор `user`, путь `chat`, авто-год, синхронизация целей), `SURVEY_ANSWER_CHANGED`. Маршрут `POST /api/v1/ai/actions/[id]` ветвится по `kind`.
  - `transcript.ts` — транскрипт для персонала (сообщения + карточки с исходом), только чтение.
- **Помощник у поля** — та же беседа с `focusKey`; карточка не создаёт `ai_pending_actions`: «Записать» кладёт значение в поле формы (`origins[key]='chat'` → путь `helper`), сохраняет обычное автосохранение. Хук `useSurveyChat` / `useFieldHelper` для любых экранов; слой `FieldHelperLayer` добавляет кнопку «Помощник» к подписям полей полной анкеты (как строка автора в `SurveyFieldLayer`, без правки форм).
- **«Позвать эксперта»** — `POST /api/v1/survey/chat/escalate` → `recordInbound` (путь «Сообщений») с префиксом «Вопрос по анкете: <подпись поля>»; событие `SURVEY_CHAT_ESCALATED`.
- **Безопасность:** слова клиента и ответы — только внутри `fenceUntrusted('client', …)` + `UNTRUSTED_DATA_RULES`; у модели нет инструментов и поля «ключ» — ключ задаёт сервер; `maskContacts` на всё, что уходит в модель; в контекст — только текущий вопрос и ≤ 6 последних сообщений по нему; `maskUserQuestion` на вход, `safeAnswer` на выход; лимиты `survey-chat-min` 12/мин, `survey-chat-hour` 150/ч; режим «от имени» — беседа недоступна.
- **Миграция 136** (не применяем; 135 — у Ф2): `ai_pending_actions.company_id` → NULL допустим (у нового клиента компании может не быть; до миграции карточка создаётся с компанией клиента, а без компании — понятная ошибка); ограничивающие RLS-политики: клиентский JWT не может писать в беседы `surface='survey'` и их сообщения (только сервер), чтение — только своих (053). Статический тест SQL.
- **Режим «Беседа»** — `app/client/onboarding/chat/page.tsx` (`SurveyChat`: десктоп — чат + панель «Анкета», телефон — на весь экран + шторка), `chat` в `SURVEY_MODES_BUILT`. Транскрипт у персонала — вкладка «Беседа с ИИ» (GIGA `SurveyTab`, кабинет эксперта). Превью `?mode=chat` — записанный сценарий, без сети.
- Настройки (группа «Контент», рядом с лимитами ИИ): `survey_chat_enabled`, `survey_ai_budget_usd_per_client` ($0,5). `AI_FEATURES.survey_assistant`. События `SURVEY_HELPER_OPENED` (client), `SURVEY_CHAT_PROPOSAL`, `SURVEY_CHAT_GUARD_BLOCKED`, `SURVEY_CHAT_ESCALATED`.
- **Не делаем в Ф4:** двойники в беседе (§7.6), рекомендации блоков по снимку v4 (порядок — детерминированный по §7.5), «сжатая формулировка» текста по просьбе, `survey_chat_model_tier`.

## Задачи

### Task 1: Ядро беседы (чистые функции)
- Create `lib/survey/chat/{types,next,ask,guard,value,model,turn}.ts`.
- Test `tests/unit/survey/chat-next.test.ts`, `chat-guard.test.ts`, `chat-value.test.ts`, `chat-turn.test.ts` (подменённый ответ модели: чужое число → нет карточки; инъекция → ключ не меняется; одно уточнение; быстрые действия без ИИ; повтор на `standard` при сбое схемы).

### Task 2: Бюджет, учёт, настройки, события
- Modify `lib/ai/usage.ts` (`survey_assistant`), `lib/settings/registry.ts`, `lib/events/registry.ts`.
- Create `lib/survey/chat/budget.ts`. Test `tests/unit/survey/chat-budget.test.ts` (free: потолок $0,5; PRO до отправки — без лимита и без дневного; PRO после — дневной; ошибка счётчика — fail-open) и запись `ai_usage` с `feature='survey_assistant'` (заглушка `fetch`, без сети).

### Task 3: Хранение, запись по «Записать», миграция 136
- Create `lib/survey/chat/{store,apply,transcript}.ts`, `supabase/migrations/136_survey_chat_rls.sql`.
- Modify `lib/chat/actions.ts` (тип `kind`), `app/api/v1/ai/actions/[id]/route.ts` (ветка `set_survey_answer`, `edited_value`).
- Test `tests/unit/survey/chat-apply.test.ts` (in-memory: запись только по «Записать», автор `user` / путь `chat`, авто-год, «Исправить» той же схемой, двойной клик, чужое действие), `tests/unit/survey/migration-136.test.ts`.

### Task 4: API беседы, эскалация, транскрипт персонала
- Create `app/api/v1/survey/chat/route.ts` (GET/POST), `app/api/v1/survey/chat/escalate/route.ts`, `app/api/giga-admin/users/[id]/survey-chat/route.ts`, `app/api/expert/clients/[id]/survey-chat/route.ts`.
- Test `tests/unit/api/survey-chat-route.test.ts`: без «Записать» `survey_answers` не меняется — по каждому намерению; чужое число; инъекция; бюджет исчерпан → 200 и текст; лимит частоты; транскрипт: назначенный эксперт — 200, чужой клиент / не назначенный — 403/404.

### Task 5: Интерфейс беседы и помощник у поля
- Create `components/onboarding/chat/{useSurveyChat.ts,SurveyChat.tsx,ChatMessages.tsx,ProposalCard.tsx,QuickActions.tsx,FieldHelperPanel.tsx,FieldHelperLayer.tsx,SurveyChatTranscript.tsx}`, `app/client/onboarding/chat/page.tsx`.
- Modify `lib/survey/modes.ts` (`chat` в `SURVEY_MODES_BUILT`), `app/client/onboarding/page.tsx` (слой «Помощник», `origins: 'chat'`), `components/giga-panel/user360/SurveyTab.tsx`, `app/(expert)/expert/clients/[id]/page.tsx` (вкладка «Беседа с ИИ») — минимально.
- Test `tests/unit/survey/chat-render.test.ts` (`renderToStaticMarkup`: `role="log"`, карточка с заголовком и кнопками, честная строка, транскрипт без кнопок).

### Task 6: Превью
- Modify `app/dev/survey-preview/page.tsx` (`?mode=chat`), create `app/dev/survey-preview/ChatPreview.tsx` + фикстура сценария.
- Test: фикстура сценария проходит проверку чисел (каждое число карточки есть в словах клиента).

## Проверка
`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, eslint по изменённым файлам, `npx vitest run tests/unit/survey tests/unit/ai tests/unit/api`. Миграцию 136 не применяем (при пуше в main: `node scripts/apply-migration.js supabase/migrations/136_survey_chat_rls.sql`; 134 — тоже, если ещё не применена).
