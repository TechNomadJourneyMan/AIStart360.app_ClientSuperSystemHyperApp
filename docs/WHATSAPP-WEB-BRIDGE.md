# WhatsApp Web bridge: QR + Baileys WebSocket

Экспериментальный коннектор связывает единый inbox с обычным WhatsApp через
Baileys. Постоянный bridge держит WebSocket с WhatsApp; Vercel-приложение
показывает QR, принимает подписанные входящие события и отправляет подписанные
команды ответа.

> Это неофициальное подключение. Оно может привести к разлогину, ограничению
> или блокировке номера. Первый запуск делайте только на отдельном тестовом
> номере и в режиме **Черновик**. Для основного production-номера предпочтителен
> официальный WhatsApp Cloud API.

## Почему bridge отдельный

Vercel Functions не подходят для постоянной WhatsApp Web-сессии: процесс
эфемерный, WebSocket ограничен временем выполнения, а локальный диск не хранит
auth state между экземплярами. Поэтому:

```text
ГИГА-Панель / Next.js (Vercel)
    ↕ signed HTTPS
постоянный Node bridge + persistent volume
    ↕ WebSocket
WhatsApp
```

Bridge запускается локально, на VPS либо в одном постоянном контейнере
(Railway/Fly/Render и аналоги). Нельзя запускать несколько replicas для одной
сессии.

## Быстрый локальный запуск

Требуется Node.js 20+.

1. Сгенерируйте **два разных** секрета:

   ```bash
   openssl rand -hex 32
   openssl rand -hex 32
   ```

2. Добавьте в локальный `.env`:

   ```dotenv
   WHATSAPP_WEB_BRIDGE_ENABLED=true
   WHATSAPP_WEB_BRIDGE_URL=http://127.0.0.1:3100
   WHATSAPP_WEB_BRIDGE_SESSION_ID=primary
   WHATSAPP_WEB_BRIDGE_API_SECRET=<первый-секрет>
   WHATSAPP_WEB_BRIDGE_API_KEY_ID=primary
   WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET=<второй-секрет>
   WHATSAPP_WEB_BRIDGE_TIMEOUT_MS=10000

   BRIDGE_HOST=127.0.0.1
   BRIDGE_PORT=3100
   BRIDGE_SESSION_ID=primary
   BRIDGE_API_SECRET=<тот-же-первый-секрет>
   BRIDGE_AUTH_DIR=./services/whatsapp-web-bridge/.data/auth
   BRIDGE_STATE_DIR=./services/whatsapp-web-bridge/.data/state
   BRIDGE_AUTOSTART=false
   # Обычный безопасный режим: оба флага истории выключены.
   SYNC_FULL_HISTORY=false
   HISTORY_FULL_SYNC_MAINTENANCE=false
   FORCE_HISTORY_RESYNC=false
   PORTAL_WEBHOOK_URL=http://127.0.0.1:3000/api/webhooks/whatsapp-web
   PORTAL_WEBHOOK_SECRET=<тот-же-второй-секрет>
   PORTAL_WEBHOOK_KEY_ID=primary

   # Безопасный импорт накопленных сообщений (append), по умолчанию 14 дней.
   CATCH_UP_MESSAGE_MAX_AGE_SECONDS=1209600
   CATCH_UP_MAX_MESSAGES_TOTAL=200
   CATCH_UP_MAX_MESSAGES_PER_CHAT=20
   HISTORY_BUFFER_MAX_CHUNKS=64
   HISTORY_BUFFER_MAX_CHATS=5000
   HISTORY_BUFFER_MAX_MESSAGES=20000
   ```

   `BRIDGE_API_SECRET` и `PORTAL_WEBHOOK_SECRET` должны отличаться. Файлы
   `.env` и `.data` уже исключены из git.

3. Запустите портал и bridge в двух терминалах:

   ```bash
   npm run dev
   npm run whatsapp-web:bridge
   ```

4. Войдите в ГИГА-Панель под личным `super_admin`, откройте
   **Instagram / WhatsApp → Режимы AI и база ответов** и убедитесь, что WhatsApp
   стоит в режиме **Черновик**.

5. В карточке **WhatsApp Web по QR** нажмите **Получить QR-код**. На телефоне:
   **WhatsApp → Связанные устройства → Привязать устройство**, затем
   отсканируйте QR.

6. После статуса **Подключён** отправьте тестовое сообщение на номер. Оно
   появится в inbox. Сначала проверьте AI-черновик и отправку оператором; режим
   **Авто** включайте отдельно только после тестов.

Break-glass вход по общему паролю не может привязывать аккаунт по умолчанию.
Временный override `WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING=true`
существует для аварийного локального запуска, но снижает безопасность и должен
быть снова выключен сразу после привязки.

## Production-конфигурация

Для портала на Vercel задаются только `WHATSAPP_WEB_BRIDGE_*`. Для отдельного
bridge-контейнера задаются `BRIDGE_*` и `PORTAL_*`:

- `WHATSAPP_WEB_BRIDGE_URL` — HTTPS origin bridge;
- `PORTAL_WEBHOOK_URL` — production URL
  `https://<portal>/api/webhooks/whatsapp-web`;
- `PORTAL_JOB_DRAIN_URL=/api/webhooks/whatsapp-web/drain` — подписанный
  recovery-trigger устойчивой очереди (каждые 10 секунд);
- на портале `OMNICHANNEL_PROCESSING_BACKEND=database`,
  `OMNICHANNEL_PERSISTENCE=postgres` и отдельный least-privilege
  `OMNICHANNEL_DATABASE_URL`; широкий `DATABASE_URL` не используется;
- `/data` — постоянный volume;
- одна replica на `BRIDGE_SESSION_ID`;
- `BRIDGE_AUTOSTART=true` после первой успешной привязки;
- `/health` использовать как liveness процесса, а `/ready` — как readiness для
  трафика и алертов;
- TLS, закрытый ingress/allowlist и Upstash Redis для server-side rate limits.

Рекомендуемый постоянный контейнер:

```bash
cd services/whatsapp-web-bridge
cp .env.example .env
# заполните два разных секрета и production PORTAL_WEBHOOK_URL
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/ready
```

`GET /health` не возвращает QR, номер, JID или тексты и остаётся `200`, пока
сам процесс обслуживает HTTP. Это liveness, а не подтверждение подключения.
`GET /ready` возвращает `200` только при подключённой WhatsApp-сессии, здоровом
сохранении auth state и незаблокированном/непереполненном durable outbox; иначе
возвращает `503` с безопасными агрегированными checks. Все control/send
эндпоинты требуют HMAC с timestamp, nonce, audience, method, path и SHA-256
точного raw body. QR доступен браузеру только через авторизованный server-side
proxy ГИГА-Панели и не сохраняется в Supabase/localStorage/логах.

Перед отправкой в портал каждое входящее событие атомарно сохраняется в
`BRIDGE_STATE_DIR/webhook-outbox`. Сетевые ошибки, `408`, `429` и `5xx` остаются
там для повторной доставки; постоянные остальные `4xx` переносятся в owner-only
`webhook-dead-letter`. Проверяйте `last_webhook_error` и dead-letter отдельно:
после карантина постоянной ошибки активный outbox снова может стать ready, но
запись всё равно требует разбора оператором.

На bridge повтор nonce блокируется локальным краткоживущим cache. Входящий
webhook портала работает в stateless Vercel Functions: его защита от повторной
обработки основана на стабильном `event_id`, уникальной записи
`omnichannel_webhook_events` и атомарной аренде обработки. `received`/`failed`
можно захватить сразу, свежий `processing` получает retryable HTTP 503, а
зависший `processing` можно атомарно подхватить через две минуты. Bridge до
успешного HTTP 2xx сохраняет такое событие в durable outbox. Только уже
поставленные в устойчивую очередь (`queued`) или завершённые
`processed`/`ignored` события получают HTTP 200 без повторного ingest/enqueue.
Поэтому отдельный Redis только для nonce входящего webhook не требуется; Redis
всё ещё может использоваться для общего rate limiting.

`OMNICHANNEL_INLINE_PROCESSING=true` разрешён только при
`NODE_ENV=development`. В production значение игнорируется. Режим
`OMNICHANNEL_PROCESSING_BACKEND=database` сначала фиксирует задание в Postgres,
а уже затем подтверждает webhook. `run_at`, lease, fencing token, retry/backoff
и порядок внутри диалога также хранятся в Postgres. Vercel `waitUntil` — только
быстрый путь; подписанный trigger от постоянно работающего bridge восстанавливает
обработку после cold start или завершения Function.

## Что обрабатывается

- новые `notify`-сообщения из личных чатов обрабатываются как live;
- накопленные `append`-сообщения и выбранные из `messaging-history.set`
  непрочитанные импортируются не старше 14 дней, не более 200 за одно
  подключение и не более 20 на чат; они никогда не запускают автоотправку;
- явная команда **«Разобрать WhatsApp»** берёт до 100 уже сохранённых,
  ещё не разобранных входящих catch-up сообщений и создаёт только AI-черновики
  с `force_draft=true`;
- `fromMe`, группы, status/broadcast/newsletter и protocol messages
  игнорируются;
- все сообщения Baileys batch обрабатываются, а не только первый элемент;
- LID хранится как непрозрачный canonical ID; он не выдаётся за номер телефона;
- старая история не рассылается клиентам и не ставится в автоответ;
- импорт является best-effort и ограничен тем, что WhatsApp реально передал
  companion-у: он не гарантирует полный архив или все непрочитанные;
- `INITIAL_BOOTSTRAP`/`RECENT` освобождаются только после фактического пакета
  `RECENT progress=100`: более ранний статус `complete` сам по себе импорт не
  запускает, а `paused`, повреждённый пакет или превышение лимита очищает буфер
  без частичного выпуска накопленного;
- метрики истории всегда честно имеют `partial=true` и содержат только числа
  `received`/`unread`/`filtered`; JID, имена, ID и тексты в эти логи не попадают;
- дубликаты provider message ID отбрасываются, а известные PN/LID-псевдонимы
  используют общий лимит одного чата;
- interactive choices Web-транспорта отправляются как обычный нумерованный
  текст, Cloud API продолжает использовать штатный list message;
- каждая исходящая команда имеет idempotency key. Timeout считается
  неоднозначным результатом и не ретраится вслепую.

`SYNC_FULL_HISTORY=true` — лишь pairing-time запрос/профиль Desktop, а не
гарантия получения полного архива. Пакеты типа `FULL` по умолчанию всё равно
отбрасываются и принимаются только при отдельном явном
`HISTORY_FULL_SYNC_MAINTENANCE=true`. Даже в maintenance-режиме импорт остаётся
частичным, только входящим, только для личных чатов и подчиняется возрастному,
общему, per-chat и buffer-лимитам. В обычной работе оба флага оставляйте
`false`; их выбирают до новой привязки отдельного тестового номера, а не меняют
на уже подключённой live-сессии. `FORCE_HISTORY_RESYNC=true` не запрашивает
историю с телефона и не восстанавливает уже потреблённый snapshot.

## Важное ограничение auth state

Текущий однопроцессный bridge использует `useMultiFileAuthState` на owner-only
persistent volume. Это подходит для локального MVP/canary, но файлы являются
долгоживущими ключами аккаунта и не зашифрованы самим Baileys. Для серьёзного
production нужны encrypted DB/KMS-backed auth state, distributed lease/fencing,
резервирование outbox и отдельный план ротации/удаления ключей.

Для выхода нажмите **Отключить** в панели. Bridge вызывает logout связанного
устройства и удаляет локальный auth state; для повторного входа потребуется
новый QR.

## Диагностика

- `QR-коннектор выключен` — проверьте `WHATSAPP_WEB_BRIDGE_ENABLED=true`;
- `bridge_not_configured` — заполнены не все четыре app-side параметра URL,
  session id, API secret и webhook secret;
- `bridge_unavailable` — bridge не запущен, URL недоступен или TLS/ingress
  блокирует запрос;
- `invalid_signature` — app/bridge используют разные секреты, key id, path или
  часы серверов расходятся более чем на 60 секунд;
- `session_disconnected` — QR ещё не отсканирован либо WhatsApp отвязал
  companion device;
- `/health` отвечает `200`, но `/ready` — `503` — процесс жив, однако WhatsApp
  не подключён, auth state ещё не сохранён либо outbox заблокирован/переполнен;
- `provider_send_ambiguous` — не повторяйте ответ, пока оператор не проверит
  чат вручную.
