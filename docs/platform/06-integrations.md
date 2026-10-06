# 06 — Интеграции, MCP и внешние оркестраторы

Назначение: что подключено сейчас, что подключать для диагностики, как работаем с MCP, n8n, Paperclip и OpenClaw, в каком порядке внедряем.
Обновлено: 2026-10-06

Источники: аудит кода (админка, уведомления, интеграции; база `c0acee0`), внешнее исследование от 2026-10-06 (оно авторитетно для внешних фактов), решения D3, D4, D7 (авторитетны для нашего выбора).
Пометки исследования сохранены. **(выдержка)**: первоисточник был закрыт из песочницы, взята поисковая выдержка с привязкой к URL. **(сторонний источник)**: обзор третьей стороны. **не проверено**: подтвердить не удалось. **[verify live]**: зависит от прод-настроек, из контейнера не проверяется.
Приоритеты в этом документе: **P0** — сейчас, **P1** — следующий квартал, **P2** — по запросу клиентов.

## 1. Текущие интеграции в коде

### 1.1 Инвентарь

| Интеграция | Напр. | Auth | Где секрет | Статус | В health | Кормит диагностику |
|---|---|---|---|---|---|---|
| Supabase | ↔ | service key | env | real | да | ядро |
| OpenRouter (LLM) | → | API key | env | real | да (обязат.) | да: Точка А/Б, ассистент, omnichannel AI |
| Resend (email) | → | API key | env | real, лог `email_deliveries` | да | нет |
| Telegram Bot API | ↔ | токен бота; secret webhook **опционален** | env | partial: отправка + привязка `/start` | токен и чаты | нет (только дайджест) |
| Telegram userbot (MTProto) | ↔ | API id/hash + session string | env | real, cron раз в сутки | нет | нет |
| Google Sheets (Apps Script) | → | опц. shared secret | env | real (зеркало анкеты) | проверяет не ту переменную | нет (экспорт) |
| **Bitrix24 / amoCRM** (на пользователя) | ← pull | webhook URL или OAuth-токен от пользователя | **plaintext** `crm_provider_connections.access_token` | real, только ручная синхронизация | нет (`last_sync_status` в строке) | **да**: `crm_clients` → `/api/pulse`, NBA, сигналы маскота, дайджест |
| Legacy Prisma CRM (`/api/crm*`) | — | — | Prisma `accessToken` | dead (всегда 403) | нет | нет |
| Meta: Instagram + WhatsApp Cloud | ↔ | HMAC `x-hub-signature-256`, verify token | env | real; AI-ответчик off/draft/auto | нет | косвенно (inbox) |
| WhatsApp Web bridge | ↔ | HMAC v1 + timestamp + nonce + ротация ключей | env (≥32 B) | real за флагом | нет | косвенно |
| MyHonor (заказы) | ← / → WA | Bearer (+ ключ `_PREVIOUS`) | env | real | нет | нет |
| Kaspi эквайринг | ↔ | HMAC `x-kaspi-signature` | env | real при настройке, иначе stub | нет | нет (тариф) |
| Stripe / CloudPayments / Halyk / Mir | → | — | — | stub | нет | нет |
| E-commerce адаптеры (19: kaspi, ga4, yandex-metrika, meta-ads, wildberries, ozon…) | ← | — | — | stub (throw) | нет | нет |
| Mark-analytics market API | → | JWT пользователя + allowlist путей | env | real при настройке | нет | да (рынок) |
| WhatsApp Cloud (эскалации, дайджест) | → | Graph token | env | эскалации за флагом; дайджест не срабатывает (phone = null) | нет | нет |
| SMS | → | — | — | stub | нет | нет |
| Inngest | ← | `INNGEST_SIGNING_KEY` | env | real | нет | среда выполнения |
| Vercel Workflow | внутр. | — | — | real (omnichannel) | нет | нет |
| Upstash Redis | → | token | env | real (опц.) | да | нет |
| Langfuse | → | ключи | env | partial (1 вызов) | нет | нет |
| n8n | — | — | `N8N_WEBHOOK_URL` нигде не читается | не используется | — | нет |
| MCP (`.mcp.json`) | dev | — | — | только dev-инструменты; в приложении нет MCP-сервера и клиента | — | нет |

Ключевые находки (Сейчас):
- **Шифрования нет.** `lib/crypto/secrets.ts` (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`, формат `v1:iv:tag:ct`) в комментарии `:4-5` предназначен для CRM-токенов, но используется только для TOTP. Миграция 046 прямо фиксирует: «Токены пока plaintext».
- **SSRF с отражением.** Подключение CRM делает серверный `fetch` на URL пользователя: любой `http(s)`-токен считается webhook Bitrix24 (`lib/crm/provider-client.ts:16`), amoCRM берёт любой домен (`lib/crm/amocrm.ts:18-23`). Первые 200 символов ответа апстрима уходят клиенту (`lib/crm/bitrix24.ts:52` → `app/api/v1/crm/connections/route.ts:63-66`).
- OAuth-токен Bitrix24 передаётся в query `?auth=` (`lib/crm/bitrix24.ts:32`), поэтому URL запроса нельзя логировать.
- В `crm_provider_connections` нет `refresh_token`. OAuth-доступ Bitrix24 (1 ч) и amoCRM (24 ч) после истечения не обновится. Фактически работают входящий webhook Bitrix24 и долгосрочный токен amoCRM (вывод из схемы 046 и сроков из §2).
- Подключение привязано к `user_id`, а не к `company_id` (D1). Кредов не видит никто, кроме владельца, в том числе staff. Это правильно, и health для админки должен отдавать только несекретные поля.
- Health проверяет только наличие env. Для Sheets он смотрит `GOOGLE_SHEETS_SPREADSHEET_ID`, а реальный переключатель — `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`. Нет last-success/last-error, алертов нет (только `console.error`). Throttle нет, синхронизация вручную, до 200 сделок и 200 контактов за раз.

### 1.2 Безопасность webhook и машинных эндпоинтов

| Эндпоинт | Проверка | Без секрета | Replay | Вердикт | Действие |
|---|---|---|---|---|---|
| `POST /api/webhooks/meta` | HMAC-SHA256 по raw body, `timingSafeEqual`; секреты IG и WA раздельно; лимит 1 MB | 503 (closed) | id провайдера | сильная | — |
| `POST /api/webhooks/whatsapp-web/**` | HMAC v1 + timestamp + nonce + ротация, секрет ≥32 B | 503 | nonce (в памяти) + DB leases | сильная | образец для новых входящих webhook |
| `POST /api/webhooks/kaspi` | HMAC hex, `timingSafeEqual` | 503 | по статусу транзакции, timestamp нет | хорошая | сверить имя заголовка с документацией Kaspi |
| `POST /api/v1/integrations/myhonor/order-notifications` | Bearer, несколько ключей, constant-time | 503 | `event_id` | хорошая | — |
| `POST /api/telegram/webhook` | секрет **опционален**, сравнение `!==` | **open** | нет | **слабая** | P0: fail-closed, constant-time, dedupe `update_id` (D4) |
| `GET /api/cron/crm-digest` | Bearer или `?secret=`, `===` | 500 | — | ok | убрать `?secret=`, constant-time |
| `GET /api/telegram/personal/sync` | Bearer или `?secret=`, `timingSafeEqual` | 401 | `last_processed_message_id` | ok | убрать `?secret=` |
| `/api/inngest` | подпись SDK | по SDK | SDK | не проверено сверх конфигурации | ключ в prod [verify live] |
| `POST /api/notifications/send` | только NextAuth-сессия | — | — | латентный спам-вектор (сейчас недостижим) | удалить |
| `GET /api/health` | нет (публичный) | — | — | утечка имён env, выдуманные uptime и latency | не брать за основу health |

## 2. Матрица интеграций для диагностики

Value — польза для диагностики (1–5). Complexity — сложность внедрения, 1 = просто, 5 = трудно (лёгкость — обратная величина).

| Integration | Data | Value | Complexity | Priority | Recommended |
|---|---|---|---|---|---|
| CRM · Bitrix24 | воронки, сделки, конверсия по этапам, скорость реакции, задачи, звонки, загрузка менеджеров | 5 | 2 | P0 | Да (адаптер есть, нужен hardening) |
| CRM · amoCRM / Kommo | сделки, воронки, потерянные сделки, задачи, источники, переписка | 5 | 2 | P0 | Да (адаптер есть, нужен hardening) |
| CRM · HubSpot | pipeline, lifecycle, источники, активность | 4 | 2 | P2 | По запросу |
| CRM · Salesforce | opportunities, forecast, активность | 4 | 3 | P2 | По запросу (в СНГ редко) |
| CRM · Pipedrive | сделки, активности | 3 | 2 | P2 | По запросу |
| Финансы · 1С (БП/УТ/ERP, в т.ч. KZ) | выручка, маржа, дебиторка, остатки, себестоимость | 5 | 5 | P1 | Да: пилот OData read-only + шаблон выгрузки |
| Финансы · МойСклад | продажи, остатки, оборачиваемость, закупки, контрагенты | 4 | 2 | P1 | Да |
| Финансы · Kaspi Магазин API | заказы, статусы, товары, отзывы | 5 (e-com) | 3 | P1 | Да, для e-com |
| Финансы · файловый импорт (выписки, выгрузки 1С, Excel) | обороты, P&L, остатки, когда API нет | 4 (наша оценка) | 2 (наша оценка) | P1 | Да, запасной путь через конвейер документов (D6) |
| Финансы · Kaspi Pay | оборот эквайринга, средний чек | 3 | 4 | P2 | Нет: импорт выписки |
| Финансы · Stripe | MRR, churn, платежи | 3 | 1 | P2 | По запросу (в KZ/РФ редко) |
| Финансы · QuickBooks Online | P&L, баланс, AR/AP | 4 | 3 | P2 | Нет (не СНГ) |
| Финансы · Xero | P&L, счета | 3 | 3 | P2 | Нет (платный API) |
| Маркетинг · Яндекс.Метрика | трафик, источники, конверсии, цели | 4 | 2 | P1 | Да |
| Маркетинг · GA4 Data API | трафик, источники, конверсии | 4 | 2 | P1 | Да |
| Маркетинг · Яндекс.Директ API v5 | расходы, CPC/CPA, ROMI вместе с CRM | 4 | 3 | P1 | Да |
| Маркетинг · Google Ads API | расходы, конверсии | 3 (KZ) / 1 (РФ) | 4 | P2 | Только KZ, по запросу |
| Маркетинг · Meta Marketing API | расходы и эффективность FB/IG Ads | 3 (KZ) | 4 | P2 | Только KZ |
| Документы · Google Sheets | ручные отчёты, P&L-шаблоны, планы | 4 | 1 | P0 | Да |
| Документы · Google Drive | регламенты, договоры, отчёты для OCR и RAG | 3 | 2 | P1 | Да, только `drive.file` + Picker |
| Документы · OneDrive / SharePoint | то же для клиентов на M365 | 3 | 3 | P2 | По запросу |
| Документы · Notion | wiki, процессы, OKR | 2 | 2 | P2 | По запросу |
| Документы · Dropbox | файлы | 2 | 2 | P2 | Нет |
| Коммуникации · WhatsApp Cloud API | скорость и качество ответов, потерянные обращения | 5 | 3 | P0 | Да (частично есть) |
| Коммуникации · Instagram Messaging | то же для Direct | 4 (KZ) | 3 | P0 (KZ) | Да, только KZ |
| Коммуникации · Telegram Bot API | уведомления, одобрения; скорость ответов в ботах клиента (опц.) | 3 | 1 | P0 | Да |
| Коммуникации · Email (Resend) | доставка отчётов и уведомлений | 1 | 1 | P0 (инфраструктура) | Да |
| Коммуникации · Slack | внутренняя переписка команды клиента | 2 | 3 | P2 | Нет (для диагностики) |
| Коммуникации · MS Teams | то же | 2 | 4 | P2 | Нет |
| AI · OpenRouter (3 уровня) | анализ, классификация, генерация отчётов | 5 | 1 | P0 | Да, с ZDR и `data_collection: deny` |
| AI · Embeddings (OpenRouter) | RAG по документам клиента | 3 | 2 | P1 | Да (pgvector + RLS) |
| AI · OCR / document intelligence | счета, акты, договоры, сканы отчётности | 4 | 2 | P1 | Да: сначала LLM-vision, OCR только для сканов |
| AI · Speech-to-text | записи звонков из CRM: качество продаж, скрипты | 4 | 3 | P1 | Да (при телефонии в CRM) |

Детальные таблицы ниже. Последняя колонка — «Сложность · Польза · Приоритет».

### 2.1 CRM

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| Bitrix24 | ядро диагностики продаж в СНГ | REST, `batch` до 50 вызовов. MCP: офиц. docs-only (https://github.com/bitrix24/mcp-rest-doc) и «MCP в Битрикс24» с доступом к CRM (https://helpdesk.bitrix24.com/open/25866707/, выдержка) | OAuth 2.0: access 1 ч, refresh 180 дн. (https://github.com/bitrix-tools/b24-rest-docs/blob/main/settings/oauth/index.md) или входящий webhook (секрет в URL) | в тарифе клиента; REST на бесплатном тарифе — не проверено | leaky bucket 2 запр./с, порог 50 (Enterprise 5/с, 250) + лимит времени методов → 429 `OPERATION_TIME_LIMIT` (https://github.com/bitrix24/b24restdocs/blob/main/limits.md) | секрет webhook не логировать; права только `crm` на чтение | 2·5·P0 |
| amoCRM / Kommo | потерянные сделки, источники, переписка | REST API v4; офиц. MCP нет, только сторонние (https://github.com/saktush/amocrm-mcp) | OAuth 2.0: access 24 ч, refresh 3 мес. (https://habr.com/ru/articles/1074594/, сторонний источник) или долгосрочный токен частной интеграции | в тарифе клиента | ≤7 запр./с на интеграцию; повторные нарушения → блок IP (403); ≤250 сущностей в ответе (https://developers.kommo.com/docs/limitations, выдержка; https://www.amocrm.ru/developers/content/api/recommendations) | refresh ротируется: гонка обновлений теряет доступ, нужен lock | 2·5·P0 |
| HubSpot | клиенты на HubSpot | REST + офиц. MCP `https://mcp.hubspot.com` (GA с 2026-04-13, OAuth 2.1 + PKCE, без DCR) | OAuth 2.0 / private app token | API в рамках плана | private apps 100/10 с (Free/Starter), 190/10 с (Pro/Ent); в сутки 250 тыс./625 тыс./1 млн (https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines, выдержка) | только read-scopes | 2·4·P2 |
| Salesforce | редкие крупные клиенты | REST, Bulk | OAuth 2.0 (Connected/External App) | доступ к API зависит от редакции — не проверено | Enterprise: 100 000 + 1 000 на лицензию за 24 ч (https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html, выдержка) | — | 3·4·P2 |
| Pipedrive | клиенты на Pipedrive | REST | OAuth 2.0 / API token | в тарифе | 30 000 × множитель плана (1–7) × места в сутки; burst за 2 с: Lite 20 … Ultimate 140 (https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting, выдержка) | — | 2·3·P2 |

### 2.2 Финансы, учёт, маркетплейсы, платежи

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| 1С | основа финансовой диагностики | OData (REST, JSON/Atom) при публикации на веб-сервере; HTTP-сервисы — доработка конфигурации (https://v8.1c.ru/platforma/rest-interfeys/, выдержка). В 1С:Фреш OData включён (https://1cfresh.com/articles/data_odata, выдержка) | Basic, выделенный пользователь только на чтение | лицензии клиента + работа его ИТ | публичных нет, зависят от сервера | часто on-prem за NAT: VPN, туннель или выгрузка; креды только зашифрованными | 5·5·P1 |
| МойСклад | товарный бизнес: остатки, оборачиваемость | JSON API 1.2, webhooks | Bearer (`/security/token`) или Basic (https://dev.moysklad.ru/doc/api/remap/1.2/, выдержка) | в тарифе клиента | ≤100 запр./5 с и ≤5 параллельных на пользователя (выдержка); ≤20 параллельных на аккаунт (сторонний источник) | токен с правами на чтение | 2·4·P1 |
| Kaspi Магазин API | продажи на крупнейшем маркетплейсе KZ | REST (JSON:API), `kaspi.kz/shop/api/v2/orders` | `X-Auth-Token`, генерирует руководитель в кабинете (https://guide.kaspi.kz/partner/ru/shop/api/general/q3196, выдержка) | бесплатно | не проверено | токен даёт полный доступ к магазину | 3·5·P1 |
| Kaspi Pay | оборот эквайринга | публичного API для онлайн-приёма не найдено; есть Smart POS API и сторонние агрегаторы (apipay.kz) | по договору | — | не проверено | агрегатор — лишний посредник | 4·3·P2 |
| Stripe | MRR и churn у SaaS-клиентов | REST + офиц. MCP (`mcp.stripe.com`; с 2026-10-31 только Agent Keys или OAuth — https://docs.stripe.com/mcp, выдержка) | restricted key / OAuth (Connect) | % с транзакций | 100 оп./с в live (https://docs.stripe.com/rate-limits, выдержка) | только restricted read keys | 1·3·P2 |
| QuickBooks Online | — (не СНГ) | REST | OAuth 2.0 | — | 500 запр./мин на realm, 10 параллельных (https://help.developer.intuit.com/s/article/API-call-limits-and-throttling, выдержка) | — | 3·4·P2 |
| Xero | — (не СНГ) | REST | OAuth 2.0 | с 2026-03-02 платные тарифы разработчика, оплата за egress (https://developer.xero.com/pricing, выдержка) | 60/мин и 5 параллельных на организацию; 1 000 или 5 000 в сутки; 10 000/мин на приложение (https://developer.xero.com/documentation/guides/oauth2/limits/, выдержка) | — | 3·3·P2 |

### 2.3 Маркетинг и аналитика

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| Яндекс.Метрика | верх воронки РФ/KZ | Reports API, Logs API | OAuth (Яндекс ID) | бесплатно | 30 запр./с с IP, 5 000 в сутки на пользователя и на счётчик, 3 параллельных → 429 (https://yandex.ru/dev/metrika/en/intro/quotas, выдержка) | scope `metrika:read` | 2·4·P1 |
| GA4 Data API | верх воронки | REST `runReport` | OAuth 2.0 `analytics.readonly` | бесплатно | 200 000 токенов в сутки на свойство, 10 параллельных (https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/PropertyQuota, выдержка) | sensitive scope → верификация приложения Google | 2·4·P1 |
| Яндекс.Директ API v5 | ROMI вместе с CRM | JSON API, Reports | OAuth + заявка на доступ к API | бесплатно | баллы, суточный лимит по активности аккаунта; ≤5 параллельных (https://yandex.ru/dev/direct/doc/en/troubleshooting/limits, https://yandex.ru/dev/direct/doc/ru/concepts/headers, выдержка) | — | 3·4·P1 |
| Google Ads API | расходы у клиентов KZ | REST/gRPC | OAuth 2.0 + developer token | бесплатно | Explorer 2 880 оп./сутки, Basic 15 000, Standard без лимита (https://developers.google.com/google-ads/api/docs/api-policy/access-levels, выдержка) | в РФ показ рекламы приостановлен с 2022-03 (https://www.cnbc.com/2022/03/04/google-suspends-all-advertising-in-russia-.html) | 4·3·P2 |
| Meta Marketing API | расходы FB/IG у клиентов KZ | Graph API | OAuth `ads_read`, App Review, Business Verification | бесплатно | Business Use Case, заголовок `X-Business-Use-Case-Usage` (https://developers.facebook.com/docs/graph-api/overview/rate-limiting/, выдержка); цифры — не проверено | в РФ правовой риск (§5) | 4·3·P2 |

### 2.4 Документы

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| Google Sheets | ручная отчётность клиента | Sheets API v4 (+ офиц. MCP в preview) | OAuth `spreadsheets` (sensitive) или service account | бесплатно | чтение 300/мин на проект, 60/мин на пользователя → 429 (https://developers.google.com/workspace/sheets/api/limits, выдержка) | service account безопаснее; sensitive scope требует верификации | 1·4·P0 |
| Google Drive | документы для OCR и RAG | Drive API v3 + офиц. MCP (preview, https://developers.google.com/workspace/guides/configure-mcp-servers, выдержка) | OAuth **`drive.file`** через Picker; `drive`/`drive.readonly` — restricted, ежегодный CASA (https://developers.google.com/workspace/workspace-api-user-data-developer-policy, выдержка) | бесплатно (CASA платный) | 12 000 запр./60 с на проект и пользователя (https://developers.google.com/workspace/drive/api/guides/limits, выдержка) | только `drive.file` | 2·3·P1 |
| OneDrive / SharePoint | клиенты на M365 | MS Graph | OAuth (Entra ID), согласие администратора | бесплатно | resource units, например 18 750 RU / 5 мин при 0–1 000 лицензий (https://learn.microsoft.com/en-us/graph/throttling-limits, выдержка) | `Sites.Selected` — применимость не проверено | 3·3·P2 |
| Notion | процессы и OKR | REST + офиц. hosted MCP `https://mcp.notion.com/mcp` (https://developers.notion.com/guides/mcp/get-started-with-mcp, выдержка) | OAuth (публичная интеграция) | бесплатно | ~3 запр./с на интеграцию (выдержка: https://www.runxbuild.com/blog/notion-api-rate-limits/) | пользователь сам выбирает страницы | 2·2·P2 |
| Dropbox | файлы | API v2 | OAuth 2.0 | бесплатно | не публикуются, 429 + `Retry-After` (https://developers.dropbox.com/error-handling-guide, выдержка) | — | 2·2·P2 |

### 2.5 Коммуникации

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| Telegram Bot API | уведомления и одобрения (D4) | Bot API, webhook | токен бота + `secret_token` | бесплатно | ~1 сообщ./с в чат, 30/с всего, 20/мин в группу → 429 `retry_after` (https://core.telegram.org/bots/faq, выдержка) | проверять `X-Telegram-Bot-Api-Secret-Token`; allowlist чатов staff | 1·3·P0 |
| WhatsApp Cloud API | скорость ответов, потерянные обращения | Cloud API + webhooks | system user token, Embedded Signup, App Review | с 2025-07-01 оплата за доставленный шаблон, сервисные бесплатны (https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing, выдержка) | без верификации бизнеса 250 получателей/24 ч (сторонний источник, не проверено) | подпись `X-Hub-Signature-256` (уже есть) | 3·5·P0 |
| Instagram Messaging | то же для Direct | Instagram API with Instagram Login | OAuth Business Login | бесплатно | 200 вызовов/ч на пользователя; до 100/с на аккаунт (https://www.getphyllo.com/post/instagram-api-rate-limits-explained-and-how-to-scale-beyond-them-2026, сторонний источник, не проверено) | в РФ правовой риск Meta | 3·4·P0 (KZ) |
| Slack | переписка команды клиента | Web API + офиц. MCP (GA с 2026-02-17, сторонний источник) | OAuth | бесплатно | вне Marketplace `conversations.history` 1 запр./мин и 15 объектов (https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/, выдержка) | чтение переписки — вопрос согласия | 3·2·P2 |
| MS Teams | то же | Graph; чтение сообщений — protected APIs с одобрением Microsoft (https://learn.microsoft.com/en-us/microsoftteams/export-teams-content, выдержка); Office 365 Connectors отключены 18–22.05.2026 (https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/, выдержка) | OAuth (Entra) | — | сервисные лимиты Graph | — | 4·2·P2 |
| Email (Resend) | доставка отчётов | REST | API key | тарифы — не проверено | 10 запр./с на команду (https://resend.com/docs/api-reference/rate-limit, выдержка) | SPF, DKIM, DMARC | 1·1·P0 |

### 2.6 AI

| Интеграция | Зачем | API / MCP | Auth | Стоимость | Rate limits | Security | С·П·Пр |
|---|---|---|---|---|---|---|---|
| OpenRouter | LLM-шлюз, 3 уровня (D3) | OpenAI-совместимый API | API key на окружение, лимиты расходов | цены провайдеров; комиссия 5,5% при покупке кредитов; BYOK бесплатно до $25 тыс./мес, дальше 5% (https://openrouter.ai/docs/faq, выдержка) | free-модели 20/мин, 50/сутки (сторонний источник, не проверено) | ZDR + `data_collection: "deny"`; EU-роутинг `eu.openrouter.ai` только Business/Enterprise (https://openrouter.ai/docs/guides/features/zdr, выдержка) | 1·5·P0 |
| Embeddings | RAG | `POST /api/v1/embeddings` (https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings, выдержка) | тот же ключ | по модели | — | векторы — тоже ПДн: pgvector с RLS | 2·3·P1 |
| OCR | сканы и первичка | Azure Document Intelligence: Read ~$1,5 / 1 000 стр., prebuilt ~$10 (https://learn.microsoft.com/en-us/answers/questions/5927427/azure-document-intelligence-pricing, выдержка); Mistral OCR 4 ~$4 / 1 000 стр. (https://mistral.ai/news/ocr-4/, сторонний источник, не проверено); Yandex Vision OCR (казахский заявлен, ~120 ₽ / 1 000 ед., сторонний источник, не проверено) | API key | см. API | — | документы уходят за рубеж (§5) | 2·4·P1 |
| Speech-to-text | звонки из CRM | OpenAI `gpt-4o-transcribe` $0,006/мин, `-mini` $0,003/мин, казахский в списке (https://developers.openai.com/api/docs/models/gpt-4o-transcribe, выдержка; цены — сторонний источник); Yandex SpeechKit: казахский и узбекский (https://aistudio.yandex.ru/ru/docs/speechkit/pricing, выдержка; цены не проверено) | API key / IAM | поминутно | — | записи звонков — чувствительные ПДн: согласие, минимальный срок хранения | 3·4·P1 |

## 3. MCP

### 3.1 Статус спецификации
Проверено по https://github.com/modelcontextprotocol/modelcontextprotocol/releases и https://blog.modelcontextprotocol.io/posts/2026-07-28/.

| Аспект | Ревизия **2026-07-28** (текущая stable, RC 2026-05-29; ранее 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25) |
|---|---|
| Состояние | stateless: `initialize` и `Mcp-Session-Id` удалены; версия и capabilities в `_meta` каждого запроса; обязателен `server/discover` |
| Транспорты | stdio и Streamable HTTP; HTTP+SSE — deprecated; `Last-Event-ID` удалён; для POST обязательны `Mcp-Method` и `Mcp-Name` |
| Новое | Tasks как extension `io.modelcontextprotocol/tasks`; Multi Round-Trip (`input_required`); `resultType`; кэш (`ttlMs`, `cacheScope`); OTel-трассировка в `_meta` |
| Авторизация | опциональна (HTTP — SHOULD, stdio — SHOULD NOT). MUST: RFC 9728 (Protected Resource Metadata), `resource` по RFC 8707, проверка audience, токен только в `Authorization: Bearer`, не пересылать токены чужого AS, PKCE S256, проверка `iss` (RFC 9207). DCR (RFC 7591) deprecated в пользу Client ID Metadata Documents |
| Deprecated | Roots, Sampling, Logging |
| SDK | npm `@modelcontextprotocol/sdk` 1.32.1 (latest на 2026-10-06) — **поддерживает протокол только до 2025-11-25** (`LATEST_PROTOCOL_VERSION` в пакете, проверено). Поэтому наш сервер (§3.5) написан по спецификации напрямую, а SDK используется в тестах как клиент старой эпохи |

### 3.2 Риски и меры

| Риск | Суть | Мера у нас |
|---|---|---|
| Tool poisoning | скрытые инструкции в описании или схеме инструмента (https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks) | только allowlist; хэш описаний фиксируется, при изменении сервер блокируется до ревью |
| Rug pull | поведение меняется после одобрения (https://arxiv.org/pdf/2506.01333) | diff хэшей на каждом `tools/list`, версии зафиксированы |
| Prompt injection через данные | текст CRM, писем или документов содержит инструкции | выход инструментов — недоверенные данные в `<untrusted_*>` (D3); у читающего агента нет инструментов записи; записи только после одобрения |
| Confused deputy | прокси получает согласие от имени статического client_id | MCP-прокси к сторонним AS не строим |
| Token passthrough | сервер пересылает полученный токен в upstream | MUST NOT по спецификации; для upstream — отдельные токены тенанта из нашего хранилища |
| SSRF | загрузка metadata и `client_id`-документов по URL атакующего | egress allowlist, запрет приватных диапазонов |
| Supply chain / shadow MCP | неизвестные и самописные серверы | реестр одобренных серверов; OWASP MCP Top 10 (https://owasp.github.io/www-project-mcp-top-10/) |

Масштаб: 30+ CVE против MCP-реализаций за январь–февраль 2026 (https://cycode.com/blog/owasp-mcp-top-10/, сторонний источник, не проверено).

### 3.3 Существующие официальные серверы

| Сервис | Сервер и статус | Для нас |
|---|---|---|
| Google Drive / Sheets / Docs / Gmail / Calendar | удалённые `drivemcp.googleapis.com/mcp/v1` и др., Developer Preview, OAuth-клиент GCP (выдержка) | P2, после REST-интеграции |
| Notion | `https://mcp.notion.com/mcp`, OAuth; локальный сервер soft-deprecated (выдержка) | P2 |
| HubSpot | `https://mcp.hubspot.com`, GA 2026-04-13, OAuth 2.1 + PKCE, предрегистрированный клиент, без DCR (выдержка) | P2 |
| Stripe | `mcp.stripe.com`, с 2026-10-31 только Agent Keys или OAuth (выдержка) | P2 |
| Slack | `https://mcp.slack.com/mcp`, GA 2026-02-17, подключение одобряет админ (сторонний источник) | не для диагностики |
| GitHub | `https://api.githubcopilot.com/mcp/`, флаг `--read-only` (https://github.com/github/github-mcp-server, проверено) | только dev |
| Supabase | `https://mcp.supabase.com/mcp`, `read_only=true`, `project_ref`; к prod не подключать (https://github.com/supabase-community/supabase-mcp, проверено) | только dev, не prod |
| Postgres (reference) | перенесён в servers-archived (https://github.com/modelcontextprotocol/servers, проверено) | нет |
| Bitrix24 | офиц. docs-only (проверено) и «MCP в Битрикс24» с данными, включает админ портала (выдержка) | позже, как опция клиента |
| amoCRM / Kommo | официального нет, только сторонние | не использовать |
| MCP Registry | preview с 2025-09-08 (https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/) | источник метаданных для allowlist |

### 3.4 Наш план
**(a) Свой read-only MCP-сервер `aistart360-diagnostics` для staff — P1** (в D7 — Phase 9; исследование подтвердило вердикт «использовать»).

| Пункт | Решение |
|---|---|
| Транспорт | Streamable HTTP, route `/api/mcp`, stateless (ревизия 2026-07-28 ложится на serverless Vercel) |
| Авторизация | OAuth 2.1: `/.well-known/oauth-protected-resource` (RFC 9728), audience = наш MCP URL, PKCE S256, проверка `iss`. Подходит ли Supabase Auth как AS — не проверено |
| Тенант | только из токена: `sub` → роль и членство (D1, `can_read_company`); при согласии область можно сузить до одной компании. `tenant_id`/`company_id` в аргументах — только фильтр внутри этой области, расширить её не может |
| Данные | запросы с JWT пользователя через RLS, service-role не используется |
| Инструменты | только чтение: `get_diagnostic_summary`, `list_metrics`, `get_point_a_report`, `search_documents` (+ `list_findings` по D2). Детерминированный порядок `tools/list`, редактирование ПДн на выходе, rate limit, аудит каждого вызова |
| Первые пользователи | админы (Claude Desktop или Claude Code); позже — клиенты для своих AI-инструментов |

Реализация пункта (a) — §3.5 (отличия от плана: имена инструментов, данные читаются сервером после проверки прав по роли, а не JWT пользователя — у MCP-клиента нет сессии Supabase).

**(b) Внешние MCP-серверы — вернуться позже.** Только из таблицы `mcp_servers_allowlist` (URL, издатель, хэши описаний, разрешённые инструменты, `requires_approval`). OAuth-токены хранятся отдельно на тенанта (зашифрованы, привязаны к issuer), пересылка запрещена. Записи (сделка, сообщение) — только через `agent_approvals` и `step.waitForEvent` (D3/D4). Для Bitrix24 и amoCRM остаются свои REST-адаптеры `lib/crm/*`.

**(c) Реестр инструментов агентов совместим с MCP (D3).** Каждый инструмент: `name`, JSON Schema аргументов, `permission`, handler, привязанный к `company_id` задачи. Read-only подмножество (`READ_CLIENT_DATA`, `READ_FILES`) отдаётся через MCP-сервер из (a) без переписывания; инструменты с `WRITE_*`, `SEND_*`, `DELETE_DATA`, `MODIFY_SYSTEM` наружу не публикуются.

### 3.5 Реализовано: MCP-сервер `/api/mcp` (миграция 101)

Решение владельца «Оба»: этап 1 — личные токены (PAT), этап 2 — OAuth 2.1. Оба работают одновременно.

**Спецификация.** Ревизия **2026-07-28** (https://modelcontextprotocol.io/specification/2026-07-28) — транспорт Streamable HTTP, JSON-ответы без SSE, без сессий. Сервер **двухэпохальный** («dual-era», https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning): клиенты, которые открывают соединение `initialize` (ревизии 2025-11-25 / 2025-06-18 / 2025-03-26 — так сейчас работают Claude Code и Claude Desktop через официальный SDK), обслуживаются на том же адресе. `Mcp-Session-Id` не выдаётся, GET/DELETE → 405.

| Эпоха | Что проверяется |
|---|---|
| 2026-07-28 | `_meta["io.modelcontextprotocol/protocolVersion"]` и `…/clientCapabilities` в каждом запросе; заголовки `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (для `tools/call`, с декодированием `=?base64?…?=`) должны совпадать с телом, иначе 400 и `-32020`; неизвестная версия → 400 и `-32022` со списком наших; неизвестный метод → 404 и `-32601`; `server/discover`; в ответах `resultType: "complete"`, `serverInfo` в `_meta`, `ttlMs`/`cacheScope` (список инструментов зависит от роли → `private`) |
| ≤ 2025-11-25 | `initialize` с согласованием версии, `ping`, `tools/list`, `tools/call`; заголовок `MCP-Protocol-Version` с неподдерживаемой версией → 400 |
| Обе | одно JSON-RPC-сообщение на POST (batch → 400), уведомление → 202 без тела, чужой `Origin` → 403 (защита от DNS rebinding) |

**Инструменты (только чтение)** — `lib/mcp/tools.ts`, аргументы проверяются zod, JSON Schema генерируется из той же схемы, порядок `tools/list` детерминированный, аннотации `readOnlyHint: true`:

| Инструмент | Скоуп | Что возвращает |
|---|---|---|
| `search_clients` | `clients:read` | клиенты (компании) по названию / имени владельца; по email — только с `clients:pii` |
| `get_client` | `clients:read` | компания, владелец, контактное лицо, текущая диагностика, последняя сессия, ключевые находки (непроверенные гипотезы ИИ не показываются) |
| `get_point_a` | `diagnostics:read` | обзор Точки А (`lib/point-a/overview.ts`, тот же, что `GET /api/v1/point-a/overview`) |
| `list_diagnostics` | `diagnostics:read` | сессии диагностики и их расчёт |
| `get_metrics` | `metrics:read` | текущие метрики через `loadCompanyMetrics` (`lib/metrics/company-metrics.ts` — единый источник) |
| `list_reports` | `reports:read` | только `status = 'published'` |
| `list_agent_tasks` | `agents:read` | задачи агентов (`lib/agents/admin.ts listTasks`) |
| `get_ai_spend` | `spend:read` | расходы ИИ (`lib/ai/providers/service.ts spendSummary`) |

Видны только **клиентские** компании (владелец — клиент, не сотрудник; правило кабинета эксперта). Списки ≤ 50 строк с курсором, строки обрезаются, ответ ≤ 200 КБ.

**Скоупы ← роли** (`lib/mcp/scopes.ts`; права RBAC не меняли — каждый скоуп выводится из существующих прав `lib/admin/rbac.ts`):

| Скоуп | Право RBAC (любое) | Эксперт |
|---|---|---|
| `clients:read` | `users.view` | да |
| `clients:pii` | `users.sensitive` | да (кабинет эксперта показывает контакты) |
| `diagnostics:read`, `metrics:read` | `users.view` | да |
| `reports:read` | `agents.view` или `users.view` | да |
| `agents:read`, `spend:read` | `agents.view` | нет |

Итог: super_admin, admin, crm_manager — все; super_expert и support — без агентов и расходов; analyst — без контактов; content_manager — ничего. Эффективные права вызова = скоупы токена ∩ скоупы **текущей** роли: роль перечитывается на каждом запросе (и при обновлении OAuth-токена), поэтому отозванный или заблокированный сотрудник теряет доступ сразу. Без `clients:pii` email и телефоны маскируются (`lib/admin/mask.ts`, как в GIGA), в свободном тексте (ошибки) маскируются email и номера.

**Защита каждого вызова.** Bearer-токен → 401 с `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="…"` (RFC 9728 §5.1, RFC 6750 §3). Скоупа нет у токена → 403 `insufficient_scope` с нужным скоупом (step-up); скоуп есть, но роль не даёт → 403 без вызова на повторную авторизацию. Rate limit на токен: 120 запросов в минуту, bucket `mcp` (fail-closed), неверные токены — 30 в минуту на IP (`mcp-auth`). Аудит: `mcp_audit` — кто, токен, метод, инструмент, сводка аргументов без ПДн (id компаний/пользователей, числа и enum; текст запроса — только длина), статус, задержка, хэш IP. Результат `tools/call` не отдаётся, если строку аудита записать не удалось.

**Этап 1 — личные токены.** `a360_pat_` + 256 бит, в БД только SHA-256 и префикс для показа. Создание: GIGA → «Безопасность» → **«MCP-доступ»** (`/admin-giga-panel/mcp`), кабинет эксперта `/expert/mcp` или админ-бот `/mcp`. Права — только из прав своей роли, срок 7 / 30 / 90 / 365 дней, до 20 активных токенов; токен показывается один раз; строка в журнале действий персонала пишется до выпуска токена. Отзыв — там же.

**Этап 2 — OAuth 2.1** (`lib/mcp/oauth.ts`):

| Адрес | Назначение |
|---|---|
| `/.well-known/oauth-protected-resource/api/mcp` и `/.well-known/oauth-protected-resource` | RFC 9728: `resource = <домен>/api/mcp`, `authorization_servers = [<домен>]` |
| `/.well-known/oauth-authorization-server` | RFC 8414: issuer = домен, `code_challenge_methods_supported: ["S256"]`, `authorization_response_iss_parameter_supported: true` |
| `POST /api/oauth/register` | RFC 7591 (DCR; в 2026-07-28 deprecated в пользу Client ID Metadata Documents, но разрешён). Redirect URI — только https или loopback; секрет конфиденциального клиента хранится хэшем |
| `GET /api/oauth/authorize` | только `response_type=code` + PKCE S256; redirect URI — точное совпадение (для loopback допускается другой порт, RFC 8252 §7.3); `resource` = наш MCP URL (RFC 8707); ошибки неизвестного клиента/адреса не редиректятся |
| `/oauth/consent/<id>` | вход Supabase → 2FA по правилам панели (`staffMfaGate`) → экран согласия на русском со списком прав и хостом возврата (предупреждение для localhost) |
| `POST /api/oauth/token` | `authorization_code` (код одноразовый, 2 минуты; повторное предъявление отзывает выданные по нему токены) и `refresh_token` (ротация при каждом обновлении; повторное использование старого refresh-токена отзывает всю цепочку) |
| `POST /api/oauth/revoke` | RFC 7009 |

Access-токен — 1 час, refresh — 30 дней; токены привязаны к ресурсу (запрос с токеном, выданным для другого адреса, → 401). В ответах авторизации есть `iss` (RFC 9207). Client ID Metadata Documents не поддерживаются (`client_id_metadata_document_supported: false`) — сервер не загружает документы по URL клиента (нет SSRF-поверхности); в Claude Desktop выбирайте «Register automatically».

**Не проверено вживую:** подключение из Claude Code / Claude Desktop к задеплоенному серверу (нужен деплой с миграцией 101 и выключенной Deployment Protection для `/api/mcp`, `/api/oauth/*`, `/.well-known/oauth-*`, `/oauth/consent/*`). Совместимость с клиентом старой эпохи проверена тестом с официальным SDK-клиентом (`tests/unit/mcp/sdk-client.test.ts`); клиентов эпохи 2026-07-28 ещё нет в npm.

## 4. n8n, Paperclip, OpenClaw и другие

### 4.1 Сравнение

| Аспект | n8n | Paperclip | OpenClaw |
|---|---|---|---|
| Что это | workflow-автоматизация; лицензия SUL (https://github.com/n8n-io/n8n/blob/master/LICENSE.md); `n8n@2.42.3` (2026-10-05) | оркестратор агентов: оргструктура, бюджеты, heartbeat; MIT; запущен 2026-03 (https://github.com/paperclipai/paperclip) | локальный персональный агент/gateway, 20+ каналов, маркетплейс ClawHub; MIT (https://github.com/openclaw/openclaw) |
| Что можно использовать | внутренние автоматизации команды на **наших** учётных данных (лид с сайта → наша CRM, напоминания, сводки); прототипы интеграций без клиентских данных | только концепции: реестр агентов, heartbeat, бюджеты с hard stop, одобрения, activity log, трассировка до цели | ничего |
| Что не стоит | учётные данные клиентов без Embed-лицензии («it does not matter where credentials are stored — if n8n uses them», https://docs.n8n.io/privacy-and-security/sustainable-use-license, выдержка); бизнес-логика, агенты, метрики; UI в интернете | сервер как runtime; `local_trusted`; CLI-адаптеры с shell; маркетплейс скиллов; хранение секретов клиентов | ни в продукте, ни как gateway уведомлений |
| Как интегрировать | только подписанный webhook → наш route (HMAC + timestamp + nonce, как `whatsapp-web`) → `platform_events` (D3/D7). n8n не получает service-role и токены клиентов | не интегрируем; концепции реализованы в D3 (`agent_configs`, бюджеты, `agent_approvals`, `agent_events`) на Inngest + Supabase | — |
| Что может заменить | ручные внутренние рутины; long-tail SaaS-коннекторы — только при Embed-лицензии | наш реестр, бюджеты и одобрения, но ценой cross-tenant рисков | Telegram-бот уведомлений, который уже есть (Bot API напрямую) |
| Что остаётся своим | агенты, синхронизация CRM и учёта, входящие webhook клиентов, метрики, LLM-цепочки | весь agent runtime (D3) | уведомления и одобрения (D4) |
| Security | CVE-2026-21858 «Ni8mare», CVSS 10.0 (1.65.0–1.120.4, fix 1.121.0; https://www.cyera.com/research/ni8mare-unauthenticated-remote-code-execution-in-n8n-cve-2026-21858, выдержка); 2026-09-30 — 10 advisory, 8 High (Send-and-Wait HMAC bypass, захват owner через MCP-интерпретатор и др., https://github.com/n8n-io/n8n/security/advisories, проверено); все токены под одним `N8N_ENCRYPTION_KEY` | 5 Critical: unauth RCE, cross-tenant выпуск токенов, cross-tenant IDOR ключей, OS command injection, DNS-rebinding RCE CVSS 9.6 (https://github.com/paperclipai/paperclip/security/advisories, проверено) | SECURITY.md: «not designed as a shared multi-tenant boundary»; sandbox по умолчанию off; CVE-2026-25253, CVSS 8.8; ClawHavoc — 341 вредоносный скилл из 2 857 (сторонний источник); ≥73 страниц advisory (проверено) |
| Масштабирование | queue mode: Redis + Postgres + main + N workers + runners | multi-company на одном сервере, изоляция уже ломалась | multi-tenant только «отдельный инстанс на тенанта» |
| Эксплуатация | отдельный хост вне Vercel, обновления каждую неделю, VPN или allowlist IP, бэкап ключа; Cloud €24–800/мес (сторонний источник) | релизы раз в 1–2 недели, молодой продукт | инстанс на клиента — неприемлемо |

Оговорка к D7: решение «n8n как слой для long-tail SaaS-коннекторов через подписанный webhook» упирается в лицензию. Коннекторы на учётных данных клиентов требуют Embed (цена не проверено). До её получения n8n допустим только для внутренних автоматизаций.

### 4.2 Итоговые решения

| Компонент | Решение | Причина |
|---|---|---|
| Inngest (своё ядро: agent loop, tools, budgets, approvals) | **Use** | уже в продакшене; concurrency и throttling с ключом на тенанта, `waitForEvent` для одобрений, `step.ai.infer` (https://www.inngest.com/docs/durable-execution/flow-control/multi-tenancy) |
| OpenRouter, 3 уровня моделей | **Use** | уже выбран; обязательны ZDR, `data_collection: deny`, лимиты ключей, бюджеты (D3) |
| Langfuse | **Use** | в зависимостях `langfuse` 3.x устарел → OTel-SDK v5 `@langfuse/tracing`, Cloud EU, маскирование ПДн |
| Свой read-only MCP-сервер | **Use (P1)** | §3.4 (a) |
| Vercel Workflow | **Use только для omnichannel** | остаётся для уже работающего omnichannel-пайплайна (`workflows/*`); агенты работают на нашем runtime в Inngest, второй движок для агентов не вводим (D7) |
| n8n | **Evaluate later** | SUL требует Embed для клиентских кредов; регулярные Critical/High CVE; отдельная инфраструктура; дублирует Inngest |
| Inngest AgentKit | **Evaluate later** | последний stable 0.13.2 от 2025-11-13, совместимость с inngest v4 не подтверждена; берём идеи, не код |
| LangGraph.js | **Evaluate later** | только для сложных графов внутри одного шага |
| Mastra | **Evaluate later** | как библиотека (хелперы MCP, evals), не как runtime |
| Внешние MCP-серверы | **Evaluate later** | §3.4 (b) |
| «MCP в Битрикс24» | **Evaluate later** | опция для клиентов, которые сами подключают AI; нам нужен детерминированный REST |
| Paperclip | **Do not use** (концепции взяты) | Critical cross-tenant и RCE в 2026; агент = CLI-процесс с shell |
| OpenClaw | **Do not use** | не multi-tenant по замыслу, sandbox off, отравленный маркетплейс, CVE-2026-25253 |
| Temporal | **Do not use** | тяжёлая эксплуатация, не serverless |
| OpenAI Agents SDK | **Do not use** | версия 0.19.0 (до 1.0), ориентирован на OpenAI, а у нас OpenRouter |
| Claude Agent SDK | **Do not use** для тенантов | нужны shell и ФС; сторонние провайдеры не гарантированы; допустим для внутренних dev-задач |
| Сторонние MCP для amoCRM | **Do not use** | официального нет, свой REST-адаптер есть |
| Supabase MCP на prod | **Do not use** | только dev с `read_only` и `project_ref` |

## 5. Правовые и эксплуатационные ограничения

| Ограничение | Суть и источник | Что делаем |
|---|---|---|
| Локализация ПДн, KZ | ст. 12 Закона РК «О персональных данных и их защите»: база ПДн на территории РК (https://zakon.uchet.kz/rus/docs/Z1300000094, выдержка) | решить, где физически живёт Supabase и подходит ли это клиентам РК (юрист; соответствие не проверено) [verify live] |
| Локализация ПДн, РФ | ч. 5 ст. 18 152-ФЗ: первичная база в РФ; о трансграничной передаче заранее уведомить РКН (https://pd.rkn.gov.ru/cross-border-transmission/, выдержка) | то же; без решения юриста не подключать клиентов РФ к LLM и OCR за рубежом с сырыми ПДн |
| Минимизация ПДн | данные CRM (ФИО, телефоны), документы, записи звонков, эмбеддинги | псевдонимизация перед LLM и OCR; эмбеддинги в pgvector под RLS; записи звонков — согласие и минимальный срок |
| Meta в РФ | Meta признана экстремистской 2022-03-21 (https://meduza.io/news/2022/03/21/rossiyskiy-sud-ob-yavil-meta-materinskuyu-kompaniyu-facebook-i-instagram-ekstremistskoy-organizatsiey); WhatsApp под решение не попал | Instagram и Meta Ads — только клиентам KZ; для KZ ограничений не найдено |
| Google Ads в РФ | показ рекламы приостановлен с 2022-03 | Google Ads — только KZ |
| Google CASA и верификация | `drive`/`drive.readonly` — restricted, ежегодный CASA; `spreadsheets` и `analytics.readonly` — sensitive, нужна верификация | Drive только `drive.file` + Picker; Sheets — по возможности service account |
| OpenRouter | ZDR и `data_collection: "deny"` в provider routing; EU-роутинг только на Business/Enterprise (выдержка) | ZDR + `deny` обязательны для запросов с ПДн; лимиты расходов на ключ |
| Langfuse | Cloud EU (Ирландия) (https://langfuse.com/security/data-regions, выдержка) | маскировать ПДн в трейсах |
| Ротация refresh-токенов | amoCRM и Bitrix24 выдают новую пару при обновлении, параллельное обновление ломает пару | обновление в одной Inngest-функции с `concurrency: { key: connection_id, limit: 1 }` |
| Санкции за лимиты | amoCRM блокирует IP (403) при повторных нарушениях; Bitrix24 отвечает 429 | throttle на подключение (§6, P0.3), circuit breaker на 403 |
| Изменения у вендоров | Stripe MCP с 2026-10-31 только Agent Keys/OAuth; Xero платный с 2026-03-02; Slack вне Marketplace — 1 запр./мин; Teams Connectors отключены; WhatsApp — оплата за шаблон | учтено в приоритетах §2 |

## 6. План внедрения по фазам

### 6.1 P0 — сейчас: hardening существующих подключений

| # | Задача | Где | Готово, когда |
|---|---|---|---|
| P0.1 | **Шифрование токенов**: `access_token` (включая полный webhook URL Bitrix24) через `lib/crypto/secrets.ts` (`v1:iv:tag:ct`). Чтение: `v1:` → decrypt, иначе legacy plaintext → перешифровать; разовый backfill через service role. В prod без ключа — fail closed | `crm_provider_connections`, `lib/crm/provider-client.ts`, `/api/v1/crm/connections/**` | в БД нет plaintext-токенов; тест: tamper → ошибка decrypt |
| P0.2 | **SSRF allowlist**: только `https`; хост из allowlist облачных доменов (`*.bitrix24.<tld>`, `*.amocrm.ru`, `*.kommo.com`; полный список — не проверено); коробочный Bitrix24 — только хост, одобренный админом; DNS-резолв с запретом private/loopback/link-local/metadata; `redirect: 'manual'`; тело апстрима клиенту не отдаётся, только код ошибки | `lib/crm/bitrix24.ts`, `lib/crm/amocrm.ts`, `provider-client.ts`, `connections/route.ts:63-66` | тесты: `http://`, `127.0.0.1`, `169.254.169.254`, редирект — отказ; в ответе нет текста апстрима |
| P0.3 | **Throttle на подключение** с проверенными лимитами: синхронизация как Inngest-функция с `concurrency: { key: connection_id, limit: 1 }` (одна синхронизация и одно обновление токена); в адаптере token bucket: Bitrix24 2 запр./с, порог 50 (Enterprise 5/с, 250), `batch` до 50; amoCRM ≤7 запр./с, ≤250 сущностей на страницу. 429 (вкл. `OPERATION_TIME_LIMIT`) → `step.sleep` с backoff; 403 amoCRM → circuit breaker и пауза подключения | `lib/crm/*`, `lib/functions/*` | нагрузочный тест на моке не превышает лимитов; ручная кнопка ставит событие, а не ходит в CRM синхронно |
| P0.4 | **Здоровье интеграций в админке** (D8, «Интеграции/здоровье»): на подключение `last_success_at`, `last_error_code`, `consecutive_failures`, `rate_limited_at`, `token_expires_at`; API отдаёт только несекретные поля (service role после `requireGiga`); N ошибок подряд → `INTEGRATION_FAILED` → уведомление WARNING (D4); исправить переменную Sheets; добавить в проверки `TELEGRAM_WEBHOOK_SECRET` и `SECRETS_ENCRYPTION_KEY` | `/api/giga-admin/system/health`, `app/admin-giga-panel/**` | админ видит статус каждого подключения без доступа к кредам |
| P0.5 | Telegram webhook: секрет обязателен (fail closed), constant-time, dedupe `update_id` (D4) | `app/api/telegram/webhook/route.ts` | без секрета → 401/503 |
| P0.6 | OpenRouter: ZDR + `data_collection: "deny"` в provider routing, лимит расходов на ключ | `lib/ai/openrouter.ts` → gateway (D3) | параметры в каждом запросе, тест на сборку запроса |
| P0.7 | Cron-секреты только в заголовке, constant-time; удалить `/api/notifications/send` | `crm-digest`, `personal/sync` | `?secret=` не принимается |

### 6.2 P1 — следующий квартал

| Что | Детали |
|---|---|
| Свой MCP-сервер (read-only, staff) | §3.4 (a) |
| CRM v2 | OAuth-приложения Bitrix24 и amoCRM с `refresh_token` и сериализованной ротацией; `company_id` в подключениях (D1); плановая синхронизация; воронки, этапы, активности и звонки, а не только 200 сделок и контактов |
| МойСклад | throttle 100 запр./5 с, 5 параллельных; токен только на чтение |
| 1С | пилот OData read-only у одного клиента + шаблон выгрузки как запасной путь |
| Kaspi Магазин API | заказы и товары для e-com клиентов; заменить заглушку `kaspi` в `lib/integrations/ecommerce` |
| Яндекс.Метрика, GA4, Яндекс.Директ | throttle Метрики: 3 параллельных; заменить заглушки `ga4`, `yandex-metrika`; остальные заглушки скрыть из UI |
| Google Drive | `drive.file` + Picker → конвейер документов (D6) |
| Embeddings, OCR, STT | pgvector + RLS; OCR только для сканов; STT для звонков из CRM с согласием |
| Langfuse | переход на OTel-SDK v5, Cloud EU, маскирование ПДн |

### 6.3 P2 — по запросу клиентов
HubSpot, Salesforce, Pipedrive, Stripe, Google Ads (KZ), Meta Ads (KZ), OneDrive/SharePoint, Notion; внешние MCP-серверы через allowlist; «MCP в Битрикс24» как опция клиента; n8n только для внутренних автоматизаций (если появится потребность).
Не делаем: QuickBooks, Xero, Kaspi Pay (прямой API), Dropbox, Slack/Teams для диагностики, сторонние MCP для amoCRM, Supabase MCP на prod, Paperclip, OpenClaw.

### 6.4 BLOCKED

| BLOCKED | Reason | Required input | How to unblock |
|---|---|---|---|
| P0.1 шифрование в prod | наличие `SECRETS_ENCRYPTION_KEY` в prod не проверено (prod недоступен из контейнера); миграции применяет владелец | подтверждение ключа в Vercel env; окно для backfill | владелец проверяет env [verify live], применяет миграцию и запускает backfill |
| P0.2 allowlist доменов | полный список облачных доменов Bitrix24 и amoCRM/Kommo не проверен | официальный список TLD/доменов | сверить с документацией вендоров, зафиксировать в конфиге |
| CRM v2: OAuth Bitrix24 | нужно зарегистрированное приложение (локальное или тиражное) | `client_id`, `client_secret`, redirect URI, аккаунт разработчика | владелец регистрирует приложение, секреты — в Vercel env |
| CRM v2: OAuth amoCRM/Kommo | нужна публичная интеграция | `client_id`, `client_secret`, redirect URI | владелец создаёт интеграцию в аккаунте разработчика amoCRM |
| GA4, Sheets, Drive | sensitive scopes требуют OAuth-клиента и верификации приложения Google | проект GCP, OAuth consent screen, домен, политика конфиденциальности | владелец создаёт проект и проходит верификацию; Drive только `drive.file` (без CASA) |
| Метрика, Директ | нужно OAuth-приложение Яндекса; для Директа — заявка на доступ к API | `client_id`/`secret`, одобренная заявка Директа | владелец регистрирует приложение и подаёт заявку |
| 1С, МойСклад, Kaspi Магазин | данные у клиента | пилотный клиент: публикация OData/VPN (1С), токен МойСклад, токен Kaspi от руководителя | менеджер договаривается с пилотным клиентом |
| OCR и STT | не выбран провайдер, нет ключей, не решена резидентность данных | ключ выбранного провайдера, решение юриста | владелец выбирает провайдера после §5 |
| MCP-сервер (P1) | не проверено, подходит ли Supabase Auth как OAuth 2.1 AS (RFC 9728, PKCE, audience) | решение по AS | спайк: проверить Supabase Auth, иначе выбрать отдельный AS |
| Локализация ПДн (KZ/РФ) | нужна юридическая оценка | регион Supabase, договоры с клиентами РК/РФ | юрист даёт заключение; до него — минимизация ПДн и ZDR |
| n8n для клиентских коннекторов | Embed-лицензия, цена не опубликована | коммерческое предложение n8n | запрос в отдел продаж n8n; до этого — только внутренние автоматизации |
| Meta Ads, Google Ads (P2) | App Review, Business Verification, developer token | бизнес-аккаунты Meta и Google Ads | по первому запросу клиента из KZ |

## 7. WhatsApp: шаблоны для одобрения в Meta

Уведомления платформы в WhatsApp (сотрудникам, экспертам, клиентам) уходят только одобренными шаблонами Meta: вне 24-часового окна обслуживания свободный текст не доставляется (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview). Код отправляет только переменные (`lib/whatsapp/templates.ts`), поэтому шаблон в WhatsApp Manager должен совпадать с таблицей ниже **дословно**: имя, категория, язык, текст, число переменных, кнопка. Несовпадение Meta отклоняет (ошибки семейства 132000), очередь записывает такую отправку как окончательно неудачную. Как подключить номер и токен — `docs/platform/10-bot-and-credentials.md`, часть 3.

Общие правила:
- язык — `ru` (Russian); если одобряете на другом коде языка, задайте его в `WHATSAPP_TEMPLATE_LANG`;
- `{site}` в URL кнопки — адрес продакшена портала (тот же, что `NEXT_PUBLIC_APP_URL`, например `https://portal.aistart360.app`). Тип кнопки — **Visit website → Dynamic**: URL `{site}/{{1}}`, код подставляет путь;
- переменные не содержат переносов строк и табуляций (код их заменяет);
- статус «не проверено вживую»: отправка шаблонов и обратные статусы проверены только на контрактных тестах (запрос собирается по документации, ответ подставной).

| Имя | Категория | Кому | Когда |
|---|---|---|---|
| `staff_alert` | Utility | сотрудникам GIGA с привязанным WhatsApp | события уровня «Внимание» и выше, запросы одобрения (решение — по ссылке в GIGA) |
| `expert_notification` | Utility | экспертам | диагностика завершена, новый клиент одобрен, обращение к эксперту |
| `report_review` | Utility | экспертам | версия отчёта ждёт проверки (`enqueueReportReviewWhatsApp`) |
| `digest` | Utility | клиентам, подтвердившим номер | утренний CRM-дайджест |
| `phone_verification` | Authentication | любому, кто привязывает номер | код подтверждения номера |

### 7.1 `staff_alert` (Utility)
Текст:
```
AIStart360, уведомление команде ({{1}}): {{2}}.
{{3}}
Подробности — в панели GIGA.
```
Переменные: `{{1}}` уровень (пример: `Внимание`), `{{2}}` заголовок (`Агент не справился с задачей`), `{{3}}` подробности одной строкой (`Агент: report_builder · Ошибка: timeout`).
Кнопка: Visit website, Dynamic, текст «Открыть в GIGA», URL `{site}/{{1}}`, пример `admin-giga-panel/notifications`.

### 7.2 `expert_notification` (Utility)
Текст:
```
AIStart360, уведомление эксперту: {{1}}.
{{2}}
Подробности — в кабинете эксперта.
```
Переменные: `{{1}}` событие (`Диагностика завершена`), `{{2}}` подробности (`Клиент: ТОО Ромашка · Точка А: 64/100`).
Кнопка: Visit website, Dynamic, «Открыть кабинет», URL `{site}/{{1}}`, пример `expert`.

### 7.3 `report_review` (Utility)
Текст:
```
Отчёт «{{1}}», версия {{2}} от {{3}}, клиент: {{4}}.
Отчёт ждёт вашей проверки: подтвердите публикацию или отправьте его на доработку.
```
Переменные: `{{1}}` название (`Диагностика бизнеса`), `{{2}}` номер версии (`3`), `{{3}}` дата версии (`06.10.2026`), `{{4}}` клиент (`ТОО Ромашка`).
Кнопка: Visit website, Dynamic, «Проверить отчёт», URL `{site}/{{1}}`, пример `expert/reports`.

Вызывается из `deliverReportForReview` (`lib/reports/review-delivery.ts`) при `REPORT_GENERATED` со статусом `in_review`, вместе с Telegram и email; кнопка ведёт в `/expert/reports?review=<id>`. API: `enqueueReportReviewWhatsApp(versionId, recipients?, { reviewPath? })` из `lib/whatsapp/report-review.ts` — по одному сообщению на эксперта и версию (идемпотентно), только экспертам с подтверждённым номером и согласием; `reviewPath` — относительный путь для кнопки (например, подписанная ссылка `/r/v/<token>`).

### 7.4 `digest` (Utility)
Текст:
```
Сводка CRM AIStart360 на сегодня.
Напоминаний на сегодня и просроченных: {{1}}.
Клиентов без контакта больше 30 дней: {{2}}.
Слабый блок GRI: {{3}}.
Откройте раздел «Клиенты», чтобы связаться с ними.
```
Переменные: `{{1}}` число напоминаний (`3`), `{{2}}` число «спящих» клиентов (`5`), `{{3}}` слабый блок GRI или «нет данных» (`Денежная стабильность (2.1)`).
Кнопка: Visit website, Dynamic, «Открыть «Клиенты»», URL `{site}/{{1}}`, пример `pulse`.

### 7.5 `phone_verification` (Authentication)
Категория Authentication, тип доставки кода **Copy code**, кнопка «Скопировать код». Текст тела для этой категории Meta формирует сама (код + по желанию рекомендация безопасности и срок действия); включите:
- «Add security recommendation» (не сообщайте код);
- «Add expiry time for the code» — 10 минут (код живёт 10 минут: `VERIFY_TTL_MINUTES`).

Переменная одна — 6-значный код; код отправляет его и в тело, и в параметр кнопки копирования.

### 7.6 Транспорт и надёжность
- Очередь `whatsapp_outbox` (миграция 104): идемпотентный ключ на сообщение, захват строк `FOR UPDATE SKIP LOCKED`, проверка согласия и подтверждённого номера в момент отправки, повторы с экспоненциальной паузой (до 5 попыток), таймаут после отправки — `delivery_unknown` без автоматического повтора. Статусы `sent → delivered → read / failed` приходят на `/api/webhooks/meta` (подпись `X-Hub-Signature-256` секретом `META_APP_SECRET`; без секрета вебхук отвечает 503).
- Очередь разбирается сразу после постановки и затем кроном (`/api/cron/agents`, Inngest `agents-maintenance` каждую минуту, до 50 строк за проход).
- Мост WhatsApp Web (`docs/WHATSAPP-WEB-BRIDGE.md`) — только запасной канал для сотрудников: при `WHATSAPP_WEB_BRIDGE_FALLBACK=1`, если Cloud API не настроен или окончательно отклонил сообщение; отправляется простой текст с ключом идемпотентности `wa-outbox:<id>`. Клиентам и экспертам мост не используется никогда (неофициальный транспорт).
- SMS остаётся заглушкой.
