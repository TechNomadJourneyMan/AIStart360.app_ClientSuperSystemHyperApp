# AIStart360 WhatsApp Web bridge

Persistent single-session transport between the AIStart360 portal and a linked
WhatsApp companion device. Pairing happens with a QR payload exposed only by an
HMAC-authenticated status endpoint. The service is a separate long-running
container; do not deploy it as a Vercel Function.

> This uses the unofficial WhatsApp Web protocol through `baileys`. It does not
> remove the risk of logout or account restrictions. Start with a non-critical
> test number and draft/manual replies. The official WhatsApp Cloud API remains
> the safer production transport.

## Security boundary

- `BRIDGE_API_SECRET` authenticates portal-to-bridge control and send calls.
- `PORTAL_WEBHOOK_SECRET` signs bridge-to-portal message events. It must be a
  different random secret.
- QR data is kept only in memory, is never logged, and is returned only by the
  signed session status endpoint.
- `BRIDGE_AUTH_DIR` contains account-equivalent credentials. Mount a private,
  encrypted persistent volume and never copy this directory into logs, images,
  backups without encryption, support tickets, or AI tools.
- Run exactly one bridge process/replica per `BRIDGE_SESSION_ID`. This service
  intentionally has no distributed leader election.
- Fresh `messages.upsert` events with `type=notify`, `fromMe=false`, and a
  one-to-one `@s.whatsapp.net`/`@lid` JID are forwarded as live messages.
  Bounded `type=append` batches are forwarded as offline catch-up; groups,
  status/broadcast traffic, protocol messages, and self messages are ignored.
  A `messaging-history.set` import is restricted to chats whose
  `unreadCount > 0` and to each chat's newest `unreadCount` inbound messages.
  History chunks are retained only within explicit chunk/chat/message bounds.
  A paused or oversized stream is cleared and imports nothing from that stream.
- Inbound events are spooled under `BRIDGE_STATE_DIR/webhook-outbox` before
  delivery using an fsynced temporary file plus atomic rename. Permanent portal
  4xx responses (except retryable `408`/`429`) are moved to the owner-only
  `BRIDGE_STATE_DIR/webhook-dead-letter` directory; retryable failures stay in
  the outbox. The portal must deduplicate `event_id` and acknowledge only after
  durable persistence.
- Outbound `idempotency_key` results are retained in a persistent bounded cache.
  An ambiguous send is never aged out or evicted and is never blindly repeated
  with the same key. At the configured boundary, only the oldest confirmed
  `sent` result may be compacted; if protected ambiguous outcomes consume the
  capacity, new sends fail closed.

## Required environment

```dotenv
NODE_ENV=production
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8787
BRIDGE_SESSION_ID=primary
BRIDGE_API_SECRET=<different random secret, at least 32 bytes>
BRIDGE_API_KEY_ID=primary
BRIDGE_AUTH_DIR=/data/auth
BRIDGE_STATE_DIR=/data/state
BRIDGE_AUTOSTART=false
SYNC_FULL_HISTORY=false
HISTORY_FULL_SYNC_MAINTENANCE=false
FORCE_HISTORY_RESYNC=false

PORTAL_WEBHOOK_URL=https://portal.example.kz/api/webhooks/whatsapp-web
PORTAL_WEBHOOK_SECRET=<different random secret, at least 32 bytes>
PORTAL_WEBHOOK_KEY_ID=primary
# Optional, blank disables it. A pathname is resolved on the webhook origin.
PORTAL_JOB_DRAIN_URL=/api/webhooks/whatsapp-web/drain
PORTAL_JOB_DRAIN_INTERVAL_MS=10000
PORTAL_JOB_DRAIN_TIMEOUT_MS=5000

# Default direct keeps the existing portal → bridge send endpoint. Pull makes
# the bridge fetch fenced deliveries from the portal and needs no public bridge
# URL for customer sends.
WHATSAPP_WEB_DELIVERY_MODE=direct
PORTAL_OUTBOUND_READY_INTERVAL_MS=1000
PORTAL_OUTBOUND_IDLE_INTERVAL_MS=10000
PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS=10000
PORTAL_OUTBOUND_TIMEOUT_MS=5000
```

`BRIDGE_AUTOSTART=true` reconnects a previously linked session on process
startup. It never creates an unauthenticated QR session at boot. For local
development only, an HTTP webhook on `localhost`, `127.0.0.1`, or `::1` is
allowed when `NODE_ENV` is not `production`. Production requires HTTPS unless
`ALLOW_INSECURE_LOCALHOST=true` is deliberately set for a same-host setup.

Optional bounds have conservative defaults:

```dotenv
MAX_BODY_BYTES=32768
MAX_TEXT_CHARS=4096
LIVE_MESSAGE_MAX_AGE_SECONDS=300
SYNC_FULL_HISTORY=false
HISTORY_FULL_SYNC_MAINTENANCE=false
FORCE_HISTORY_RESYNC=false
CATCH_UP_MESSAGE_MAX_AGE_SECONDS=1209600
CATCH_UP_MAX_MESSAGES_TOTAL=200
CATCH_UP_MAX_MESSAGES_PER_CHAT=20
HISTORY_BUFFER_MAX_CHUNKS=64
HISTORY_BUFFER_MAX_CHATS=5000
HISTORY_BUFFER_MAX_MESSAGES=20000
OUTBOUND_RATE_PER_MINUTE=30
OUTBOUND_MIN_INTERVAL_MS=1000
MAX_SEND_QUEUE=100
HTTP_RATE_PER_MINUTE=120
COMMAND_CACHE_TTL_SECONDS=604800
COMMAND_CACHE_MAX_ENTRIES=5000
WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=5
WEBHOOK_OUTBOX_MAX_ENTRIES=10000
SHUTDOWN_GRACE_MS=15000
```

`PORTAL_JOB_DRAIN_URL` is an optional best-effort recovery trigger for the
portal's durable message-processing queue. It accepts either an absolute path
on `PORTAL_WEBHOOK_URL`'s origin or a full URL with that exact same origin.
HTTPS is required; the existing loopback-only local HTTP exception also
applies. The bridge calls it only while WhatsApp is connected, never overlaps
requests, retries on a later interval after any failure, and does not include
its status in `/ready`. Shutdown clears its timer and waits only within the
normal bounded grace period for an already in-flight request.

`WHATSAPP_WEB_DELIVERY_MODE=pull` enables the durable outbound pull path. A
reply is first stored transactionally in the portal database under a stable
idempotency key. The bridge claims a fenced lease, shows a bounded composing
pause, asks the portal to re-authorize every safety gate, then uses the same
persistent local command cache and serialized provider send as direct mode.
Only known failures that happen before a provider call are requeued. A crash or
ambiguous failure after authorization becomes `delivery_unknown`, pauses the
conversation for a person, and is never sent again automatically. Outside the
bounded cutover/drain sequence, keep portal and bridge on the same mode;
`direct` remains the default.
Polling starts at one second while work is flowing, exponentially backs off to
`PORTAL_OUTBOUND_IDLE_INTERVAL_MS` after empty claims, and uses the offline
interval while WhatsApp is disconnected. With the 10-second idle default, a
continuously connected but idle bridge makes at most about 8,640 claim calls
per day instead of 86,400. `/ready` becomes unhealthy after repeated portal
failures or while a provider result still needs durable acknowledgement.
The signed claim/authorize/result endpoints remain drain-capable while the
portal producer is in `direct` mode. This permits a no-loss cutover (bridge
first, portal second) and a no-loss rollback (portal first, wait for zero
nonterminal deliveries, bridge second).

## HMAC protocol

All `/v1/*` requests and portal webhooks use these headers:

```text
x-wa-bridge-version: v1
x-wa-bridge-audience: whatsapp-web-bridge | aistart360-portal
x-wa-bridge-timestamp: 10-digit Unix seconds
x-wa-bridge-nonce: unique 8-128 character token
x-wa-bridge-key-id: primary
x-wa-bridge-signature: sha256=<lowercase hex HMAC>
```

Canonical bytes are UTF-8:

```text
v1\nMETHOD\nAUDIENCE\nPATH\nSHA256(raw-body)\nTIMESTAMP\nNONCE\nKEY_ID
```

`PATH` is the exact URL pathname without query/fragment. The accepted clock
skew is 60 seconds. Bridge control endpoints keep a process-local nonce cache
and accept a verified nonce only once during that window. The stateless portal
webhook instead uses the stable `event_id` and a durable, atomically claimed
audit row to reject processing replays across instances and deployments; it
does not require an external Redis nonce store. Sign the exact raw JSON bytes
that are sent; re-serializing JSON changes the signature.

When the optional queue trigger is enabled, the bridge sends `POST` to the
exact `PORTAL_JOB_DRAIN_URL` pathname using the same portal audience, key ID,
and `PORTAL_WEBHOOK_SECRET`. Its exact raw JSON body is:

```text
{"version":1,"session_id":"primary"}
```

The real configured session ID replaces `primary`. The endpoint should verify
the signature against the exact request pathname and raw bytes, reject replayed
nonces within the accepted skew window, require exactly the two JSON keys
above, and return any `2xx` after accepting the trigger. The request contains
no message, contact, JID, phone number, or queue payload. A non-`2xx`, timeout,
or network error is merely retried on a later interval and never makes the
WhatsApp transport unready.

## API

Every path below may be mounted below a static reverse-proxy prefix; that prefix
is part of the signed path.

- `GET /health` — public, presence-only health. Never contains QR, JID, phone,
  secrets, or auth paths.
- `GET /ready` — public readiness. Returns `200` only when WhatsApp is
  connected, auth persistence is healthy, and the webhook outbox is healthy
  and below capacity; otherwise returns `503`. Its diagnostics contain only
  sanitized checks, outbox depth, saturation, and last webhook success/error
  timestamps/status.
- `GET /v1/sessions/:session/status` — signed; returns `state`, `connected`,
  timestamps, and a transient `qr` only while pairing.
- `POST /v1/sessions/:session/connect` — signed JSON
  `{ "idempotency_key": "..." }` plus the same `Idempotency-Key` header.
- `POST /v1/sessions/:session/logout` — same request shape; unlinks the device
  and removes local auth credentials.
- `POST /v1/sessions/:session/messages` — signed JSON:

```json
{
  "to": "77001234567@s.whatsapp.net",
  "type": "text",
  "text": "Добрый день!",
  "idempotency_key": "omnichannel:auto:message-id",
  "reply_to_message_id": "optional-inbound-id"
}
```

- `POST /v1/sessions/:session/presence` — signed JSON
  `{ "to": "77001234567@s.whatsapp.net", "presence": "composing" }`.
  `presence` accepts only `composing` or `paused`. The call is cosmetic and is
  never placed in the durable message send queue.

`message.live=false` identifies an offline catch-up message from either an
`append` batch or the bounded unread-history selector. The portal persists
`catchUp`/`offline` metadata without auto-sending. The explicit
**Разобрать WhatsApp** action selects an additional bounded batch of already
persisted, not-yet-analysed catch-up messages and processes each with
`force_draft=true`, even when the channel is configured for auto replies.
The default catch-up window is 14 days, with at most 200 messages total and 20
per chat across both sources in one bridge connection. History candidates are
sent chronologically after selecting only the newest `unreadCount` inbound
messages from positive-unread, one-to-one chats. Those budgets reset on
reconnect; stable event/message IDs keep portal ingestion idempotent. This is a
best-effort bounded import of what WhatsApp supplies to the companion device,
not a guaranteed export of every historical or unread message. Its sanitized
metrics report only aggregate `partial`, `received`, `unread`, and `filtered`
counts; `partial=true` is intentional and no JID, message ID, name, or text is
logged. Provider message IDs are deduplicated and known PN/LID aliases share one
per-chat quota.

`INITIAL_BOOTSTRAP` and `RECENT` chunks are buffered only up to
`HISTORY_BUFFER_MAX_CHUNKS`, `HISTORY_BUFFER_MAX_CHATS`, and
`HISTORY_BUFFER_MAX_MESSAGES`. The buffer is released only after the explicit
`RECENT progress=100` payload. A preceding `complete` milestone does not release
it; `paused`, malformed input, or a limit breach clears the buffer and fails
closed.

`SYNC_FULL_HISTORY=true` is only a pairing-time request hint that makes Baileys
advertise a Desktop companion. It does not prove that WhatsApp returned full
history. `FULL` payloads are discarded unless the separate explicit
`HISTORY_FULL_SYNC_MAINTENANCE=true` opt-in is also set. Even then, processing
remains partial, inbound-only, one-to-one, age-limited, quota-limited, and
buffer-bounded. Keep both flags false in normal operation. Decide them before a
fresh pairing on a non-critical test number; do not change the advertised device
profile under an already-linked live session.

`FORCE_HISTORY_RESYNC=true` is only a best-effort replay aid for a history
notification that is still pending: it clears only Baileys' local
`processedHistoryMessages` once and writes
`BRIDGE_STATE_DIR/history-resync.applied`. It does not request history from the
phone and cannot recover an already-consumed server snapshot. Keep the force
flag false during normal operation; deleting the marker and forcing again must
be a deliberate maintenance action with the bridge stopped.

`Idempotency-Key` is mandatory and must equal `idempotency_key`. Only text and
one-to-one JIDs are accepted. A successful response includes `message_id`.
The public `/health` and `/ready` probes have a separate IP budget from signed
control routes. A control request consumes its budget only after its HMAC has
been verified, so unauthenticated traffic through a shared reverse-proxy source
address cannot exhaust the portal's quota. The connect-specific 15-minute
brute-force limit remains in addition to that authenticated request limit.

`/ready` exposes a sanitized `idempotency_cache` object with current/max entry
counts, protected ambiguous count, saturation, eviction/expiry counters, and
last eviction/saturation timestamps. Saturation also makes the bridge not ready
and emits one rate-limited structured error log until capacity recovers.

Compatibility aliases `/v1/session/status`, `/v1/session/connect`,
`DELETE /v1/session`, and `/v1/messages` remain available for the earlier
single-session control contract.

## Portal webhook envelope

The bridge POSTs the following signed envelope. LIDs remain opaque; the bridge
never invents a phone number from a LID.

```json
{
  "version": 1,
  "event_id": "stable-sha256-id",
  "event_type": "message",
  "session_id": "primary",
  "message": {
    "id": "provider-message-id",
    "remote_jid": "opaque-id@lid",
    "remote_jid_alt": "77001234567@s.whatsapp.net",
    "push_name": "Клиент",
    "timestamp_ms": 1750000000000,
    "text": "Здравствуйте",
    "message_type": "text",
    "live": true,
    "from_me": false
  }
}
```

## Run

```bash
npm ci
npm run check
npm start
```

Or build and run the container with a persistent volume:

```bash
docker build -t aistart360-whatsapp-web-bridge .
docker run -d --name aistart360-whatsapp-web-bridge \
  --restart unless-stopped --init --read-only \
  --security-opt no-new-privileges --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --stop-timeout 30 \
  -p 127.0.0.1:8787:8787 \
  -v whatsapp-bridge-data:/data \
  --env-file .env \
  aistart360-whatsapp-web-bridge
```

Place TLS and network access control in front of the bridge. Do not expose the
container port directly to the public internet even though requests are signed.
Use `/health` only for process liveness. Gate traffic and operational alerts on
`/ready`; a disconnected WhatsApp session or blocked/saturated outbox returns
`503` there while `/health` intentionally remains `200` as long as the process
can serve HTTP.

For the hardened persistent setup, copy `.env.example` to an untracked `.env`
in this directory and run:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/ready
```

The final readiness check succeeds only after the linked WhatsApp session is
connected and both auth persistence and the durable webhook outbox are healthy.
Monitor `last_webhook_error` and the owner-only `webhook-dead-letter` directory
as separate alerts: a quarantined permanent rejection no longer blocks the
active outbox, so readiness can recover while operator review is still needed.

## Railway deployment

Use a paid always-on Railway service (Hobby or higher) with the service root
set to this directory. Railway Free/Trial does not support the `ALWAYS` restart
policy required for this bridge. Attach exactly one persistent volume at
`/data`, keep one replica, and leave Serverless mode disabled. `railway.json`
requires that mount, disables application sleep, and uses `/health` for deploy
health because `/ready` intentionally remains unavailable until WhatsApp is
paired and connected.

The image starts as root only long enough to create the volume directories,
then `docker-entrypoint.sh` drops to UID/GID `10001`. Do not set
`RAILWAY_RUN_UID`; the application itself must not remain root. The
`.dockerignore` file excludes local auth/state and dotenv files from the remote
build context.

Required Railway-specific values in addition to the environment above:

```dotenv
PORT=8787
BRIDGE_PORT=8787
BRIDGE_HOST=0.0.0.0
BRIDGE_AUTH_DIR=/data/auth
BRIDGE_STATE_DIR=/data/state
BRIDGE_AUTOSTART=true
WHATSAPP_WEB_DELIVERY_MODE=pull
PORTAL_WEBHOOK_URL=https://aistart360.vercel.app/api/webhooks/whatsapp-web
```

Generate a Railway domain for port `8787`. Configure that HTTPS origin as
`WHATSAPP_WEB_BRIDGE_URL` in Vercel, and use the same session ID, API secret,
and webhook secret on both sides. The two secrets must still differ from one
another.

For a safe cutover, deploy an empty cloud volume first, stop the local bridge,
pair the cloud bridge once through the signed QR flow, wait for `/ready`, then
switch the Vercel producer to `WHATSAPP_WEB_DELIVERY_MODE=pull`. Never run the
local and cloud bridge against the same WhatsApp number at the same time.
