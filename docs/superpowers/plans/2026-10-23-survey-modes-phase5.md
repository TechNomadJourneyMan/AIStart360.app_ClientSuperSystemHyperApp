# Анкета, три режима — Ф5 «Эксперт и аналитика»: план реализации

**Spec:** `docs/superpowers/specs/2026-10-23-survey-three-modes-design.md` — §5.2 (значок режима у эксперта), §10 (сторона эксперта), §15 (события и метрики), §16 строка Ф5, **§18.3 (ответы PO важнее предложений спеки)**. Опора: Ф1 (реестр `lib/survey/questions.ts`, `lib/survey/write.ts`, `updated_via`, `SurveyAnswersView`, `lib/survey/modes.ts`), Ф2 (экспресс, «Снимок», блоки, `SURVEY_EXPRESS_COMPLETED` раз на клиента, `lib/point-a/v4/primary.ts`), Ф3 (расчёты), Ф4 (беседа, `lib/survey/chat/transcript.ts`, вкладка «Беседа с ИИ» у персонала).

**Цель Ф5:** эксперт и админ видят, каким способом клиент заполняет анкету и где он остановился; из ответа «через ИИ-помощника» — переход к месту беседы; воронка режимов в GIGA из `user_events`; режим в выгрузке Google Sheets и в напоминаниях; метка «Первичная» на `/client/home`; три режима согласованы при включённом флаге.

## Главное правило PO (§18.3 п. 1)

«Анкета заполнена» = **только отправка полной анкеты** (маркер `app_notifications`, `QUESTIONNAIRE_COMPLETED`, или все 12 шагов — `lib/survey/completion.ts`, SQL `admin_survey_completions()`). Экспресс — «первичная Точка А», не отправка. Во всех новых местах статус «полная отправлена / не отправлена» берётся из того же определения.

## Решения

- **Статус анкеты для персонала** `lib/survey/staff-status.ts` (чистое ядро + загрузчик):
  - факты: `profiles.preferences.survey` (режим, `chosen_at`, `switched_at`), события `SURVEY_EXPRESS_COMPLETED` (первое, `metadata {answered, unknown, skipped}`), `SURVEY_MODE_CHOSEN` (история переключений, последние 10), отправка полной анкеты (`admin_survey_completions()`; при ошибке RPC — `QUESTIONNAIRE_COMPLETED`);
  - `buildSurveyStaffStatus` → `{ mode, modeSince, express, fullSubmittedAt, stuckOnExpress, fullPending, history }`; `stuckOnExpress` = экспресс пройден, полная не отправлена;
  - подписи: «Заполняет: экспресс + блоки (с 23.10)», «Экспресс пройден 23.10 · первичная Точка А» (подсказка «24 из 26, 2 „не знаю“»), «Полная анкета отправлена 25.10» / «Полная анкета не отправлена»; без выбранного режима значка режима нет (старые клиенты заполняют полную);
  - фильтр списка `filterBySurveyStatus(rows, 'all'|'full_pending'|'stuck_express')`;
  - загрузчик `loadSurveyStaffStatuses(sb, ids)` — пачками по 100 id, события только `source ≠ impersonation/admin`; сбой чтения → `null` у статуса (список клиентов не ломается).
- **Значки** `components/survey/SurveyStatusChips.tsx` — один компонент для кабинета эксперта (список и карточка) и GIGA User 360 (шапка); токены дизайна, `title` с подробностями.
- **Кабинет эксперта:** `GET /api/expert/clients` отдаёт `survey` у каждого клиента; список — значки на карточке и переключатель «Все · Без отправленной полной анкеты · Застряли на экспрессе» (с числами); карточка клиента — значки в шапке.
- **GIGA User 360:** `GET /api/giga-admin/users/[id]/profile` отдаёт `surveyStatus`; значки в шапке; во вкладке «Анкета» — строка «Способ заполнения» с историей переключений.
- **От ответа к беседе** (§5.4, §10): у ответа с путём `chat` / `helper` в режиме персонала — кнопка «Открыть беседу». Чистая `lib/survey/chat/transcript-anchor.ts`: `findAnswerMessage(conversations, key)` — последняя применённая карточка этого ключа, иначе последняя карточка помощника у поля, иначе последнее сообщение о ключе; `transcriptMessageId(id)`. Транскрипт получает `focusKey`: сообщение помечено (`aria-current`, рамка), прокрутка к нему; не нашли — честная строка «Сообщение с этим ответом не найдено (беседа старше пяти последних)». GIGA `SurveyTab` и кабинет эксперта (`ExpertSurveyPanel` → `SurveyChatTranscriptSection` с управляемым `open`/`focusKey`).
- **Воронка режимов в GIGA** (раздел «Анкеты», панель «Способы заполнения»): `lib/survey/mode-funnel.ts` (чистая) + `GET /api/giga-admin/surveys/modes?days=30` (`survey.view`).
  - **Когорта:** клиенты, у которых первое `SURVEY_MODE_CHOSEN` попало в период (события из кабинета «от имени» не считаются).
  - **Шаги** (у каждого — число клиентов когорты, у которых событие было в любой момент после выбора; доля от когорты и от предыдущего шага): 1) выбрали режим → 2) начали экспресс (`SURVEY_EXPRESS_STARTED`) → 3) прошли экспресс (`SURVEY_EXPRESS_COMPLETED`) → 4) открыли «Снимок» (`SURVEY_SNAPSHOT_VIEWED`) → 5) открыли блок (`SURVEY_BLOCK_OPENED`) → 6) заполнили блок (`SURVEY_BLOCK_COMPLETED`) → 7) отправили полную анкету (`admin_survey_completions` / `QUESTIONNAIRE_COMPLETED`, время ≥ выбора режима). Нестрогая воронка: шаг не требует предыдущего (выбравший «Полную» сразу попадает в шаг 7) — подпись в интерфейсе.
  - разрез по первому выбранному режиму (полная / экспресс / беседа) и по текущему; переключения (`from: 'switch'`);
  - метрики §15: медиана минут экспресса (`metadata.minutes`), доля «экспресс → блок за 7 дней», беседа: карточки показано / записано / исправлено / пропущено, доля принятых без правки, отказы проверки чисел, передачи эксперту, «Помощник» у поля;
  - список «Без отправленной полной анкеты»: застрявшие на экспрессе (дней с экспресса) и выбравшие режим без отправки — с переходом в User 360. Список — в пределах клиентов сотрудника (`scopedClientIds`), агрегаты — платформенные, как у соседнего отчёта.
  - чтение `user_events` постранично (по 1000, не больше 20 страниц), только имена событий анкеты.
- **События §15:** все 12 есть в словаре и пишутся (Ф1/Ф2/Ф4). Тест-сторож: каждое событие §15 есть в `EVENTS` с нужным `client` и вызывается хотя бы в одном файле кода. Дыра: переключатель в беседе вёл `router.push` без сохранения выбора и без `SURVEY_MODE_CHOSEN` — `/client/onboarding` по сохранённому `mode: 'chat'` возвращал обратно в беседу. Теперь беседа переключает через `switchSurveyMode` (как экспресс и полная), стрелка «назад» — в кабинет.
- **Google Sheets:** три колонки **в конце** строки (не сдвигают существующие — Apps Script переписывает только заголовок и пишет значения по позиции): «Режим анкеты» («Экспресс + блоки с 23.10»), «Экспресс» («пройден 23.10 · 24 из 26» / пусто), «Путь ответов» («полная 40 · экспресс 20 · беседа 5 · помощник 2 · документы 3 · эксперт 1»). Маршрут сохранения читает `survey_answers.*` (путь — когда колонка 134 есть), `profiles.preferences`, событие экспресса.
- **Напоминания (`lib/automation/reminders.ts`, письмо + Telegram через `notifyClient`):** вход `survey: { mode, expressCompletedAt }`.
  - экспресс пройден, полная не отправлена → «Первичная Точка А готова — уточните её», три рекомендованных блока (`recommendedBlocks` без снимка), кнопка «Открыть блоки», упоминание полной анкеты;
  - режим «экспресс», экспресс не пройден → «Продолжите быстрый старт: отвечено X из 26», кнопка на `/client/onboarding/express`;
  - режим «беседа» → «Продолжите беседу с помощником», `/client/onboarding/chat`;
  - иначе — прежний текст «N из 12 шагов». Ключ дедупликации тот же (`survey_reminder:<стадия>:…`) — одно касание на эпизод. Напоминание анкеты теперь и тем, у кого шаг 1 пуст, но экспресс/беседа начаты.
  - Бот «Сообщений» (`lib/comm/bot.ts`, факты о пользователе): строка анкеты с учётом режима («быстрый старт пройден, первичная Точка А; полная анкета не отправлена»).
- **`/client/home`:** снимок Точки А читается с `blocks`; при `isPrimaryPointA` у плитки «Точка А» подпись «Первичная · по быстрым данным» (чистая `pointAStatHint`).
- **Флаг режимов:** `NEXT_PUBLIC_SURVEY_MODES=full,express,chat` — экран выбора с тремя карточками (без «Скоро»), старые клиенты с ответами → полная анкета + плашка, `?step=N` → полная, переключение из любого режима сохраняет выбор. Тест-сторож на эти правила с флагом.

## Как включить режимы (для PO / деплоя)

1. Применить миграции, если ещё не применены (правило PO — при пуше в main): `node scripts/apply-migration.js supabase/migrations/134_survey_answer_via.sql`, затем `136_survey_chat_rls.sql`. Без 134 запись работает (откат без колонки), но путь ответа не сохраняется; без 136 у нового клиента без компании карточка беседы не создаётся.
2. В Vercel → Settings → Environment Variables (Production и Preview): `NEXT_PUBLIC_SURVEY_MODES=full,express,chat` (можно `full,express` — без беседы). Переменная `NEXT_PUBLIC_*` вшивается при сборке — **нужен redeploy**, смены env без пересборки не достаточно. Локально — в `.env.local`.
3. Беседа: в GIGA → Настройки → «Контент» включены `survey_chat_enabled` (по умолчанию да) и бюджет `survey_ai_budget_usd_per_client` ($0,5); нужен `OPENROUTER_API_KEY`.
4. Проверка после деплоя: новый клиент видит три карточки; клиент с ответами — полную анкету и плашку «Новые способы заполнить»; ссылка из письма `?step=3` — полная анкета; переключатель в шапке любого режима открывает выбранный и не возвращает назад; в GIGA → Анкеты → «Способы заполнения» растёт когорта.
5. Выключить — убрать переменную (или оставить `full`) и пересобрать: выбор режима пропадает, сохранённые `mode` игнорируются (открывается полная анкета), ответы не теряются.

## Задачи

### Task 1: Статус анкеты для персонала (ядро)
- Create `lib/survey/staff-status.ts`, `components/survey/SurveyStatusChips.tsx`.
- Test `tests/unit/survey/staff-status.test.ts` (факты → статус, подписи, «застрял на экспрессе», фильтр, загрузчик на фейковой БД: события «от имени» не считаются, сбой RPC → `QUESTIONNAIRE_COMPLETED`), `staff-status-render.test.ts`.

### Task 2: Кабинет эксперта — список, фильтр, карточка
- Modify `app/api/expert/clients/route.ts`, `app/(expert)/expert/clients/page.tsx`, `app/(expert)/expert/clients/[id]/page.tsx`.
- Test `tests/unit/api/expert-clients-survey.test.ts` (у клиента `survey`; сбой загрузчика не ломает список).

### Task 3: GIGA User 360
- Modify `app/api/giga-admin/users/[id]/profile/route.ts`, `components/giga-panel/user360/types.ts`, `components/giga-panel/pages/User360Page.tsx`, `components/giga-panel/user360/SurveyTab.tsx` (строка «Способ заполнения»).

### Task 4: От ответа к месту беседы
- Create `lib/survey/chat/transcript-anchor.ts`; Modify `components/onboarding/answers/SurveyAnswersView.tsx` (`onOpenChat`), `components/onboarding/chat/ChatMessages.tsx` (id сообщения, выделение), `components/onboarding/chat/SurveyChatTranscript.tsx` (`focusKey`, управляемая секция), `components/giga-panel/user360/SurveyTab.tsx`, `components/expert/ExpertSurveyPanel.tsx`, `app/(expert)/expert/clients/[id]/page.tsx`.
- Test `tests/unit/survey/transcript-anchor.test.ts`, render: кнопка только у `chat`/`helper` и только у персонала; транскрипт с `focusKey` помечает нужное сообщение.

### Task 5: Воронка режимов в GIGA
- Create `lib/survey/mode-funnel.ts`, `app/api/giga-admin/surveys/modes/route.ts`, `components/giga-panel/surveys/SurveyModesFunnel.tsx`; Modify `components/giga-panel/pages/SurveysPage.tsx`.
- Test `tests/unit/survey/mode-funnel.test.ts` (когорта, шаги, нестрогость, «от имени», отправка до выбора не считается, метрики беседы, застрявшие), `tests/unit/api/giga-survey-modes-route.test.ts` (403 без права, список в пределах scope), render панели.

### Task 6: События §15 и согласованность режимов
- Modify `components/onboarding/chat/SurveyChat.tsx` (переключение через `switchSurveyMode`).
- Test `tests/unit/survey/events-spec.test.ts` (сторож §15), `tests/unit/survey/modes-flag.test.ts` (флаг `full,express,chat`: три карточки без «Скоро», старые → полная + плашка, `?step` → полная, сохранённый режим выключен → полная, переключение пишет выбор).

### Task 7: Google Sheets — режим и путь
- Modify `lib/survey/export.ts` (`SurveyExportMeta.survey`, три колонки в конце), `app/api/v1/onboarding/survey/route.ts` (`mirrorAndAnnounce` читает путь, режим, экспресс).
- Test: дополнить `tests/unit/survey/export.test.ts` (длина, позиции старых колонок не сдвинулись, подписи).

### Task 8: Напоминания и бот с учётом режима
- Modify `lib/automation/reminders.ts`, `lib/automation/data.ts` (`fetchSurveyModes`), `lib/comm/bot.ts`.
- Test `tests/unit/automation/reminders-modes.test.ts`, дополнить тест фактов бота.

### Task 9: «Первичная» на `/client/home`
- Create `lib/user-dashboard/point-a-hint.ts`; Modify `app/client/home/page.tsx`, `components/user-dashboard/UserHome.tsx`.
- Test `tests/unit/user-dashboard/point-a-hint.test.ts`.

## Проверка
`NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.json`, eslint по изменённым файлам, `npx vitest run tests/unit/survey tests/unit/giga-crm tests/unit/api tests/unit/events tests/unit/telegram tests/unit/automation tests/unit/comm tests/unit/user-dashboard` + новые. Без БД, без новых миграций (не нужны: всё читается из `user_events`, `profiles.preferences`, `survey_answers.updated_via` и RPC 090), без dev-сервера.

## Не делаем в Ф5
Оставшийся контент `whereToFind` (закрыт контент-агентом, 71 ключ); проверка расчётов экспертом и сравнение с отраслью (V2); ежедневные сводки эксперту (спека §10 — не добавляем); сегмент «застрял на экспрессе» в общем списке пользователей GIGA (RPC `admin_list_users` — отдельная миграция; список есть в панели воронки).
