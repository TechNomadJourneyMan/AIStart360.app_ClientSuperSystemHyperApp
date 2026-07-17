# Omnichannel Inbox: Instagram + WhatsApp

Этот runbook описывает подключение единого inbox для Instagram Direct и
WhatsApp Cloud API: приём подписанных webhook-событий, AI-анализ, черновики,
автоответы в допустимом окне и безопасный разбор ограниченного Instagram backlog.

> Рекомендуемый запуск: `enabled=false` → `draft` → проверка оператором → `auto`.
> Исторические сообщения импортируются только как данные для разбора и черновиков;
> сам импорт не даёт права отправить клиенту ответ вне окна Meta.

## 1. Что реализовано и где

- Единый callback Meta: `GET/POST /api/webhooks/meta`.
- Instagram и WhatsApp приводятся к общей модели контактов, диалогов и сообщений.
- Повторные webhook-события дедуплицируются по hash/provider message id.
- Обработка запускается через Vercel Workflow, Inngest или Postgres-очередь,
  а не блокирует Meta webhook до завершения AI-ответа.
- AI определяет intent, sentiment, lead score, риск и создаёт ответ. Платежи,
  возвраты, жалобы, юридические/медицинские темы, угрозы, opt-out и prompt
  injection передаются человеку.
- Явный opt-out включает отдельный `send_suppressed`: он блокирует и AI, и
  ручную отправку до подтверждённого оператором re-opt-in.
- Настройки канала: `enabled`, режим `off | draft | auto`, порог уверенности,
  задержка ответа и business context.
- Детерминированный сценарий экипировки выполняется до LLM: собирает город и
  интерес, показывает пять вариантов и выдаёт только настроенную ссылку нужного
  менеджера. После маршрутизации диалог переходит человеку.
- Управление находится в ГИГА-Панели, модуль **Instagram / WhatsApp**.

Таблицы `omnichannel_*` закрыты от `anon` и `authenticated`; доступ к ним имеет
только server-side service role. Сырые webhook body и provider credentials в БД
не сохраняются.

## 2. Предварительные условия Meta

### Instagram

Нужен Instagram Professional account (`Business` или `Creator`) и Meta app с
Instagram API with Instagram Login. Для собственного аккаунта достаточно
Standard Access; для подключения аккаунтов других компаний нужен Advanced Access
и, как правило, App Review.

Запросите как минимум:

- `instagram_business_basic`;
- `instagram_business_manage_messages`.

Подпишите Instagram-аккаунт на webhook field `messages`. Клиент должен первым
написать профессиональному аккаунту — API не предназначен для холодных исходящих
DM.

Официальные материалы:

- [Instagram API with Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- [Instagram Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [Instagram Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api)
- [Instagram Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks)

### WhatsApp

Нужны WhatsApp Business Account, Cloud API phone number и access token с
`whatsapp_business_messaging`; для управления WABA/app assets может также
потребоваться `whatsapp_business_management`. В production используйте
долгоживущий system-user token и настройте его ротацию.

Подпишите WABA на webhook field `messages`: через него приходят входящие сообщения
и статусы `sent`, `delivered`, `read`, `failed`. До business-initiated сообщений
получите явный opt-in пользователя.

Официальные материалы:

- [WhatsApp Cloud API overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)
- [Send messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)
- [Message templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- [Getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)

## 3. База данных

Проверьте `DIRECT_URL` в `.env.local`, затем примените идемпотентную миграцию:

```bash
node scripts/apply-migration.js supabase/migrations/061_omnichannel_inbox.sql
node scripts/apply-migration.js supabase/migrations/062_omnichannel_equipment_sales_flow.sql
node scripts/apply-migration.js supabase/migrations/063_omnichannel_webhook_claim_lease.sql
node scripts/apply-migration.js supabase/migrations/064_omnichannel_processing_jobs.sql
node scripts/apply-migration.js supabase/migrations/065_omnichannel_runtime_role.sql
node scripts/apply-migration.js supabase/migrations/066_omnichannel_outbound_deliveries.sql
node scripts/apply-migration.js supabase/migrations/067_omnichannel_reply_quiet_window.sql
node scripts/apply-migration.js supabase/migrations/068_omnichannel_manager_routing.sql
node scripts/apply-migration.js supabase/migrations/069_omnichannel_conversation_ux.sql
node scripts/apply-migration.js supabase/migrations/070_omnichannel_owned_send_claims.sql
node scripts/apply-migration.js supabase/migrations/071_omnichannel_honor_context.sql
node scripts/apply-migration.js supabase/migrations/072_omnichannel_direct_catalog.sql
```

Миграция создаёт:

- `omnichannel_settings`;
- `omnichannel_contacts`;
- `omnichannel_conversations`;
- `omnichannel_messages`;
- `omnichannel_webhook_events`.

Миграция `066` добавляет защищённую pull-очередь исходящих WhatsApp Web
сообщений. Текст хранится отдельно от lease-очереди, выдаётся bridge только
после повторной атомарной проверки, а неоднозначный результат никогда не
ретраится вслепую. `065` должна быть применена раньше `066`, потому что она
создаёт отдельную runtime-роль базы данных.

Миграция `062` добавляет `omnichannel_settings.automation_config` и добавляет
отсутствующий versioned-сценарий для Instagram и WhatsApp. Другие
ключи `automation_config` и уже существующий `equipment_sales_flow` она не
перезаписывает. Если была применена незавершённая ревизия `062`, её
сценарий v1 однократно переводится в `enabled=false`; тексты и маршруты
при этом сохраняются, а следующие rerun не сбрасывают явный opt-in.

Сценарий сидируется с `enabled=false`: само применение миграции не
меняет ответы уже работающего канала. Включение — отдельный явный
opt-in суперадмина для каждого канала.

Оба канала создаются с `mode='draft'` и `enabled=false`. Не меняйте эти значения
на production до проверки webhook, Inngest и качества черновиков.

### Сценарий экипировки

Конфигурация `equipment_sales_flow` хранит тексты, стабильные ID вариантов,
алиасы городов, телефоны менеджеров и WhatsApp-чат. Модель не получает права
выбирать номер или генерировать URL. По умолчанию настроено:

- Астана → `https://wa.me/77054057775`;
- Усть-Каменогорск / Өскемен → `https://wa.me/77714057775`;
- остальные города → `https://wa.me/77714057775`;
- чат новинок и акций →
  `https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t`.

Instagram получает пять quick replies. Поскольку quick replies не видны на
некоторых desktop-клиентах, полный список `1–5` дублируется текстом. WhatsApp
получает interactive list: обычных reply-кнопок там может быть только три, а
вариантов пять. Длинная фраза каталога остаётся в теле/описании, а короткая
кнопка называется «Открыть каталог».

Приглашение в общий чат добавляется максимум один раз. Финальный ответ содержит
ссылку менеджера и, если приглашение ещё не было показано, ссылку чата одним
Meta POST — это уменьшает риск частично доставленного сценария. В ГИГА-Панели
сценарий можно экстренно отключить отдельно для каждого канала.
Переключатель атомарно меняет только `equipment_sales_flow.enabled`, не
перезаписывая тексты, номера и другие automation-ключи. Каждый ответ
привязан к `settings.updated_at`: если оператор успел изменить или отключить
сценарий, финальная claim-проверка отменит устаревшую отправку. Уже принятый
внешним Meta API запрос отозвать нельзя.
Обычный settings PATCH намеренно не принимает весь `automation_config`,
чтобы устаревшая UI-копия не могла откатить номера или тексты. Их
изменение делайте отдельной проверенной миграцией.

Безопасная активация:

1. Активируйте канал, но оставьте его в режиме `draft`.
2. Явно включите «Сценарий экипировки» для нужного канала.
3. Проверьте черновики, города, все пять вариантов и ссылки менеджеров.
4. Только после этого переведите канал в `auto`; UI потребует отдельное
   подтверждение.

Официальные форматы:

- [Instagram Quick Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies)
- [WhatsApp Interactive Object](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api#interactiveobject)

## 4. Переменные окружения

Скопируйте `.env.example` в `.env.local` и задайте значения. В Vercel добавьте их
как server-side Environment Variables для нужных окружений, затем redeploy.

```dotenv
META_GRAPH_API_VERSION=v25.0
META_GRAPH_TIMEOUT_MS=10000
META_APP_SECRET=<meta-app-secret>
INSTAGRAM_APP_SECRET=<optional-separate-instagram-app-secret>
META_WEBHOOK_VERIFY_TOKEN=<independent-random-secret>

INSTAGRAM_ACCESS_TOKEN=<instagram-user-access-token>
INSTAGRAM_ACCOUNT_ID=<instagram-professional-account-id>
INSTAGRAM_HUMAN_AGENT_ENABLED=
INSTAGRAM_BACKFILL_MAX_CONVERSATIONS=25
OMNICHANNEL_RETENTION_DAYS=180

WHATSAPP_TOKEN=<cloud-api-token>
WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>

INNGEST_EVENT_KEY=<production-event-key>
INNGEST_SIGNING_KEY=<production-signing-key>
OPENROUTER_API_KEY=<server-side-key>

# Instagram + WhatsApp Cloud API on Vercel (no always-on bridge required)
OMNICHANNEL_PROCESSING_BACKEND=workflow

# QR/WebSocket WhatsApp production worker
# Use `database` instead of `workflow` when this bridge is enabled.
OMNICHANNEL_PERSISTENCE=postgres
OMNICHANNEL_DATABASE_URL=<dedicated-least-privilege-pooler-dsn>
```

`META_APP_SECRET`, `INSTAGRAM_APP_SECRET`, provider tokens,
`SUPABASE_SERVICE_ROLE_KEY` и OpenRouter key никогда не должны попадать
в git, browser bundle, URL query или логи.
`META_WEBHOOK_VERIFY_TOKEN` — выбранная вами случайная строка, а не App Secret.

`INSTAGRAM_APP_SECRET` задавайте, если Instagram Login настроен в
отдельном Meta app. Если оба канала находятся в одном app, оставьте
переменную пустой: Instagram безопасно использует `META_APP_SECRET`.

`OMNICHANNEL_DATABASE_URL` создаётся для отдельного LOGIN-пользователя, которому
выдана только роль `aistart360_omnichannel_runtime`. Не подставляйте сюда owner
`DATABASE_URL`: production database-режим намеренно завершится `503`, если
отдельный DSN отсутствует. Таблица очереди не содержит текстов клиентов и
доступна runtime-роли только через fenced RPC.

`INSTAGRAM_HUMAN_AGENT_ENABLED` оставьте пустым при первом запуске. Значение
включает только возможность ручного ответа оператора с тегом `HUMAN_AGENT`;
автоматический AI-ответ не использует этот тег.

Текущая конфигурация поддерживает один sender account на канал. Каждый диалог
сверяется с `INSTAGRAM_ACCOUNT_ID` или `WHATSAPP_PHONE_NUMBER_ID`; событие от
другого asset можно сохранить для разбора, но отправка fail-closed блокируется,
чтобы ответ не ушёл с неправильного номера/аккаунта.

## 5. Webhook в Meta

Production callback должен быть публичным HTTPS URL:

```text
https://<ваш-домен>/api/webhooks/meta
```

Один callback можно указать в настройках Instagram и WhatsApp продуктов того же
Meta app. Для каждого продукта:

1. Вставьте callback URL.
2. Вставьте значение `META_WEBHOOK_VERIFY_TOKEN` как Verify Token.
3. Завершите GET-проверку Meta.
4. Подпишите Instagram на `messages`, а WABA — на `messages`.
5. Отправьте тестовое входящее сообщение реальным аккаунтом/номером.

GET-проверку можно проверить самостоятельно:

```bash
curl --get 'https://<ваш-домен>/api/webhooks/meta' \
  --data-urlencode 'hub.mode=subscribe' \
  --data-urlencode 'hub.verify_token=<verify-token>' \
  --data-urlencode 'hub.challenge=healthcheck'
```

Ожидаемый body — `healthcheck`. POST принимается только с корректным
`X-Hub-Signature-256`, вычисленным Meta по **исходному raw body**. WhatsApp
проверяется только `META_APP_SECRET`; Instagram — `INSTAGRAM_APP_SECRET`, если
он задан, иначе тот же `META_APP_SECRET`. Секреты каналов нельзя
взаимозаменять. Не отключайте проверку подписи даже временно.

Для локальной разработки используйте HTTPS tunnel, но не публикуйте `.env.local`
и не вставляйте access token в URL. После смены tunnel URL обновите callback в
Meta Dashboard.

## 6. Асинхронная обработка

Webhook должен быстро подтвердить валидное событие, а AI/Graph API выполняются
асинхронно. Для Vercel рекомендуется
`OMNICHANNEL_PROCESSING_BACKEND=workflow`: Workflow SDK сохраняет тихое окно
как durable sleep, затем запускает защищённый processing step и автоматически
возобновляет операции после сбоев. Для
Vercel отдельные Workflow credentials не требуются; в проекте должен быть
включён Fluid Compute.

Альтернатива — `OMNICHANNEL_PROCESSING_BACKEND=inngest`. В production:

1. Задайте `INNGEST_EVENT_KEY` и `INNGEST_SIGNING_KEY` в Vercel.
2. Убедитесь, что endpoint `https://<ваш-домен>/api/inngest` синхронизирован в
   Inngest Cloud.
3. Проверьте зарегистрированные функции обработки сообщения и Instagram
   backfill.
4. После тестового DM проверьте успешный run и появление записи в
   `omnichannel_messages`.

Inngest сериализует обработку по диалогу. Vercel Workflow допускает параллельные
запуски, поэтому актуальность сообщения и единственный владелец отправки
проверяются атомарно в базе непосредственно перед Meta POST. Повторная доставка
webhook безопасна. Если постановка события в очередь не удалась, endpoint
возвращает ошибку, чтобы Meta повторила доставку.

## 7. Безопасный rollout

### `off`

События можно принимать и сохранять, но AI-ответы не создаются и не отправляются.
Используйте для аварийной остановки канала.

### `draft` — стартовый режим

AI анализирует сообщения и создаёт черновик. Отправку подтверждает оператор.
Рекомендуется:

1. Включить один канал (`enabled=true`, `mode=draft`).
2. Проверить 30–50 реальных диалогов на языке вашей аудитории.
3. Заполнить business context: продукты, допустимые обещания, цены и правила
   эскалации.
4. Проверить, что opt-out, оплаты/возвраты, жалобы и высокорисковые вопросы всегда
   уходят человеку.
5. Выбрать порог уверенности; безопасная стартовая величина — `0.75` или выше.

### `auto`

Автоотправка разрешается только если одновременно выполнены условия: канал
включён, диалог не muted/needs-human, сообщение — актуальное входящее, риск низкий,
уверенность выше порога и окно Meta ещё открыто. Для отдельных диалогов используйте
override/`muted` и ручную эскалацию.

Первые дни после включения контролируйте ошибочные ответы, opt-out, долю
эскалаций, Graph API failures и задержку Workflow/Inngest. При аномалии сразу верните
канал в `draft` или `off`.

## 8. Окна отправки и ограничения Meta

| Канал     | Обычный текст                                           | Что делать вне окна                                                                                                                                                                         |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram | До 24 часов после последнего входящего сообщения        | Не отправлять AI-ответ. Ручной оператор может использовать `HUMAN_AGENT` только для genuine human support и только в пределах разрешённого 7-дневного окна, если функция доступна аккаунту. |
| WhatsApp  | Free-form text до 24 часов после сообщения пользователя | Нужен заранее одобренный template и действующий opt-in. Текущая реализация произвольную template-отправку вне окна не подменяет обычным текстом.                                            |

`HUMAN_AGENT` нельзя применять для автоматических сообщений, маркетинга или как
способ обойти 24-часовую политику. Исторический импорт также не открывает новое
окно — его открывает только новое входящее сообщение пользователя.

## 9. Backlog: что можно и нельзя импортировать

### Instagram

Instagram Conversations API позволяет прочитать доступные API диалоги, но это не
полный экспорт Direct. В текущем importer:

- за запуск сканируется максимум `INSTAGRAM_BACKFILL_MAX_CONVERSATIONS` диалогов
  (по умолчанию 25, максимум 100);
- запросы throttled примерно до 2 запросов в секунду;
- **детали сообщений жёстко ограничены 20 самыми новыми ID суммарно за запуск**,
  а не 20 на каждый диалог;
- уже импортированные provider ID исключаются, и Inngest автоматически запускает
  следующий bounded batch (до 25 batches), поэтому доступное окно постепенно
  разбирается, а не повторяет одни и те же 20 сообщений;
- результат с оставшимися ID отмечается `truncated`;
- недоступные Meta диалоги не восстанавливаются: API имеет собственные ограничения
  выдачи (включая ограниченное число последних message details; неактивные более
  30 дней message requests могут не возвращаться).

Импорт запускайте в `draft`: backlog предназначен для классификации, summary и
ручной обработки. Не пытайтесь автоматически отвечать старым контактам.
Повторный запуск идемпотентен по provider message id. Это всё равно не полный
экспорт архива: importer может продвигаться только по ID, которые Conversations
API реально вернул, и ограничивает одну цепочку 25 batches (до 500 detail calls).

### WhatsApp

Обычный WhatsApp Cloud API **не предоставляет endpoint произвольной истории
сообщений**. После подключения будут сохраняться новые сообщения и delivery
statuses из webhook. Старый backlog нельзя получить тем же способом, что
Instagram; для него нужен отдельный, юридически и технически допустимый источник
экспорта/миграции.

Экспериментальный QR-bridge является таким отдельным источником: он может
передать ограниченный catch-up с метками `transport=whatsapp_web`,
`catchUp=true`. Такой импорт никогда не получает право на автоотправку:
production-обработка передаёт `force_draft=true`, а development Postgres fallback
сначала сохраняет строку со статусом `imported`. Кнопка **«Разобрать WhatsApp»**
не запрашивает историю у Cloud API. Она выбирает не более 100 только входящих
ещё не разобранных строк сохранённого QR-catch-up и запускает каждую с
`force_draft=true`. Поэтому даже если канал настроен как `auto`, исторический
разбор создаёт только черновик и не вызывает транспорт отправки. Повторный запуск
безопасен: выборка исключает уже обработанные статусы, а production Inngest events
имеют стабильные ID сообщения. Сам импорт и AI-разбор всё равно не открывают
24-часовое окно ответа. QR-catch-up остаётся best-effort: он ограничен тем, что
WhatsApp передал companion-у, и не является гарантированным полным архивом или
списком всех непрочитанных.

## 10. Privacy и безопасность

- Используйте сообщения только для ответа пользователю и поддержки заявленного
  business purpose. Не обучайте на них общую/shared AI-модель.
- Передавайте AI-провайдеру минимум данных; не добавляйте токены, media URLs,
  карточные данные или лишние PII в prompt.
- Проверьте DPA, retention и no-training настройки AI-провайдера до production.
- Ограничьте доступ к ГИГА-Панели и `GIGA_ADMIN_PASSWORD`; все inbox API должны
  оставаться server-side и admin-only.
- Ротируйте Meta/OpenRouter/Supabase secrets при подозрении на утечку и после
  ухода ответственных сотрудников.
- Не логируйте raw webhook, Authorization headers и message text без утверждённой
  retention/redaction политики.
- Согласуйте privacy notice, согласие/opt-in и сроки хранения с требованиями вашей
  юрисдикции и правилами Meta.
- `OMNICHANNEL_RETENTION_DAYS` задаёт срок хранения полного текста (30–730 дней,
  по умолчанию 180). Ежедневная Inngest maintenance удаляет просроченные тексты,
  webhook audit старше 30 дней и orphan contacts. Запись send suppression для
  opt-out контакта сохраняется, чтобы отказ не потерялся.

## 11. Проверка перед production

Локальные проверки:

```bash
npx vitest run tests/unit/omnichannel
npm run type-check
npm run lint
```

Smoke checklist для каждого канала:

- неверный verify token отклоняется;
- POST с неверной/отсутствующей подписью не меняет БД;
- повтор одного webhook не создаёт второе сообщение;
- входящий текст появляется в нужном диалоге;
- статус WhatsApp обновляется до `delivered/read`;
- `draft` создаёт черновик и ничего не отправляет;
- Instagram показывает пять quick replies, а WhatsApp — список из пяти вариантов;
- выбор интереса и город в любом порядке приводят к правильному `wa.me`;
- после выдачи менеджера диалог получает `needs_human` и AI takeover выключается;
- ссылка общего чата не повторяется в последующих шагах сценария;
- high-risk получает `needs_human`, а opt-out — `send_suppressed`, без автоответа;
- opt-out блокирует также ручной endpoint; re-opt-in снимается только отдельным
  подтверждением оператора;
- `auto` отправляет только low-risk сообщение внутри 24 часов;
- просроченный Instagram/WhatsApp диалог блокирует обычный ответ;
- Instagram backfill сообщает `truncated`, когда кандидатов больше 20;
- «Разобрать WhatsApp» видит только уже сохранённый QR-catch-up, создаёт
  черновики и не вызывает отправку даже при включённом `auto`;
- секреты и raw payload отсутствуют в логах/таблице webhook events.

## 12. Эксплуатация и аварийная остановка

При сбое:

1. Переведите проблемный канал в `off` в ГИГА-Панели; если нужно сохранить AI
   анализ без отправки — в `draft`.
2. Проверьте Inngest runs, Meta webhook delivery и Graph API error code.
3. Проверьте срок/permissions токена и соответствие account/phone number id.
4. Не запускайте массовый backfill как способ повторной отправки.
5. После исправления сначала повторите smoke test в `draft`, затем верните `auto`.

Daily maintenance повторно ставит в очередь зависшие `received/imported`, а
`processing/sending` старше 30 минут переводит в `needs_human` без повторной
отправки. Не повторяйте ручной ответ после `delivery_unknown`: сначала проверьте
фактический диалог в Meta, иначе возможен дубль.

Для плановой ротации сначала добавьте новый token в окружение, redeploy, выполните
входящий smoke test и только затем отзывайте старый token.
