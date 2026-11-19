# R5-AUDIT-B — сверка пунктов P3 и P4 реестра Раунда 0 и UX-проход платного клиента

**Дата:** 2026-11-19.
**Код:** `a2f33384`. Это main вместе с CRM PR #36, worktree только для чтения.
**Охват:** все 131 пункт реестра с приоритетами P3 и P4 (R-130…R-260). Их проверяют впервые с 2026-11-14.

**Как проверяли.** Только чтение: код, `git log 1344cde1..HEAD -- <путь>` и grep. Тесты, сборки, БД и Railway не запускались.
- Каждый пункт сверен с текущим кодом по месту из `where`. Номера строк в реестре успели сдвинуться, поэтому сверялась логика, а не номер строки.
- Пункты-счётчики пересчитаны заново.
- Двенадцать пунктов перепроверены выборочно, независимо от основной сверки: R-133, R-139, R-145, R-147, R-152, R-191, R-197, R-205, R-210, R-245, UX-08, UX-13. Расхождение одно: у UX-08 снижен приоритет (см. раздел 4).

**Прод.** Миграции применены до 154. CRM PR #36 и миграции 155–157 есть только на staging и ждут «да» PO. Поэтому всё, что исправлено только в PR #36, на проде ещё не работает.

**Решения PO, которые дефектами не считаются:**
- Точка А и Точка Б, Market и полный GRI доступны только платным клиентам, с честным пейволлом.
- Вход по приглашению.
- GRI считается по одной шкале 0–10.
- Заглушка оплаты оставлена намеренно.
- Маскот не трогаем.
- Лендинга на `/` нет.

---

## 1. Итог в цифрах

| Приоритет | Всего | Закрыто | Частично | Открыто | Неактуально | Проверить на проде |
|---|---|---|---|---|---|---|
| P3 | 93 | 7 | 17 | 65 | 2 | 2 |
| P4 | 38 | 5 | 9 | 23 | 0 | 1 |
| **Итого** | **131** | **12** | **26** | **88** | **2** | **3** |

Пояснения к таблице.
- **Открытые P3:** 6 из 65 ждут решений PO, кода по ним до решения не будет. Это R-202 и R-213 (Q12), R-215 (Q8), R-216 (Q20), R-217 (Q15), R-218 (Q21).
- **Открытые P4:** 5 из 23 — идеи развития, а не дефекты: R-253, R-256, R-257, R-259, R-260. Ещё R-247 ждёт решения PO.
- **Частичные P4:** R-252, R-254, R-255 и R-258 — тоже идеи, часть которых уже построена.
- **Закрыто P3:** R-132, R-133, R-134, R-140, R-147, R-151, R-197.
- **Закрыто P4:** R-223, R-228, R-231, R-234, R-235.
- Все закрытые пункты исправлены в Раундах 1–4, а они уже на проде. R-228 — миграция 141, она тоже на проде.
- **Неактуально:** R-206 (решение PO: маскот не трогать) и R-222 (CI гоняет весь набор тестов на Postgres).
- **Проверить на проде:** R-141, R-214, R-236.

**Новые находки UX-прохода:** 15 штук, из них P3 — 8 и P4 — 7. Ещё 9 дефектов на пути клиента уже есть в реестре.

---

## 2. Главное

- **Раунды 1–4 почти не тронули P3 и P4.**
  - Закрыто 12 пунктов из 131 (9 %), ещё 26 закрыты частично.
  - Раунды занимались P0–P2. Хвосты P3 закрывались попутно: безопасность ГИГА, health, CSP, impersonation.
  - В блоке расчётов R-165…R-189 не закрыто ничего: файлы `lib/survey/calcs/*`, `lib/point-b/model/*` и `lib/metrics/*` с `1344cde1` почти не менялись.
- **На балл Точки А v4 платного клиента по-прежнему влияют пять ошибок расчёта:**
  - «снизилась со 120 до 100» превращается в −120 % (R-168);
  - NPS из CRM читается как оценка по шкале 0–10 (R-169);
  - явный 0 считается пустым ответом (R-170);
  - за любое число сотрудников начисляется 10 баллов (R-171);
  - пороги 0,6 и 0,5 расходятся (R-237).

  Рядом ещё одна проблема: шаблонное «потери лидов ~30 %» видно в блоке v4 и в экспертном отчёте (R-172, R-173). Всё это закрывается одним пакетом размера M.
- **Дешёвые хвосты надёжности и безопасности, все размера S:**
  - Клиентский Telegram-вебхук без секрета принимает любые запросы, а код привязки действует бессрочно (R-139, файл не менялся).
  - Бронь письма сразу пишется со статусом `sent` (`lib/email/send.ts:147`). Если процесс упадёт до отправки, письмо больше не уйдёт (R-152).
  - Бюджет ИИ при ошибке чтения пропускает запрос (R-146).
  - Точка А решает, доступен ли ИИ, только по `OPENROUTER_API_KEY` в env (R-145). Если ключи заданы лишь в ГИГА (Alem/Qwen), ИИ-разбор молча не запустится. На проде стоит проверить, что переменная задана: только наличие, значение не смотреть.
- **R-210: вход по приглашению можно снять одним кликом.**
  - Переключатель режима регистрации стоит прямо над списком заявок в ГИГА и срабатывает без подтверждения (`components/giga-panel/RegistrationModeControl.tsx`).
  - Так же, без подтверждения, работают тумблеры авто-одобрения и гейтов.
  - Исправление дешёвое: диалог подтверждения.
- **Публичный `/gri-free` противоречит решениям PO.**
  - Обещает «полный разбор по 7 блокам сразу после» и «Доступ открыт → регистрация» (R-245).
  - Считает по значениям по умолчанию: маржа 40, LTV/CAC 3, «Далее» нажимается без ответа (R-182).
  - Кнопка «Узнать больше» ведёт на `/`, то есть на экран входа.
  - Туда сейчас ведут `/login`, `/register` и пейволл, поэтому это первое число, которое видит лид.
- **Тексты и названия в кабинете клиента не доведены:**
  - «GRI Assessment», «Critical/Warning», плейсхолдер «Manager», «(OpenRouter)» (R-190);
  - `/client/home` называется «Мой профиль» в четырёх местах (R-191);
  - заголовок вкладки по умолчанию — «AIStart360 — Institutional Intelligence», у 104 из 142 страниц нет title, из них 20 в `/client/*`, включая Точку А и Точку Б (R-192);
  - на главной выручка и цель показаны без «в год» (R-188).
- **CRM и «Пульс» (UX-03, UX-08, UX-12).** На проде раздел `pulse` закрыт для клиентов (`staff_only`).
  - Тем не менее NBA «Снять пульс» и ссылка из плана GRI на 90 дней ведут клиента на «Этот раздел недоступен».
  - В Настройках клиент может подключить Bitrix24 или amoCRM и включить «CRM-дайджест», хотя саму базу открыть не может.
  - При выкатке PR #36 раздел нужно открыть одновременно с кодом. Если раздел пока не открывают, карточку CRM и дайджест надо спрятать.
- **Документы (UX-13).**
  - Столбец «Куда внесено» говорит, что значение уже в анкете, хотя это лишь предложение до «Принять».
  - Шаг вычисляется по префиксу ключа, и `s3_*` подписан «Позиционирование» вместо «Работа с базой». Сам `lib/survey/steps.ts` прямо запрещает так делать.
- **Где реестр Раунда 0 ошибался или устарел:**
  - R-252 завышен: уведомление «Документ разобран» и таблица извлечённых полей были ещё до аудита.
  - R-207: список загруженных файлов на странице документов уже был.
  - R-196: IBM Plex используется в PDF, удалять его нельзя.
  - Счётчики выросли: `force-dynamic` в 491 файле (было 463), `select('*')` — 80 (было 77), `text-[11px]` — 925 (было 856), страниц без title — 104 (было 99).

---

## 3. Таблица статусов по всем 131 пунктам

Доказательства даны как путь от корня репозитория и строка в `a2f33384` или как sha коммита. «Не менялся» означает, что `git log 1344cde1..HEAD -- <путь>` пуст или в нём только посторонние правки.

| id | P | кратко | статус | доказательство | что осталось |
|---|---|---|---|---|---|
| R-130 | P3 | Отдельный вход владельца по паролю, e-mail в коде | открыто | `app/api/giga-admin/auth/route.ts:37-84` (маршрут на месте; с R0 только IP по R-049 и выход, 38a34ce3/9484597c); `lib/admin/owner-password.ts:16` и `lib/telegram/bots/go-live.ts:26` — e-mail владельца по умолчанию в коде | Удалить маршрут или требовать TOTP в нём (решение PO); e-mail только из env. Сейчас 2FA срабатывает лишь если она подключена или включён `staff_require_mfa` (`middleware.ts:701-708`); проверить на проде, что эта настройка включена |
| R-131 | P3 | `/.well-known/workflow/*` вне middleware, без подписи | открыто | `middleware.ts:397` и matcher `middleware.ts:859` по-прежнему исключают путь; обёртки с общим секретом нет (`next.config.mjs:2,163` — `withWorkflow`) | Закрыть путь извне или добавить общий секрет; сначала выяснить, используется ли Workflow на Railway |
| R-132 | P3 | Step-up cookie не привязан к сессии | закрыто | `lib/mfa/step-up.ts:10-22,61-70` (v3: userId + session_id GoTrue + запись 143); `middleware.ts:347-355` стирает чужое подтверждение; 38a34ce3, 3a83338b | — |
| R-133 | P3 | Аналитик видит PDF, финансы, e-mail без `users.sensitive` | закрыто | `app/api/giga-admin/reports/[id]/pdf/route.ts:21`, `reports/[id]/route.ts:28`, `requests/[id]/diagnostics/route.ts:17` требуют `users.sensitive`; `requests/route.ts:36-37` маскирует e-mail; лента уведомлений без e-mail (WB-2, 175b6e30) | — |
| R-134 | P3 | Выгрузка CSV пользователей без журнала аудита | закрыто | `app/api/giga-admin/users/export/route.ts:72-86` — `recordAdminAction(..., { required: true })`, без журнала 503; 38a34ce3 | — |
| R-135 | P3 | CSP `unsafe-inline`, cookie не httpOnly, `*.supabase.co` | частично | Шаблон `*.supabase.co` убран, `connect-src` только из `NEXT_PUBLIC_SUPABASE_URL` (`lib/security/csp.mjs`, `next.config.mjs:63-73`, 38a34ce3; на проде подтверждено оркестратором) | `script-src 'self' 'unsafe-inline'` остаётся (`lib/security/csp.mjs:15,115-116`); cookie сессии @supabase/ssr по-прежнему не httpOnly; nonce-CSP не сделан |
| R-136 | P3 | Share-ссылки без срока, живут после снятия эксперта | частично | Новые ссылки на 90 дней (`lib/share/tokens.ts:72`, `app/api/share/route.ts:117`, 9484597c); отзыв при снятии назначения (`lib/admin/client-actions.ts:200`, `lib/admin/bulk-users.ts:192`), блокировке и архиве (`app/api/giga-admin/users/[id]/block/route.ts:111`, `archive/route.ts:68`) | Старые ссылки без срока не тронуты (Z1); снятие staff-роли (`app/api/giga-admin/users/[id]/staff-role/route.ts`) ссылки не отзывает |
| R-137 | P3 | Текст клиентов в контексте staff-бота и автоответов | частично | Результаты инструментов, документы и медиа идут в `<untrusted_*>` (`lib/telegram/brain/engine.ts:71-94`, `media.ts:69,137`), бот только предлагает действия; в автоответах omnichannel инструментов нет, промпт помечает сообщения как данные (`lib/omnichannel/ai.ts:225-227`), есть категория `prompt_injection` (`guardrails.ts:19,53`); тесты: `tests/unit/telegram/bot-brain.test.ts:235-238`, `tests/unit/security/prompt-injection.test.ts`. Защиты были ещё до R0, с R0 только сужена область бота эксперта (3a83338b) | Нет теста, что внедрённая в анкету или входящее сообщение инструкция не приводит к предложению действия в боте персонала; принять как остаточный риск или добавить тест |
| R-138 | P3 | Анкета в Google Sheet, секрет опционален, e-mail в логах | частично | E-mail получателей в логах маскируется (`lib/email/send.ts:211,222,229,264,277` — `maskEmail`, 38a34ce3) | `GOOGLE_APPS_SCRIPT_SECRET` всё ещё опционален (`lib/integrations/google-sheets.ts:12-13,37`); на проде проверить доступ «Anyone» у таблицы и Apps Script |
| R-139 | P3 | Telegram-вебхук fail-open без секрета, код без срока | открыто | Файлы не менялись с R0: без `TELEGRAM_WEBHOOK_SECRET` клиентский `/start` принимается (`app/api/telegram/webhook/route.ts:52-56`), лимит по `chatId` из тела (`:109`), код 48 бит без срока (`lib/telegram.ts:34`) | 503 без секрета, как у ботов персонала; TTL кода 15 мин; на проде проверить, что секрет задан на Railway |
| R-140 | P3 | Таймаут чтения profiles = роль client | закрыто | `middleware.ts:220-255` (признак `unknown`), `:264-271` (страница 503 с автообновлением), `:487-492` (никаких догадок о роли); 38a34ce3 | Экран «Проверяем доступ…» сделан как 503-страница с обновлением через 10 с; этого достаточно |
| R-141 | P3 | Настройки ГИГА подписаны «общий пароль» | проверить на проде | В коде закрыто: вход по общему паролю удалён (`app/api/giga-admin/auth/route.ts:23`), настройки пишут личный `actor.id` (`app/api/giga-admin/settings/route.ts:61`, `settings/registration/route.ts:32`); подпись «общий пароль» осталась только для старых записей (`app/admin-giga-panel/settings/page.tsx:341-342`) | На проде посмотреть, остались ли в `system_settings.updated_by` значения `giga:%`, и включён ли `staff_require_mfa` |
| R-142 | P3 | Любая строка `staff_roles` проходит гейт ГИГА | открыто | `middleware.ts:688-699` — пускает любую роль персонала; права раздела проверяют только API, меню фильтруется по правам (`lib/admin/nav.ts:3,12`) | Гейт по праву раздела в middleware не сделан. По R0 это не дыра |
| R-143 | P3 | profiles читаются service-role «из-за рекурсии RLS» | открыто | `app/api/client/status/route.ts:13-33`; `app/(dashboard)/profile/page.tsx:24-25`; `app/(dashboard)/dashboard/page.tsx:248,266,322-347` | Хелпер SECURITY DEFINER для политики и чтение под сессией |
| R-144 | P3 | Rate-limit в той же БД, fail-closed при её сбое | открыто | `lib/rate-limit.ts:1-29,144-153` — без Upstash в проде используется Postgres, запасного хранилища в памяти нет (с R0 только мелкая правка, 38a34ce3); `app/api/telegram/webhook/route.ts:109` — `/start` под лимитом тихо отвечает 200 | Upstash или запас в памяти; на проде проверить, заданы ли переменные Upstash |
| R-145 | P3 | Доступность ИИ решает env `OPENROUTER_API_KEY` | частично | `lib/ai/gateway.ts:113-115`, `lib/ai/openrouter.ts:166` учитывают маршруты из БД (`hasConfiguredChatRoute`); в маршруте пересчёта проверки больше нет | Точка А по-прежнему смотрит только env: `lib/point-a/snapshot.ts:193,209,432`, `lib/point-a/catch-up-batch.ts:24`, `lib/point-a/diagnostic-row.ts:150`; `hasConfiguredChatRoute` при холодном кэше отвечает false (`lib/ai/providers/router.ts:463-470`) |
| R-146 | P3 | `assertAiBudget` fail-open, проверка и запись не атомарны | открыто | `lib/ai/budget.ts:107-108` (`check skipped (fail-open)`), файл не менялся с R0 | Атомарный резерв; fail-closed для free |
| R-147 | P3 | Пишущий materialize через GET и с правом read | закрыто | `app/api/v1/metrics/materialize/route.ts:73-76` (запись только при `canManage`, иначе 403), `:111-120` (GET только отдаёт статус); 38a34ce3 | — |
| R-148 | P3 | Мёртвые маршруты API | частично | `/api/crm` и `/api/crm/sync` убраны в `archive/legacy-prisma-crm` (5cbcd0c6, PR #36; на прод ещё не выкачено); `hooks/usePulse.ts` удалён | Без вызовов из UI остаются `GET /api/pulse`, `/api/v1/assistant/{ask,feedback}`, `/api/v1/content`, `/api/v1/expert-comments`, `/api/v1/gri/trust`, `/api/v1/point-a/{benchmarks,segments,loss-map,retention-curve,top-table,insights/ai-generate}` (grep: 0 вызовов вне `app/api`); удаление — решение PO |
| R-149 | P3 | Маршруты с телом без Zod | частично | Пересчёт: из 218 маршрутов, которые читают тело, без Zod 76 (в R0 было 85 из 209, методика близкая). `v1/crm/clients*` и `checkout` теперь с Zod или без тела (`app/api/v1/crm/clients/route.ts:70`) | Без Zod: 20 маршрутов `giga-admin`, в т.ч. `settings`, `settings/access`, `settings/registration`, `users/[id]/billing`, `users/[id]/point-b/finmodel{,/verify}`; `v1/point-b/{monthly-facts,whatif,whatif/saved,whatif/saved/[id]/propose}`, `v1/crm/clients/import` (список в scratchpad `nozod-now.txt`) |
| R-150 | P3 | Тихие ошибки, пустые catch | частично | Ошибка пересчёта после анкеты теперь показывается клиенту (`app/client/onboarding/page.tsx:445-455`, Раунд 3) | Пересчёт: в `app/api` — 155 `catch {` и 161 `.catch(() => {}/undefined/null)`; в UI (`app` без `api` + `components`) — 227 `catch {` и 21 `.catch(() => {})`. Lint-запрета нет (`.eslintrc.json`). В `app/api/v1/journey/chat/route.ts:41-49` ошибка бюджета другого типа по-прежнему означает «можно». Форматы ответа не сведены |
| R-151 | P3 | `/api/health` делает SELECT 1 без кэша и таймаута | закрыто | `lib/health/platform.ts:51` (кэш 15 с), `:57-72` (таймаут), `:219-235` (одно вычисление за раз); 375f4977 | — |
| R-152 | P3 | Resend без таймаута, claim сразу `sent` | частично | Таймаут добавлен: `lib/email/send.ts:103-112,244` (`withTimeout`); 38a34ce3 | Бронь по-прежнему вставляется со `status: 'sent'` (`lib/email/send.ts:147`): если процесс упадёт между бронью и отправкой, письмо больше не уйдёт. Нужен статус `pending` |
| R-153 | P3 | Нет индексов на `company_id` и FK | открыто | В миграциях 140–157 нет новых индексов на `survey_answers.company_id`, `documents.company_id`, `profiles.approved_by` (в `001:128-169` только `user_id`) | На проде сверить с `pg_catalog`, затем `CREATE INDEX CONCURRENTLY` |
| R-154 | P3 | Гранты anon/authenticated по умолчанию — ALL | открыто | Глобального `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES` и `ALTER DEFAULT PRIVILEGES` нет; новые таблицы закрыты по одной (`142:43`, `143:86`, `145:116`, `151:57-58`, `154:67`) | Одна миграция с REVOKE и `ALTER DEFAULT PRIVILEGES` |
| R-155 | P3 | Нет ретенции журналов и событий | частично | Очистка `cron_runs` есть (`lib/cron/claim.ts:78-107`, вызов в `lib/ops/job-watchdog.ts:754-755`; 375f4977) | Нет очистки `metric_value_history`, `user_events`, `agent_events`, `platform_events`, `notification_deliveries`, `ai_usage_ledger`, `omnichannel_webhook_events`, `survey_answer_history`; сроки хранения решает PO |
| R-156 | P3 | ПДн (e-mail, телефоны) в миграциях и коде | открыто | В миграциях 099 и 062 значения на месте; e-mail владельца по умолчанию ещё в `lib/admin/owner-password.ts:16`, `lib/telegram/bots/go-live.ts:26` | Брать из env или `system_settings`; переписывать историю git — решение PO |
| R-157 | P3 | Бакет `documents` без миграции, корневые объекты-сироты | открыто | В 133 только `UPDATE ... public=false` (`133:40`), бакет `documents` не создаётся миграцией (`089:244` создаёт только `client-documents`); корневые объекты не переносились (по памяти — ждёт PO) | Инвентаризация и перенос или удаление (PO); бакет — в миграцию |
| R-158 | P3 | Layout на каждый рендер читает секции, факты, роли | открыто | Кэш только в пределах одного рендера (`lib/platform/sections.ts:30`, `lib/platform/facts.ts:25` — `requestCache`, был ещё до R0); кэша процесса нет | Кэш процесса на 30–60 с с инвалидацией из ГИГА |
| R-159 | P3 | Везде `force-dynamic`, нет `unstable_cache` | открыто | Пересчёт: `force-dynamic` в 491 файле `app/` (было 463), `unstable_cache` — 0 | `unstable_cache` для справочных данных |
| R-160 | P3 | N+1 при публикации задач, расхождениях, целях | открыто | `lib/point-b/strategy/tasks.ts:126-145` (UPDATE по одной строке в цикле); `lib/data-layer/sync.ts:137-145`; `lib/goals/survey-sync.ts:227-239` | Batch-upsert или RPC |
| R-161 | P3 | `select('*')` тянет широкие JSON | открыто | Пересчёт: 80 вызовов в `app` и `lib` (было 77); `lib/point-b/inputs.ts:117` — `diagnostics.select('*')`; `pb_plan_versions` — 7 | Явные проекции, в первую очередь `diagnostics` и `pb_plan_versions` |
| R-162 | P3 | Мост WhatsApp опрашивает портал каждые ~10 с | открыто | Код моста не менялся с R0; в простое опрос раз в 10 с (`services/whatsapp-web-bridge/portal-outbound-puller.mjs:214`, `portal-session-control.mjs:173,386-389`) | Long-poll или увеличить интервал в простое; судьба omnichannel — решение PO (Q12) |
| R-163 | P3 | Огромные клиентские страницы | открыто | Пересчёт строк: `/pulse` 1534 (было 1458), `GRIAssessment` 1448, `PointBView` 1015, настройки ГИГА 957, документы 836; `app/admin-giga-panel/layout.tsx:1` — `'use client'` | Серверный каркас и `dynamic()`; бюджет бандла |
| R-164 | P3 | Карточка клиента эксперта грузит весь список | открыто | `app/(expert)/expert/clients/[id]/page.tsx:100` — `fetch('/api/expert/clients')`; маршрут `app/api/expert/clients/[id]/` уже есть | Читать карточку по id |
| R-165 | P3 | Маркетинг: темп 2026 против расходов 2024 | открыто | `lib/survey/calcs/finance.ts:182` (`yearRevenue` = выручка в месяц × 12) против `:184` (`expenseOf(…, rev24)`), сверка `:198-201`; файл не менялся с 1344cde1 | Для сверки брать выручку 2024 (`reportingRevenue`), темп — только в строке «в год» |
| R-166 | P3 | Целевой чек подаётся как текущий | открыто | `lib/survey/calcs/goals.ts:179-185` (фолбэк на `s7_avg_check_target_kzt`), текст `:226` «Упрощённо: чек …»; `sales.ts:205-212` «При чеке …»; не менялось | В списке источников стоит «целевой средний чек (шаг 7)», но в самой строке слово «целевой» отсутствует. Нужна подпись в строке или запрос текущего чека |
| R-167 | P3 | «Кол-во менеджеров» сверяется со всеми сотрудниками | открыто | `lib/survey/calcs/team.ts:49-62,67,80-84`; `components/onboarding/steps/Step4OrgStructureForm.tsx:26`; не менялось | Переименовать колонку в «Людей в отделе» (S) или убрать сверку |
| R-168 | P3 | Рост из текста: «со 120 до 100» → −120 % | открыто | `lib/metrics/source-adapters.ts:83-95` (`parsePercentChange` берёт первое число); `lib/point-a-engine.ts:206-216` — живой путь v4: проверка `growth` (`:383-387`) идёт в балл Финансов | Распознавать «в N раз» и «с X до Y», иначе возвращать null |
| R-169 | P3 | NPS +5 из CRM читается как «5 из 10» | открыто | `lib/point-a/v4/extra-blocks.ts:100-109` (`tenScale = 0…10` также для `resolved.nps`) | Шкала 0–10 только для ответа анкеты, метрика из CRM — всегда −100…100 |
| R-170 | P3 | Ноль = «не отвечено» | открыто | Форма уже пишет null (`components/onboarding/shared/NumberField.tsx:15,83`, `DynamicTable.tsx:23,63` — так было и в R0). Движок по-прежнему: `extra-blocks.ts:45` (0 ч → «не указано»), `check-input-keys.ts:43` (`positive` для бюджета 0 %), `point-a-engine.ts:462-466` (цикл 0) | Явный 0 считать ответом (у старых данных возможны «тихие нули» — нужен флаг или миграция) |
| R-171 | P3 | 10 баллов «Команды» за любое число людей | открыто | `lib/point-a/v4/extra-blocks.ts:73-74`; `lib/point-a-engine.ts:232-243` (цель «измерима», если в тексте есть любая цифра), влияет на балл Стратегии `:606-613` | `team_size` сделать информационным; измеримость = число + единица |
| R-172 | P3 | Шаблонные «~30 %» и шаги всем подряд | частично | v4: быстрые шаги собираются только из рекомендаций слабых блоков (`lib/point-a/v4/summary.ts:41,64`). Остаётся: `lib/point-a-engine.ts:459` «CRM-система отсутствует — потери лидов ~30%» (виден в `components/point-a-v4/BlockDetailPanel.tsx:120` и в рисках «Главного»), `:640` в рисках v1; v1 `generateQuickWins` `:713-737` по-прежнему уходит в `quick_wins` (экспертные вкладки, `/dashboard`, контекст ассистента) | Убрать «~30 %» из текстов; v1 quick_wins в экспертных и legacy-экранах заменить на v4 |
| R-173 | P3 | «Отказы растут» по абсолютным числам | открыто | `lib/point-a-engine.ts:684-688`; v1-инсайты доходят до экспертного отчёта (`lib/reports/snapshot.ts:193,315` → `legacyFindings`) и `lib/point-a/overview.ts:267` | Сравнивать долю отказов от сделок за последний год |
| R-174 | P3 | Бенчмарки: «перцентиль» из курируемых оценок | частично | Р3 (d607228e): на карточке клиента подпись «Ориентир не проверен экспертом — сравнение предварительное» (`components/point-a-v4/SideCards.tsx:12,42-45`, `lib/point-a/v4/state.ts:132`), слова «перцентиль» в UI нет — ярлыки «Выше среднего / На уровне / Ниже среднего». Линейная функция осталась (`lib/point-a/benchmarks.ts:351`), маршрут `app/api/v1/point-a/benchmarks/route.ts:75,152` отдаёт `percentile` по строке diagnostics; алиасов отраслей 5 (`benchmarks.ts:298-304`) | Ярлык «Выше/ниже ориентира» вместо «среднего»; закрыть или перевести на v4 маршрут без вызовов из UI; квантили при n ≥ 30 (вместе с R-253) |
| R-175 | P3 | Легаси-пути Точки А (v3, aggregate, loss-map, narrative) | частично | narrative исправлен: 409 без официального балла (`app/api/v1/point-a/narrative/route.ts:80-83`), в ИИ уходит `official.overall` (`:112`). Маршруты `v3`, `aggregate`, `loss-map`, `retention-curve`, `segments`, `top-table` живы (за `gatePaidSection`), вызовов из UI нет (`components/dashboard/MetricBlockV3.tsx`, `hooks/usePointAAggregate.ts` никто не импортирует); курс 450 ₸/$ — `lib/point-a/v3/loss-map.ts:30` | Удаление или закрытие маршрутов — решение PO (вместе с R-148) |
| R-176 | P3 | База Точки Б: «не знаю»/0 → выручка 2024 | открыто | `lib/point-b/engine.ts:262-265` (`firstPos` по `s2_revenue_2025/2024…`); `lib/point-b/inputs.ts:102` (явный ответ s1 всегда получает текущий год, база никогда не устаревает); код совпадает с 1344cde1 | Период брать из `answered_at`; при «не знаю» — уровень 0 и честный «нет базы» |
| R-177 | P3 | «Примерно» теряется, все входы `fact` | открыто | `lib/survey/answer-value.ts:78` (`unwrapAnswer` разворачивает approx в value); `lib/metrics/source-adapters.ts` — confidence 0.9 одинаково (`SURVEY_CONFIDENCE`); `lib/point-b/model/inputs.ts:30,35,96` — `origin: 'fact'`; файлы метрик не менялись | approx и range в provenance, confidence × 0.7, полоса неопределённости по ширине диапазона |
| R-178 | P3 | Маркетинг: сценарий и касса по разным правилам | открыто | `lib/point-b/model/scenarios.ts:241-245` (прирост лидов × конверсия × CAC) против `lib/point-b/model/cash.ts:130-135` (`marketingOf`: новые клиенты × CAC или база ∝ выручке); правки Р1 касались только себестоимости | Одно правило (как в «что-если») |
| R-179 | P3 | «На курсе» при прогнозе ≥95 % | открыто | `lib/point-b/model/forecast.ts:17` `ON_TRACK_RATIO = 0.95`, `:104`; причина с процентом от цели была и в R0 (`:108`) | Ярлык «Почти на курсе (−N %)» для 95–99 % (S) |
| R-180 | P3 | Постоянные расходы: двойной счёт ФОТ/рекламы | открыто | `lib/point-b/finmodel/sources.ts:77-85` подставляет (аренда + прочие)/12 без пометки; подсказка «Без зарплаты и рекламы» в `lib/point-b/finmodel/keys.ts:64` была и в R0 | Помечать значение из анкеты как черновик «проверьте: без ФОТ и рекламы» |
| R-181 | P3 | Прогноз метрик: годовые точки → «Q1 '26» | открыто | `lib/metrics/forecast.ts:80-89` (нет ветки yearly, >45 дн. → quarterly), `:101-111` (`setMonth` без привязки к 1-му числу); Р1 (38a34ce3) добавил только порог ≥6 бизнес-периодов одного зерна (`:49,163-176`) | Брать зерно из `grainOf(period)`, а не из интервала; добавлять месяцы к 1-му числу (S) |
| R-182 | P3 | mini-GRI считает по значениям по умолчанию | открыто | `components/mini-gri/MiniGriWizard.tsx:120-127` (`DEFAULT_ANSWERS`: маржа 40, LTV/CAC 3, 6 мес., Да/Нет = false), «Далее» без `disabled` (`:299`); `lib/gri/logic.ts:116` (`ownerHoursWeekly \|\| 40`). Р1 перевёл только шкалу на 0–10 (38a34ce3). `/gri-free` публичен (`middleware.ts:428`), ссылки с `/login`, `/register` и из пейволла (`components/access/paywall-model.ts:72`). `/ai-scanner` теперь только для персонала (`middleware.ts:155-163`) | Блокировать «Далее» без выбора, «Не знаю» вместо дефолтов; `/ai-scanner` (staff) — подписать как другую методику |
| R-183 | P3 | Разные цветовые зоны GRI | частично | Р1/G1 (dcc00866): одна шкала и зоны `lib/format/gri.ts:36-41`, используются в `GRIAssessment.tsx:161`, `gri-data.ts:277-285`, `lib/gri/mini.ts:132`, `lib/portfolio-gri.ts:128` | В плане топ-5 свои пороги ≤3/≤7 → «Критично/Высокий» (`lib/gri-calculator/top5-action-plan.ts:102-105`) не совпадают с зонами (<4/4–6/≥6) |
| R-184 | P3 | GRI: сохраняется оценка с одной секцией | открыто | `app/api/v1/gri/assessment/route.ts:34-42` (проверка только `scores` как объекта), `:113-115`; `lib/gri-assessment/score.ts:32-35` (среднее по непустым секциям) | Требовать 7/7 секций или флаг `partial`, без попадания в портфель (S) |
| R-185 | P3 | ИИ-инсайты: числа не сверяются, температура 0.6 | открыто | `lib/insights/ai-generator.ts:51-55,264`; Р1 добавил только официальную Точку А во вход (dcc00866). Единственный вызов — `app/api/v1/point-a/insights/ai-generate/route.ts`, из UI его не вызывают | Низкий риск, пока нет UI; при включении — сверка чисел и temperature ≤ 0.2 |
| R-186 | P3 | Единица метрики угадывается регэкспом | открыто | `lib/metrics/registry.ts:50-60` (`inferUnit`); `lib/metrics/resolver.ts:80-88` (для «%» допускается всё до ±10 000); оба файла не менялись | Явный unit у всех метрик плюс тест-инвариант |
| R-187 | P3 | GRI-самооценка: нет якорей, вывод после 1–2 ответов | открыто | `components/gri/assessment/GRIAssessment.tsx:284-287` (только «1 — слабо / 10 — сильно»), вердикт зоны при `avg > 0`, то есть с первого ответа (`:1113`, `:292-298`) | Якоря на 1/4/7/10; вердикт — от ≥60 % вопросов блока; «Не знаю» |
| R-188 | P3 | Суммы на главной без периода | открыто | `lib/user-dashboard/summary.ts:123-124` (берётся годовой ключ, клиент вводил сумму в месяц); `components/user-dashboard/UserHome.tsx:158-159` — подписи «Выручка» и «Цель · 12 мес» без «в год», подсказка «из анкеты». Фолбэк `s9n_revenue_2024` показывается без года | Подписать «в год» / «в месяц», основной цифрой — как ввёл клиент (S) |
| R-189 | P3 | GRI ориентирован на «$2M/год» | открыто | `components/gri/assessment/GriRadar.tsx:47` «Эталон $2M»; `GRIAssessment.tsx:540,841,847,854,895`; `lib/gri-assessment/sections.ts:399,441` | Ориентир = цель клиента в ₸ (или нейтральный «эталон 10/10») |
| R-190 | P3 | Английский в интерфейсе | частично | `components/gri/GriScoreDial.tsx:15-24` + `lib/format/gri.ts:37-40` (статусы GRI теперь «Критично/Развивается/Устойчиво/Отлично», dcc00866); `app/(dashboard)/analytics/page.tsx:48` «Средний GRI (из 10)» | Осталось: «GRI Assessment» в клиентских местах (`components/layout/Header.tsx:46`, `components/user-dashboard/GriSection.tsx:59-67`, `components/metrics/MetricsPageClient.tsx:769-770`, `components/giga-panel/pages/GriPage.tsx:45`); «Critical/Warning» (`MetricsPageClient.tsx:874-878`); плейсхолдер «Manager» (`components/settings/SettingsClient.tsx:158`); «AI-инсайты (OpenRouter)» (`components/settings/AssistantSettingsPanel.tsx:60`); «Определи… пройди GRI» на «ты» (`components/dashboard/GrowthSnapshotHero.tsx:821`); staff: «Expert Portal» ×13 (`components/layout/ExpertSidebar.tsx:41`, `ExpertHeader.tsx:32,71`, страницы `/expert/*`), «Platform Control Center» (`components/giga-panel/WorkspaceContext.tsx:29`), «Overall Score» (`app/(expert)/expert/clients/[id]/page.tsx:320`, `components/expert/tabs/DashboardTab.tsx:94`), «Portfolio GMV / Active Clients / Churn Rate / Client Performance / Export CSV» (`app/(dashboard)/analytics/page.tsx:49-51,127-128`), «Dead-letter» (`components/giga-panel/agents/AgentsOverviewPage.tsx:86`); мёртвая константа `GRI_LEVEL_LABELS` (`lib/utils.ts:57-61`) |
| R-191 | P3 | `/client/home`: «Главная» vs «Мой профиль» | открыто | `app/client/home/page.tsx:18` (title «Мой профиль»); `lib/navigation.ts:17`; кнопки «назад» `components/client/messages/ClientMessages.tsx:130`, `app/client/content/page.tsx:23`; в новом кабинете «Главная» `lib/client-shell/nav.ts:41` | Переименовать в «Главная» в 4 местах |
| R-192 | P3 | Title: английский, дубли бренда, страницы без title | открыто | `app/layout.tsx:37-39` (по умолчанию «AIStart360 — Institutional Intelligence», шаблон `%s \| AIStart360`). Пересчёт: из 142 страниц `app/**/page.tsx` без title (ни в странице, ни в layout сегмента) — 104 (было 99), из них `/client/*` — 20 (было 17: в т.ч. `client/point-a`, `client/point-b`, `client/onboarding/*`, `client/waiting-room`); бренд в title страницы → дубль — 14 (было 13: `client/home`, `client/messages`, `client/content`, `metrics`, `register`, `privacy`, `terms`, `gri-free` и др.) | Русский title по умолчанию; убрать бренд из title страниц; `metadata` в layout сегментов `/client/*` |
| R-193 | P3 | Термины без объяснения, TermHint только в анкете | открыто | `TermHint` импортируют только `components/onboarding/**` (grep); меню `lib/client-shell/nav.ts:46` — просто «GRI»; `components/market-analysis/MarketDataPanel.tsx:196-198` — TAM/SAM/SOM без пояснения | Перенести `TermHint` в `components/ui`, «Индекс роста (GRI)» в меню, подсказки на TAM/SAM/SOM, CAC/LTV |
| R-194 | P3 | Настройки: «Команда»-заглушка, имя env, пустая «Организация» | открыто | Файл не менялся по сути (3a83338b — только блок impersonation). `components/settings/SettingsClient.tsx:104-106` (вкладка «Команда» — `ComingSoon`); `components/settings/TelegramLinkPanel.tsx:97-100` «Для ссылки на аккаунт задайте TELEGRAM_PERSONAL_USERNAME» — панель под всеми вкладками (`app/(dashboard)/settings/page.tsx:68-75`) у любого пользователя; «Организация» читается из `profiles.organization`/metadata, не из компании (`settings/page.tsx:55`) | Скрыть текст с именем env (или всю панель userbot) от клиентов; брать название компании из `companies`; «Команда» — решение PO |
| R-195 | P3 | Нет единого PageHeader / «назад» | открыто | Общего компонента для `/client/*` нет (есть только `components/layout/Breadcrumbs.tsx` и крошки ГИГА); частные ссылки «назад» были и в Раунде 0: `components/onboarding/blocks/BlockPage.tsx:44` «Все блоки», `app/client/content/[slug]/page.tsx:20-21` «Все материалы» | Единый `PageHeader` — по желанию, тупиков нет |
| R-196 | P3 | Шрифты: fallback, mono=Inter, TTF без preload | открыто | `tailwind.config.ts:76-79` (fallback Space Grotesk / DM Sans); `app/globals.css:13-26,35` (Bricolage TTF, `--font-mono: 'Inter'`); preload только Inter (`app/layout.tsx:71`). Поправка к реестру: IBM Plex Serif и JetBrains Mono используются в PDF (`lib/reports/fonts.ts:49-52`) — удалять нельзя | Bricolage → woff2 + preload, fallback привести к реальным шрифтам; `tabular-nums` вместо mono (решение PO по шрифтам) |
| R-197 | P3 | Ошибка панели блока без «Повторить» | закрыто | `components/point-a-v4/BlockDetailPanel.tsx:153-159,183` (`BlockLoadError` с «Повторить» → `live.refetch()`), d607228e | — |
| R-198 | P3 | Мелкий текст и маленькие цели касания | открыто | Пересчёт по `app/**`, `components/**`: `text-[9px]` 88 (было 90), `text-[10px]` 862 (было 853), `text-[11px]` 925 (было 856) — стало больше; крестик `components/popups/PopupCard.tsx:149` (`p-1` + `text-base` ≈ 24px), `components/expert/CommentSidePanel.tsx:103` (`p-1.5`) | Шкала 12/14/16+, цели касания ≥40px; начать с клиентских экранов |
| R-199 | P3 | «Инсайты Точки А» уводят в старую оболочку | открыто | `app/client/point-a/insights/page.tsx:11-13` — `redirect('/point-a/insights')` (страница в группе `(dashboard)`); 4792f703 трогал файл не по сути | Перенести ленту в `/client` или убрать вход |
| R-200 | P3 | Заглушки в меню: «Конкуренты», «Инсайты» эксперта | открыто | `lib/navigation.ts:38` и `components/layout/MobileNav.tsx:40` (staff «Конкуренты» → `app/(dashboard)/competitors/page.tsx:32` EmptyState); `components/layout/ExpertSidebar.tsx:15` → `app/(expert)/expert/insights/page.tsx:14-44` (честная заглушка «сводной ленты пока нет») | Скрыть пункты — нужно «да» PO; клиентов не касается |
| R-201 | P3 | Сиротские страницы и демо по URL | открыто | Все на месте: `app/(dashboard)/activity`, `ai-scanner`, `market/analysis`, `app/presentation` (публичная, `middleware.ts:420`), `app/client/onboarding/answers`, `app/client/scenarios` (WhatsApp-шаблоны «вашей клиники», «Назад» → `/client/dashboard-medical`, `app/client/scenarios/page.tsx:38-41,54-55`) — открыт любому клиенту (весь `/client/*`, `middleware.ts:192`), `app/client/dashboard-medical`, `app/client/onboarding-medical` (в OPEN_BEFORE_APPROVAL, `middleware.ts:186`). `/ai-scanner` уже только для персонала (`middleware.ts:162`) | Закрыть `/client/scenarios` и мед-страницы флагом/ролью; судьба медвертикали — решение PO (Q13 не принято) |
| R-202 | P3 | Четыре стека сообщений, два входящих в ГИГА | открыто (ждёт решения PO Q12) | `lib/comm`, `lib/omnichannel`, `lib/telegram`, `lib/whatsapp`, `services/whatsapp-web-bridge` на месте; в ГИГА «Сообщения» и «Instagram / WhatsApp» (`lib/admin/nav.ts:51,56`). Решения по Q12 в docs/памяти нет | План сведения после решения PO |
| R-203 | P3 | Дубли API ассистента и NBA | открыто | Живы `app/api/v1/ai/assistant/route.ts` и `app/api/v1/assistant/{chat,ask,converse,analyze,…}`; `app/api/v1/nba` и `app/api/v1/next-best-action` (у обоих есть вызов из UI); `ask`, `analyze` — без вызовов из UI | Свести в один API (L) — вместе с решением по легаси |
| R-204 | P3 | `/dashboard` клиента: >10 призывов | открыто | Состав клиентской ветки не изменился с Раунда 0: `app/(dashboard)/dashboard/page.tsx:385-482` — PointAQuickPills, NextBestActionCard, ShareButton, OnboardingStatusBadges, PointADashboardSummary, GrowthSnapshotHero, FirstRunWizard, KeyMetricsHero, MetricZonesGrid, CompanyDataCard, InsightsFeed, «Быстрый доступ» | Один главный шаг, остальное свернуть (M); проверить визуально |
| R-205 | P3 | Регистрация без телефона, «ООО» | частично | Под режимом приглашений вход идёт через форму «Запросить приглашение»: там «Телефон или Telegram — по желанию» и плейсхолдер «ТОО «Ромашка»» (`components/auth-home/InviteRequestForm.tsx:124,129-131`, a979c914) | В `components/auth-home/RegisterForm.tsx:153` всё ещё «ООО TechStart KZ», поля телефона/WhatsApp нет; «ООО «Компания»» в анкете `components/onboarding/steps/Step1CompanyForm.tsx:161` |
| R-206 | P3 | Маскот не виден из-за localStorage | неактуально (решение PO: маскот не трогать) | — | — |
| R-207 | P3 | Документы: нет шаблонов и «кто увидит» | открыто | Файл не менялся с Раунда 0 (`git log` пуст). Поправка к реестру: список загруженного был и есть (`app/client/onboarding/documents/page.tsx:420,664-668` «Загружено (N)»). Нет блока «кто увидит файлы» и шаблонов; «Перейти к диагностике →» ведёт на платную `/client/point-a` (`:828-830`) | Блок «Кто увидит ваши файлы», шаблоны; подпись кнопки «К Точке А» |
| R-208 | P3 | «Связаться с экспертом» → внешний tidycal | открыто | `https://tidycal.com/istart/gtm` в 6 местах: `components/dashboard/GrowthSnapshotHero.tsx:857`, `GRIDynamicsModal.tsx:339`, `GRIAssessmentRadarWidget.tsx:413,463`, `components/gri/page/GriResultPanel.tsx:153`, `components/gri/assessment/GRIAssessment.tsx:1372` | Заменить на `/client/messages` (решение PO по ссылке) |
| R-209 | P3 | Эскалации: смена статуса в строке без подтверждения | открыто | `components/giga-panel/pages/CasesPage.tsx:138-170` — три `<select>` сразу шлют `update()` без confirm/undo | Undo-тост или изменение через карточку |
| R-210 | P3 | Глобальные тумблеры над списком заявок | открыто | `components/giga-panel/RequestsModule.tsx:686` → `RegistrationModeControl`; смена режима регистрации (в т.ч. выход из «по приглашению») и тумблеры авто-одобрения/гейтов — одним кликом без подтверждения (`components/giga-panel/RegistrationModeControl.tsx:45-70,80-99,111-153`); API пускает только Super Admin | Подтверждение перед сменой режима; перенести в «Настройки», на странице — бейдж |
| R-211 | P3 | ГИГА: 41 пункт, два близких ИИ-раздела | открыто | `lib/admin/nav.ts:17-82` — 41 пункт; «Проверка выводов ИИ» и «Модерация ИИ» под одним `insights.moderate` (`:68-69`); палитра ⌘K есть (`components/giga-panel/CommandPalette.tsx`) | Группировка/сворачивание (M), слить два ИИ-раздела |
| R-212 | P3 | Недоделки Ф6 Точки Б | частично | Рабочие часы для инвайтов есть (`lib/point-b/invites/deliver.ts:11,61,80-92`) | Задачи, удалённые из новой версии, остаются в `action_items` (`lib/point-b/strategy/tasks.ts:10-11` «known limitation»); `stripMarkdown` в выгрузках Точки Б не найден — только запрет markdown в промптах (`lib/point-b/recs/ai.ts:79`, `strategy/ai-wording.ts:52`) |
| R-213 | P3 | Omnichannel однотенантный | открыто (ждёт решения PO Q12) | `lib/omnichannel/repository.ts` — 0 упоминаний `company_id`; `lib/omnichannel/equipment-sales-flow.ts` на месте; решения по Q12 нет | Решение PO: внутренний инструмент или мультитенантность |
| R-214 | P3 | Доставка писем/Telegram/WhatsApp не подтверждена | проверить на проде | В отчётах R4 доставка проверялась тестами (`R4-W1-VERIFY.md`), живой отправки клиенту нет | На тестовом клиенте прода: письмо Resend (приглашение/уведомление), сообщение клиентскому Telegram-боту, WhatsApp через мост; сверить `notification_deliveries`/`comm_*` статусы `sent`, а не `pending/failed` |
| R-215 | P3 | RAG по документам выключен флагом | открыто (ждёт решения PO Q8) | `.env.example:351` `ENABLE_DOCUMENT_EMBEDDINGS=` (пусто); проверка `lib/agents/definitions/document-intelligence.ts:277`; решения нет (известно лишь «ПДн пока в Амстердаме») | Решение PO; затем backfill |
| R-216 | P3 | Нет трафика на mini-GRI | открыто (ждёт решения PO Q20) | Решение PO принято только про лендинг (не переносить, `/` = вход); про `/gri-free` как вход рассылок — нет. В финале mini-GRI «Узнать больше» ведёт на `/` = экран входа (`components/mini-gri/MiniGriWizard.tsx:499-503`), «Получить полный GRI» → `/register` (при приглашениях — форма запроса, `:492-497`) | Решение PO; «Узнать больше» → aistart360.app |
| R-217 | P3 | ИИ-чат отвечает клиенту без эксперта | открыто (ждёт решения PO Q15) | `app/api/v1/ai/chat/route.ts` (302 строки; 375f4977 добавил только дедлайн) — ответ сразу клиенту, флаг `needs_expert` (`:199,231`) | Решение PO |
| R-218 | P3 | Гибкая настройка ИИ-агентов — только спека | открыто (ждёт решения PO Q21) | `ai_agent_profiles` нет ни в миграциях, ни в коде (grep); спека `docs/superpowers/specs/2026-11-02-ai-agents-flexible-config.md` | Ответы PO на 3 вопроса спеки |
| R-219 | P3 | Мёртвые и мнимые тесты | открыто | Три файла не менялись: `tests/integration/{ai-features,metrics-resolver,point-a-aggregate}.test.ts` пропускаются без `TEST_SUPABASE_*`, в CI этих переменных нет (`.github/workflows/ci.yml`); `point-a-aggregate.test.ts:226` тихий `if (!sb) return`, `:259` `expect(true).toBe(true)`. afa7460b усилил другие тесты (в т.ч. `survey-route`), но он по-прежнему на моках (10 `vi.mock` в `survey-route`+`expert-api`) | Перевести 3 файла на pg из CI или удалить (разрешение PO); убрать `expect(true)` |
| R-220 | P3 | Coverage только `app/actions` и middleware | открыто | `vitest.config.ts:49-53` — `include: ['app/actions/**', 'middleware.ts']`, порогов нет | `lib/**`, `app/api/**` + порог-трещотка |
| R-221 | P3 | Признаки flaky-тестов | открыто | `tests/integration/db/agent-runtime-fixes.test.ts:150` (400 мс), `:349` (300 мс) — реальные паузы; `tests/unit/documents/ocr-tesseract-real.test.ts` в общем проекте (`vitest.config.ts:54-61`); fake timers в 29 файлах против 135 с текущим временем | Fake timers/`vi.waitFor`, OCR в отдельный project |
| R-222 | P3 | Устаревший список «падений окружения» | неактуально | CI гоняет весь набор с Postgres-сервисом (`.github/workflows/ci.yml:48-74`, 98d9a837, afa7460b), «падения окружения» больше не нужны; теста `RFMSegmentsGrid` в репо нет | Обновить заметку `aistart360-test-env.md` в памяти (там всё ещё старый список) |
| R-223 | P4 | Регэксп статики пропускал страницы с `.js/.css/.map` | закрыто | `middleware.ts:133-134` (`STATIC_ROOT_FILE` только для файлов в корне), `middleware.ts:406-411` (+ `/fonts/`); 38a34ce3 | — |
| R-224 | P4 | `demo-access/cleanup`: оракул существования UUID | частично | `app/api/auth/demo-access/cleanup/route.ts:26` (один ответ `200 {ok:true}`), `:30` (лимит 10/мин по IP), `:59-71`; 38a34ce3 | Оракул закрыт. Удаление по-прежнему не привязано к сессии демо-пользователя: зная UUID демо-аккаунта, его может удалить кто угодно. Риск низкий, аккаунты одноразовые |
| R-225 | P4 | Мелкие правки безопасности (7 подпунктов) | частично | Закрыто: `app/api/v1/upgrade-request/route.ts:12,33` (Zod max 100, лимит 5 за 10 мин); `lib/ai/providers/client.ts:233,458,554,618` (`redirect:'manual'`); `lib/crm/bitrix24.ts:20` + `lib/crm/endpoint-guard.ts:145` (SSRF-охрана); `lib/cms/blocks.ts:25-28` (`/\evil.com`); 38a34ce3, 46f7327c | Восстановление из архива всегда ставит `approved` (`app/api/giga-admin/users/[id]/archive/route.ts:39`). В `lib/supabase-service.ts:1` нет `import 'server-only'`. `params.id` без проверки UUID и кодирования в `app/api/expert/comments/[id]/route.ts:54,64,86,93` |
| R-226 | P4 | Дублирующиеся индексы | открыто | В 140–157 нет `DROP INDEX`; `supabase/migrations/001_onboarding_system.sql:128,191`, `033_app_share_payments_leads.sql:89`. После Раунда 0 не трогалось | Снять `pg_stat_user_indexes` на проде, затем `DROP INDEX CONCURRENTLY` (нужно разрешение PO) |
| R-227 | P4 | Два BEFORE UPDATE-триггера на `profiles` | открыто | Оба на месте: `084_security_hardening.sql:135-136` (строгий) и `profiles_guard_privileged_columns` (`140_staff_rls_from_staff_roles.sql:197`). Тест на tier от сессии админа был и до Раунда 0: `tests/integration/db/security-hardening.test.ts:78` | Это риск, дефекта нет: дыра появится, только если удалить строгий триггер. Теста именно на «admin меняет role» нет |
| R-228 | P4 | Клиент мог писать в `ai_messages` от лица ассистента | закрыто | `supabase/migrations/141_ai_messages_client_insert_user_only.sql`: INSERT `WITH CHECK (role = 'user')`, политика FOR ALL удалена; 38a34ce3; на проде применены миграции до 154 | — (клиент может удалять свою историю — так задумано) |
| R-229 | P4 | `survey_answers.step = 0` хранит три разных сущности | открыто | `app/api/v1/companies/period-goals/route.ts:14-17`, `app/api/v1/gri/expert-notes/route.ts:56,113`, `app/api/v1/onboarding/medical/route.ts:161`; не трогалось | Отдельные ключи или таблица |
| R-230 | P4 | Тяжёлые кроны в одних и тех же окнах | частично | `analytics-rollup` перенесён на 21:30 (`lib/cron/schedule.ts:38`, 375f4977), `point-a-nightly` остался в 22:00 (`lib/functions/point-a.ts:36`) | В 04:00 UTC по-прежнему `crm-digest`, `agents-digest`, `client-digest` (`schedule.ts:32-34`) и `pb-monthly-checkpoint` (`lib/functions/point-b.ts:183`). `pb-recompute` идёт каждый час в :00 (`point-b.ts:157`) |
| R-231 | P4 | `analytics-rollup` со своей проверкой секрета | закрыто | `app/api/cron/analytics-rollup/route.ts:2,19-28` (`isAuthorizedCron`, без секрета 503); 38a34ce3 | — |
| R-232 | P4 | `lib/langfuse.ts` никто не импортирует | открыто | grep по `app/ lib/ components/` не находит ни одного импорта; зависимость осталась в `package.json:74` | Подключить или удалить вместе с зависимостью (нужно решение PO) |
| R-233 | P4 | `inngest.send` без проверки, настроен ли Inngest | частично | Отправка теперь ограничена по времени: `lib/inngest.ts:21-35,139-156` (375f4977, d157ae57), запрос не виснет | Проверки `inngestEnabled()` и запасного пути нет: `lib/comm/inbound.ts:109-111`, `lib/omnichannel/telegram-ingest.ts:127-128`, `app/api/webhooks/meta/route.ts:301`, `app/api/webhooks/whatsapp-web/route.ts:317`. Влияние низкое: свой Inngest настроен |
| R-234 | P4 | keyId `constructor` в подписи моста давал 500 | закрыто | `lib/omnichannel/whatsapp-web-signature.ts:180` (формат keyId), `:185` (`Object.hasOwn`); 38a34ce3 | — |
| R-235 | P4 | Impersonation-проверка ходит в БД на каждую мутацию | закрыто | `lib/impersonation/state-edge.ts:25,60` (кэш строки 15 с), `lib/impersonation/edge.ts:19-21`; 38a34ce3 | — |
| R-236 | P4 | Шум сканеров в error-логе | проверить на проде | В `middleware.ts` и `instrumentation.ts` нет ни фильтра, ни лимита на пробы | В логах Railway за сутки посчитать `ECONNRESET/aborted`, `Failed to find Server Action` и пробы `/.env`, `/actuator`. Если шум есть — фильтр или правило |
| R-237 | P4 | Порог «сильной стороны»: 0,6 против 0,5 | открыто | `lib/point-a/v4/engine.ts:251` (`confidence >= 0.6`), `lib/point-a/v4/summary.ts:43` (`>= 0.5`) | Одна константа |
| R-238 | P4 | `combine()` сужает диапазон, пропуская null-углы | открыто | `lib/survey/calcs/inputs.ts:124` (`continue`); не трогалось | Показывать «от X» без верхней границы |
| R-239 | P4 | «Быстрый» срок совпадает с базовым при недостижимой цели | открыто | `lib/point-b/model/scenarios.ts:371-375` (`gFast = Math.min(cap, …)`: при `g = cap` это базовый темп) | Пояснить в UI или не обрезать |
| R-240 | P4 | «Топ-5 ограничений» всегда пять | открыто | `lib/gri-calculator/top5-action-plan.ts:99` (`slice(0, 5)` без порога); после Раунда 0 не трогалось | Порог ≤ 6 |
| R-241 | P4 | Портфельный GRI: overall и блоки по разным выборкам | открыто | `lib/portfolio-gri.ts:113-122`: средние по разным подмножествам, `reportCount` один общий | n по каждому блоку |
| R-242 | P4 | «Дашборд» и «Дэшборд» вперемешку | открыто | «Дэшборд»: `lib/navigation.ts:20`, `components/layout/MobileNav.tsx:15,26`, `components/layout/ExpertSidebar.tsx:9`, `app/(dashboard)/dashboard/page.tsx:48`, `app/(expert)/expert/clients/[id]/page.tsx:50,239`, `components/dashboard/WidgetGrid.tsx:529`. «Дашборд» ещё в 4 местах | Одно написание. Файл маскота `MascotAssistant.tsx:80,87` не трогать |
| R-243 | P4 | «СИСТЕМА АКТИВНА» ни к чему не привязана | открыто | `components/layout/Sidebar.tsx:359` | Убрать или привязать к health (нужно разрешение PO) |
| R-244 | P4 | Тосты внизу справа перекрывают маскота и чат | открыто | `app/layout.tsx:83` (`position="bottom-right"`; `mobileOffset` 88px был и до Раунда 0, ce24e3fd) | `top-center` или отступ на десктопе. Сам маскот не трогаем |
| R-245 | P4 | mini-GRI обещает полный разбор «сразу» | открыто | `app/(public)/gri-free/page.tsx:46-47` («Полный разбор по 7 блокам открывается сразу после»); `components/mini-gri/MiniGriWizard.tsx:426,486-492` («Готово! Доступ открыт» → `/register`). Страница не трогалась | С учётом решений PO (вход по приглашению, полный GRI только для платных) обещание ещё дальше от правды. Текст: «3 блока сейчас, 7 — в платном кабинете», CTA «Запросить приглашение» |
| R-246 | P4 | Гость на несуществующем URL уходит на `/login` | открыто | `middleware.ts:733-737` (любой непубличный путь без сессии → `/login?from=…`) | Неизвестные маршруты → 404 до проверки входа |
| R-247 | P4 | `/journey` открыт гостю в dev, на проде — только по флагу | открыто | `middleware.ts:128-131,425`; `lib/journey/public-demo.ts:5` (`NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO === '1'`) | Нужно решение PO. На проде проверить, что анонимный GET `/journey` уходит на `/login` |
| R-248 | P4 | «Разрыв до 1Y: −₸4M/мес» | открыто | `components/dashboard/GrowthSnapshotHero.tsx:253-254` (факт − план), `:775`; `lib/format/kzt.ts:40-48` (формат «₸4M») | «До цели не хватает 4 млн ₸ в месяц» |
| R-249 | P4 | «Ctrl+Enter — отправить» на телефоне | открыто | `components/client/messages/ClientMessages.tsx:193` (без `hidden sm:inline`; на Mac работает и ⌘, а написано Ctrl) | Скрыть на touch, на Mac писать ⌘ |
| R-250 | P4 | Гигиена: `?userId=`, два хелпера, два health, `vertical.ts` | открыто | `app/client/waiting-room/page.tsx:81`, `app/client/onboarding/page.tsx:469` (`?userId=`); `lib/supabase-server.ts` (145 импортёров) и `lib/supabase/server.ts` (54); `app/api/health` + `app/api/healthz`; у `lib/vertical.ts` нет импортёров | Убрать параметр (S). Свести хелперы, удалить файлы — с разрешения PO |
| R-251 | P4 | Нет раздельных наборов тестов; Playwright поднимает `next dev` | частично | `vitest.config.ts:54-72` (проекты `tests` и `schema-changing`, 8fcf8ff7); CI в 3 параллельных job (`.github/workflows/ci.yml`, 98d9a837); `package.json:25` `smoke:prod` (a979c914) | Скриптов `test:unit`, `test:integration`, `test:changed` нет. Playwright по умолчанию запускает `npm run dev` (`playwright.config.ts:22-27`); `PLAYWRIGHT_BASE_URL` был и до Раунда 0 |
| R-252 | P4 | Внутренние агенты клиенту не видны | частично | Разбор документа виден клиенту: уведомление «Документ разобран, найдено показателей N» (`lib/notifications/product.ts:263-283`) и таблица «Взято из файла / Куда внесено» (`app/client/onboarding/documents/page.tsx:742`). Всё это было и до Раунда 0 (baf05ddc, b9d62048), то есть в R0 пункт завышен | Работа агента отчёта клиенту не видна (идея) |
| R-253 | P4 | Бенчмарки курируемые; модели V2 только в спеке | открыто | В `lib/point-b/model/` нет модели B2B, подписок или проектов (grep пуст). Бенчмарки клиенту скрыты решением PO | Идея V2. Делать после ≥30 компаний |
| R-254 | P4 | Удержание: контроль рекомендаций, автоотчёт, ранние сигналы | частично | План-факт, вердикт, сверка и чекпоинт — `lib/point-b/planfact/*` (967a5f4b, 3a608a8e, до Раунда 0). `notifyDeviation` сообщает эксперту об отставании, `remindReconciliation` напоминает клиенту (`lib/point-b/planfact/notify.ts`). Раунд 3 доработал помесячные факты (d607228e, ca6da52c) | Нет «помогло ли» по задачам, сигнала о кассовом разрыве клиенту, месячного автоотчёта клиенту (идея) |
| R-255 | P4 | Узкие места воронки: копилот эксперта, документы → анкета, импорт | частично | Значения из документа в анкету с подтверждением: `lib/documents/bind-fields-ai.ts`, `suggestion-decision-route.ts`. Выгрузки Kaspi/WB/Ozon/МойСклад: `lib/documents/marketplace-export.ts`. Оба — до Раунда 0. Копилот эксперта: ИИ-черновик разбора на проверку эксперту (миграции 150/152; d607228e, bf03ac13) | Импорта 1С и банковской выписки нет, анкеты голосом нет (идея) |
| R-256 | P4 | Аналитика: ансамбль прогнозов, сезонность, декомпозиция | открыто | У `lib/metrics/forecast-ensemble.ts`, `seasonality.ts`, `trend.ts` по-прежнему нет импортёров. В Точке Б своя десезонализация и run-rate (`lib/point-b/model/forecast.ts:10,49,88`) | Идея, не дефект. Делать после R-040 / R-080 / R-081 |
| R-257 | P4 | SLO и RUM: Web Vitals не собираются | открыто | Нет `useReportWebVitals`, `web-vitals` и замера event-loop (grep по `app/ lib/ components/ instrumentation.ts`). В Раунде 4 появились сторож кронов и health-проверки, но это не RUM | Идея, не дефект |
| R-258 | P4 | Staging-окружение для e2e и нагрузки | частично | Staging есть, но это только база и Supabase с обезличенной копией прода: `scripts/staging/*` (3a83338b), `docs/audit-2026-11/S.md`, `docs/deploy/runbook.md:33,87` («Staging — это база, а не деплой») | Сервисов `portal` и `agents` на staging нет, k6 и синтетики нет. Нужно решение PO по бюджету (Q17) |
| R-259 | P4 | UX-идеи: ⌘K, «маршрут» на главной, термины и т. д. | открыто | Палитра команд есть только в ГИГА (`components/giga-panel/CommandPalette.tsx`). На `/client/home` есть только прогресс анкеты (`components/user-dashboard/UserHome.tsx:136-142`), «маршрута» A → B нет | Идея, не дефект |
| R-260 | P4 | Новые функции: похожие бизнесы, QR-отчёт, запись к эксперту… | открыто | grep не находит ни одной из функций (QR есть только для 2FA и ГИГА) | Идея. Раунд после ≥30 активных компаний |

---

## 4. UX-проход платного клиента (по коду, без браузера)

Путь: `/client/home` → Точка А → Точка Б → Сообщения → Документы → Настройки / Интеграции → CRM (`/pulse`, «Ещё → Клиенты (CRM)»). Попутно — `/dashboard` (пункт «Дашборд» в меню платного клиента), потому что туда ведут карточки «Следующее действие».

Факт о проде, на который опираются находки UX-03, UX-04, UX-07, UX-08 и UX-12: разделы `metrics`, `simulator` и `pulse` в `platform_sections` закрыты для клиентов (`staff_only`). Источники: `docs/audit-2026-11/CRM-2026-11.md:9`, `<reports>/R4-B1.md:339`. Если клиент открывает такой раздел, middleware отправляет его на `/client/home?unavailable=<key>` с текстом «Этот раздел сейчас недоступен» (`middleware.ts:782-790`).

### 4.1. Новые находки (P3 — 8, P4 — 7)

| id | экран | проблема (что видит клиент) | доказательство (путь:строка) | приоритет | размер |
|---|---|---|---|---|---|
| UX-01 | `/client/home` «Что дальше» | Карточка называется «Путь клиента (CJM)» с подписью «Где клиенты теряются и что исправить». Ведёт она на `/client/journey`, а это экспериментальное рабочее пространство AI Journey с «Демо-логикой». Карты пути клиента там нет. Показывается ли карточка на проде, зависит от `platform_sections.cjm`, поэтому **проверить на проде** | `supabase/migrations/074_cms_platform_sections.sql:88`; `app/client/home/page.tsx:118` (`cjm` в списке карточек); `app/client/journey/page.tsx:4` («alias for the isolated top-level experiment»); `components/journey/Workspace.tsx:358`. Рядом R-247 и R-203 | P3 | S |
| UX-02 | `/dashboard` «Следующее действие» | Если в Точке А есть красный блок, карточка пишет «Закройте красную зону: <блок Точки А>», а кнопка «Смотреть результат» открывает результат GRI (`/gri?tab=result`). Это другая методика и другая шкала: блока Точки А там нет | `lib/dashboard/next-best-action.ts:28-30` (это ярлык блока Point A), `:103-110` (href `/gri?tab=result`); `app/api/v1/next-best-action/route.ts:46`. Рядом R-203 (два NBA-движка) | P3 | S |
| UX-03 | `/dashboard` «Следующее действие» | Когда ничего срочного нет, карточка пишет «Отличная форма 🐾 — Снимите недельный пульс» и кнопкой «Снять пульс» ведёт на `/pulse`. На проде этот раздел для клиента закрыт, и он попадает на «Этот раздел недоступен». Ярлыки быстрого доступа на той же странице закрытые разделы фильтруют, а NBA — нет | `lib/dashboard/next-best-action.ts:124-131`; для сравнения фильтр `app/(dashboard)/dashboard/page.tsx:374-379`. См. UX-08 | P3 | S |
| UX-04 | Точка А, карточка «Мои данные» | Строка «Метрики N» ведёт на `/metrics`. На проде раздел закрыт для клиента, и с платной страницы он попадает на «Этот раздел недоступен». Хук скрытия ссылок на закрытые разделы есть и используется в старой панели, а здесь — нет | `components/point-a-v4/SideCards.tsx:89-92`; хук `hooks/usePlatformSections.ts:82`, применение `components/point-a/PointAQuickToolbar.tsx:31,119` | P3 | S |
| UX-05 | Точка А (весь экран) | Одна и та же функция названа по-разному на одной странице: «Разбор ИИ», но «Спросить AI», «Спросить AI о разделе», «гипотеза AI». На странице документов — «AI-система» | `components/point-a-v4/AiAnalysisCard.tsx:64`; `PointAHeader.tsx:127`; `BlockDetailPanel.tsx:44,73`; `app/client/onboarding/documents/page.tsx:533`. Рядом R-190 | P4 | S |
| UX-06 | Сообщения | Если переписка не загрузилась, лента пустая: нет ни «Загружаем…», ни заглушки, ни кнопки «Повторить». Ошибка видна только мелким красным текстом под полем ввода, как будто не ушло сообщение | `components/client/messages/ClientMessages.tsx:142` (при `error` лента ничего не рисует), `:191` (ошибка под полем) | P4 | S |
| UX-07 | Настройки → Интеграции, карточка «Магазин, маркетплейсы и аналитика» | Подзаголовок обещает: «Заказы, выручка… — в кабинет e-commerce и метрики». Кабинет e-commerce удалён 2026-09-24 (коммит `a7530069`), «Метрики» на проде клиенту закрыты. Клиент подключает маркетплейс и нигде в кабинете не видит его данных | `components/settings/IntegrationsPanel.tsx:158`; удаление `app/client/dashboard-ecommerce/page.tsx` в `a7530069` | P3 | S |
| UX-08 | CRM (`/pulse`) и GRI, «Пульс недели» | Еженедельный пульс GRI есть только внизу страницы CRM, в свёрнутом блоке. Пока `pulse` закрыт на проде, «Снять пульс →» из плана GRI на 90 дней, пятничное напоминание «Серия пульса…» и NBA (UX-03) ведут на «Этот раздел недоступен»: снять пульс клиент не может совсем. Поправка при сверке: пятничное напоминание срабатывает только при серии от 2 недель (`lib/automation/reminders.ts:310`), поэтому клиентам с закрытым разделом сейчас не уходит. Живые тупики — NBA и план GRI; приоритет снижен с P2 до P3. Когда раздел откроют, ссылка будет приводить на «Кому звонить сегодня», а пульс останется свёрнутым: параметра или якоря, который бы его раскрыл, нет | `app/(dashboard)/pulse/page.tsx:830-852` (`pulseOpen` = false, deep-link нет); `components/gri/page/Plan90Checklist.tsx:162-166`; `lib/automation/reminders.ts:316-319`; `lib/dashboard/next-best-action.ts:130` | P3 | S–M |
| UX-09 | CRM (`/pulse`), очередь «Кому звонить» и «В зоне риска» | Кнопка действия «Мониторинг» в строке очереди ничего не меняет в строке. Отметка живёт только до перезагрузки, видна лишь на вкладке «Карточка». Для клиента это мёртвая кнопка. В CRM-2026-11 это записано как известное («переключатель не сохраняется») — нужно решение: убрать или сохранять | `app/(dashboard)/pulse/page.tsx:905-916`, `:952-956`, `:1385` (в строке нет признака отметки); `docs/audit-2026-11/CRM-2026-11.md` («Переключатель «на контроле» не сохраняется») | P4 | S |
| UX-10 | Настройки → Интеграции, карточка «Каналы и сервисы» | WhatsApp показан как «Уведомления в WhatsApp — Скоро». При этом на вкладке «Уведомления» той же страницы привязка WhatsApp уже работает («Утренний CRM-дайджест приходит в WhatsApp») | `components/settings/IntegrationsPanel.tsx:484,493`; `components/settings/SettingsClient.tsx:764-767`. Блок «Скоро» в целом — R-194 | P4 | S |
| UX-11 | Настройки → Интеграции | Страница загрузки документов дважды названа «Файлы»: «загружайте выгрузки в «Файлы»» и ссылка «Файлы». В меню, на главной и в Точке А она называется «Документы» | `components/settings/IntegrationsPanel.tsx:149,205`; `lib/client-shell/nav.ts:51` | P4 | S |
| UX-12 | Настройки → Интеграции, карточка «CRM» + Уведомления | Подключить Bitrix24 или amoCRM клиент может всегда, а свою базу (`/pulse`) на проде открыть не может. Синк заводит клиентов в базу, которую владелец не видит. Во «Уведомлениях» ему предлагают «Утренний CRM-дайджест». API подключения проверяет только вход. Если код CRM выкатят раньше, чем откроют раздел `pulse`, клиент упрётся в это сразу. **Проверить на проде** порядок выкатки (CRM-2026-11, шаг 7) | `components/settings/IntegrationsPanel.tsx:82-89` (карточка CRM без проверки раздела); `app/api/v1/crm/connections/route.ts:17-20,44-47`; `components/settings/SettingsClient.tsx:766`; `docs/audit-2026-11/CRM-2026-11.md:9` | P3 | S |
| UX-13 | Документы, раскрытый файл | В столбце «Куда внесено» значение подписано так, будто оно уже записано в анкету («Финансы → Чистая прибыль»). На деле это только предложение: в анкету оно попадает, когда клиент нажмёт «Принять» в мастере. Шаг к тому же вычисляется по префиксу ключа: `s3_deals_2024` подписан «Позиционирование» (шаг 3), хотя вопрос стоит в шаге 5 «Работа с базой» | `app/client/onboarding/documents/page.tsx:780` (заголовок), `:222-226,240-245` (шаг по `^s(\d+)`); `lib/documents/survey-suggestions.ts:4-8` (это предложения); `lib/survey/steps.ts:14-16,93-96` | P3 | S |
| UX-14 | Документы, раскрытый файл | Поле «Модель» показывает клиенту технический идентификатор модели-парсера из `parsed_data.model_used`: имя вендора и модели на английском | `app/client/onboarding/documents/page.tsx:681,750-751` | P4 | S |
| UX-15 | Настройки → Уведомления | Заголовки столбцов переключателей на английском и в сокращениях: «In-app», «Email», «TG». Там же, на экране CRM, заголовок «GRI Pulse · Пульс готовности к росту» | `components/settings/SettingsClient.tsx:742-744`; `components/pulse/GriPulseWidget.tsx:245`. Рядом R-190 | P4 | S |

### 4.2. Уже в реестре (по пути встретилось, новыми не считаю)

- **R-191:** вкладка `/client/home` называется «Мой профиль — AIStart360», в «Сообщениях» кнопка «назад» тоже «Мой профиль». Места: `app/client/home/page.tsx:18`, `components/client/messages/ClientMessages.tsx:130`.
- **R-249:** на телефоне видна подсказка «Ctrl+Enter — отправить». Место: `ClientMessages.tsx:193`.
- **R-190:** «Пройти / Продолжить GRI Assessment» в `components/user-dashboard/GriSection.tsx:59-62`, title `/gri` «GRI — Growth Readiness Index» в `app/(dashboard)/gri/page.tsx:9`, название раздела «GRI Assessment» в `074_cms_platform_sections.sql:86`.
- **R-194:** вкладка «Команда» — заглушка, много «скоро», плейсхолдер «Manager». Места: `components/settings/SettingsClient.tsx:105,145-158,881-901`.
- **R-188:** «Выручка» на главной показана без периода. Место: `components/user-dashboard/UserHome.tsx:157`.
- **R-199:** `/client/point-a/insights` уводит в старую оболочку. Место: `app/client/point-a/insights/page.tsx:12`.
- **R-207:** на странице документов «Перейти к диагностике →». Место: `app/client/onboarding/documents/page.tsx:828-830`.
- **R-208:** внешний tidycal есть и на платном `/gri`: `components/gri/page/GriResultPanel.tsx:153`. Ещё 4 места — в `components/dashboard/*`.
- **R-174 / R-253:** клиенту показано «Сравнение с отраслью» с пометкой «не проверен экспертом». Места: `components/point-a-v4/SideCards.tsx:36-60`, `lib/point-a/v4/state.ts:335`.

### 4.3. Проверено, дефектов нет

- **Меню кабинета** (`lib/client-shell/nav.ts`, `components/client/ClientNav.tsx`). Все пункты ведут на существующие маршруты. Закрытые платные разделы помечены замком, скрытые разделы отфильтрованы. «Ещё» строится по видимости раздела. Колокольчик, «Настройки» и «Выход» работают.
- **`/client/home`.** Якоря `#expert` и `#gri` есть в обоих вариантах: платном и с пейволлом. Ссылки анкеты `?step=N`, «Все материалы» и `/client/content/[slug]` работают. «Разбор эксперта» показывает загрузку, ошибку с «Повторить» и пейволл. `PointADashboardSummary`: якоря `#pa-goals` и `#pa-attention` существуют, при ошибке есть «Повторить».
- **Точка А (`/client/point-a`, v4).** Работают: FeatureGate, скелетон, ошибка с «Повторить», «нет компании», «нет снимка». Ссылки `?step=review` и `?step=9` существуют в мастере. Якоря `#reports` и `#my-data` / `#files` докручиваются после загрузки. Есть PDF с понятными ошибками (402/404/403/401) и «Поделиться». Панель блока при ошибке даёт «Повторить» (R-197 закрыт).
- **Точка Б (`/client/point-b`).** Сервер возвращает пейволл. Все 8 вкладок существуют, deep-link `?tab=` проверяется по списку ключей. Ссылки «Заполнить в анкете», «Загрузить файл» и «Попросить эксперта» (`/client/messages`) работают. Ошибка расчёта остаётся внутри вкладки и даёт «Повторить». Статусы плана без выдуманных сроков: срок берётся из SLA, а если он прошёл — «команда об этом знает».
- **Сообщения.** Есть отправка, обработка ошибки отправки, пустое состояние и пометка канала. Срок ответа показывается только до ответа команды.
- **Документы.** Ошибки загрузки показаны, при `NO_COMPANY` есть ссылка в анкету. Работают повторная обработка и непроверенные цитаты. Ошибка обновления списка видна.
- **Настройки.** «Тариф и подписка»: заглушка оплаты честная (решение PO), выдуманных цен нет. Работают уведомления с откатом при ошибке, отключение 2FA и паскей с подтверждением. У интеграций есть состояния загрузки, ошибки и «нет компании».
- **CRM (`/pulse`).** Числа экрана берутся из базы: «нет данных» и «чек не указан» вместо подстановок. При ошибке очереди остальные вкладки работают. Брифинг показывает ошибки и лимиты. Английского и заглушек в `components/crm/*` нет. Подключение CRM на вкладке «CRM» и в Настройках идёт через один API.

---

## 5. Предложение для Раунда 5

Ниже открытые и частично закрытые P3/P4 вместе с находками UX, сгруппированные по экранам. Размеры: S — до полудня, M — 1–2 дня. Пакеты 1–6 видны клиенту, пакеты 7–9 — внутренняя работа.

### Пакет 1. Тексты и названия в кабинете клиента — все S, вместе около дня
- **`/client/home`:**
  - «Главная» вместо «Мой профиль» в четырёх местах (R-191);
  - «в год» / «в месяц» у выручки и цели (R-188);
  - «Пройти GRI» вместо «GRI Assessment» (R-190, клиентская часть).
- **title:** русский заголовок по умолчанию, бренд в заголовках страниц не дублировать, `metadata` в layout сегментов `/client/*`, включая Точку А, Точку Б и анкету (R-192).
- **Точка А:** функция ИИ должна называться одинаково, сейчас рядом «Разбор ИИ» и «Спросить AI» (UX-05).
- **Документы:** не показывать клиенту идентификатор модели (UX-14).
- **Сообщения:** убрать подсказку «Ctrl+Enter» на телефоне (R-249).
- **Настройки:**
  - убрать текст с именем env `TELEGRAM_PERSONAL_USERNAME`;
  - брать «Организацию» из компании;
  - перевести «Manager» и «(OpenRouter)» (R-194, R-190).
  - «In-app/Email/TG» → по-русски (UX-15);
  - «Файлы» → «Документы» (UX-11);
  - WhatsApp не помечать «Скоро» (UX-10).
- **`/dashboard`** (пункт «Дашборд» в меню клиента):
  - «До цели не хватает N млн ₸ в месяц» вместо «−₸4M/мес» (R-248);
  - одно написание «Дашборд» (R-242).

### Пакет 2. Тупики и ссылки в закрытые разделы — S
- **NBA на `/dashboard`:**
  - красная зона Точки А должна вести в Точку А, а не в `/gri?tab=result` (UX-02);
  - «Снять пульс» показывать только при открытом `pulse` (UX-03).
- **План GRI на 90 дней:** ссылку «Снять пульс →» показывать только при открытом разделе. Когда раздел откроют, ссылка должна разворачивать «Пульс недели» (UX-08).
- **Точка А, «Мои данные»:** ссылку «Метрики» прятать через уже существующий `usePlatformSections` (UX-04).
- **Интеграции:** убрать обещание «в кабинет e-commerce и метрики» (UX-07).
- **Сообщения:** состояние «не удалось загрузить переписку» с кнопкой «Повторить» (UX-06).
- **Документы:**
  - писать «Предлагаем внести», а не «Куда внесено»;
  - брать шаг через `stepForQuestionKey` (`lib/survey/steps.ts:218`), а не из префикса ключа (UX-13);
  - добавить блок «Кто увидит ваши файлы» и кнопку «К Точке А» (R-207).
- **Демо-страницы:** закрыть флагом `/client/scenarios` и медстраницы для обычного клиента (часть R-201).
- **Ссылки tidycal** (6 мест, одна константа) → `/client/messages` после «да» PO (R-208).
- **CJM-карточка на главной:** проверить на проде, видна ли она. Если видна, то либо переименовать, либо скрыть (UX-01).

### Пакет 3. Публичный вход `/gri-free` — S/M
- Честный текст: «3 блока сейчас, 7 — в платном кабинете» и кнопка «Запросить приглашение» (R-245).
- «Далее» не нажимается без ответа, «Не знаю» вместо значений по умолчанию (R-182).
- «Узнать больше» → aistart360.app.

### Пакет 4. Точность Точки А v4 — M
- R-168: «с X до Y» и «в N раз».
- R-169: шкалу NPS определять по источнику.
- R-170: явный 0 считать ответом. У старых данных возможны «тихие нули», нужен флаг.
- R-171: `team_size` без баллов, измеримость цели = число + единица.
- R-237: одна константа порога.
- R-172 и R-173: убрать «~30 %» из текстов, «Отказы растут» считать по доле.
- R-145: проверять доступность ИИ через роутер (`hasLlmKey`/`resolveCandidates`), а не через env.

### Пакет 5. Точка Б и подсказки анкеты
- **S:**
  - «Почти на курсе (−N %)» (R-179);
  - «от X» без верхней границы (R-238);
  - пояснение «ускорить нельзя» (R-239);
  - сверка маркетинга по 2024 (R-165);
  - подпись «целевой чек» (R-166);
  - столбец «Людей в отделе» (R-167).
- **M:**
  - честная база: «не знаю» → «нет базы», период из `answered_at` (R-176);
  - постоянные расходы как черновик «без ФОТ и рекламы» (R-180);
  - закрывать задачи, которых нет в новой версии плана (R-212).

### Пакет 6. GRI
- **S:**
  - пороги топ-5 из `GRI_ZONES` (R-183);
  - не сохранять неполную оценку (R-184);
  - топ-5 только для оценок ≤ 6 (R-240);
  - n по блокам в портфеле (R-241).
- **M:** якоря на 1/4/7/10, вывод по блоку от ≥ 60 % ответов, ориентир не «$2M» (R-187, R-189).
- **S:** прогноз метрик берёт зерно из `period`, чтобы годовые точки не превращались в «Q1 '26» (R-181).

### Пакет 7. ГИГА и персонал — S
- Подтверждение перед сменой режима регистрации и тумблерами гейтов, на странице заявок — только бейдж (R-210). **Первым в очереди.**
- Undo-тост в «Эскалациях» (R-209).
- Восстановление из архива возвращает прежний статус; проверка UUID у `params.id` в `expert/comments`; `server-only` в `lib/supabase-service.ts` (R-225, остаток).
- Отзывать ссылки при снятии staff-роли (R-136, остаток).
- Карточка клиента эксперта читается по id (R-164).

### Пакет 8. Надёжность и безопасность бэкенда — S
- R-139: без секрета вебхук отвечает 503, у кода привязки TTL 15 мин.
- R-152: бронь письма со статусом `pending`.
- R-146 + R-150: бюджет ИИ fail-closed для free, в т. ч. `journey/chat` (M).
- R-138: `GOOGLE_APPS_SCRIPT_SECRET` обязателен.
- R-130 + R-156: e-mail владельца только из env. Удаление маршрута входа по паролю — решение PO.
- R-131: выяснить, используется ли Workflow. Если нет — закрыть `/.well-known/workflow/*`.
- R-230: развести задачи в 04:00 UTC по минутам.
- R-250: убрать `?userId=`.

### Пакет 9. Тесты — S
- R-219: убрать `expect(true)` и тихий `return`.
- R-220: расширить `coverage.include`.
- R-221: fake timers в `agent-runtime-fixes`.

### Перед выкаткой CRM (PR #36)
- **UX-12.** Раздел `pulse` открыть клиентам одновременно с кодом. Если раздел не открывают — спрятать карточку CRM в Интеграциях и «CRM-дайджест» в Уведомлениях.
- **UX-09.** Решить судьбу кнопки «Мониторинг»: убрать или сохранять отметку.

### Проверки на проде (только чтение, до Раунда 5)
- R-141: остались ли `system_settings.updated_by` вида `giga:%`; включён ли `staff_require_mfa`.
- R-139, R-145: заданы ли `TELEGRAM_WEBHOOK_SECRET` и `OPENROUTER_API_KEY`. Проверять только наличие, значения не смотреть.
- R-138: доступ «Anyone» у таблицы и Apps Script.
- R-153: индексы по `pg_catalog`.
- R-236: шум сканеров в логах за сутки.
- R-247: анонимный GET `/journey` уходит на `/login`.
- UX-01: виден ли раздел `cjm` клиенту.
- R-214: живая доставка письма, сообщения в Telegram и в WhatsApp тестовому клиенту.

### Не стоит делать сейчас (парковать)
- **Производительность:** R-158, R-159, R-160, R-161, R-163. При 42 клиентах ничего не болит, рефакторинги размера L. Вернуться после нагрузочного теста.
- **Защита в глубину без видимого риска:**
  - R-135 (nonce-CSP в Next 14 — L, есть риск поломок);
  - R-137 (защиты на месте, достаточно одного регрессионного теста);
  - R-142, R-143, R-144, R-154 (делать при ближайшей миграции безопасности);
  - R-224 (остаток), R-227 (дефекта нет).
- **Легаси без пользователей:**
  - R-148, R-175 (удаление — одним решением PO);
  - R-149 (Zod добавлять при правке маршрута);
  - R-174, R-185 (нет UI);
  - R-200 (заглушки только у персонала);
  - R-203, R-211 (размер L).
- **Архитектура расчётов:** R-177, R-178, R-186. Делать пакетом «качество расчётов» вместе с R-038, R-080 и R-081, не по одному.
- **Косметика и массовые правки:**
  - R-195, R-196, R-198 — править точечно, когда касаемся экрана;
  - R-204 — вместе с решением о двух оболочках;
  - R-244, R-251.
- **Данные без видимого эффекта:** R-226, R-229, R-232, R-233 (остаток), R-155 (сроки хранения — решение PO).
- **Ждут решения PO:** R-157, R-162, R-202, R-213, R-215, R-216, R-217, R-218, R-247.
- **Идеи развития** (после ≥ 30 активных компаний и бюджета): R-252…R-260.
- **Неактуальны:** R-206 (маскот), R-222. По R-222 нужно только обновить заметку о тестовом окружении.
