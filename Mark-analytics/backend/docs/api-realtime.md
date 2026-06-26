# Real-time API — Server-Sent Events

Mark Analytics streams domain events to the frontend over a single SSE
endpoint. Events originate from the `domain_events` outbox table, are relayed
to Redis Streams by `app.events.bus.publish_pending`, and fan out to connected
clients through `GET /api/v1/events/stream`.

## Endpoint

```
GET /api/v1/events/stream
```

| Header | Required | Description |
|---|---|---|
| `Authorization: Bearer <jwt>` | yes | Supabase JWT. EventSource cannot set custom headers — use a fetch-based polyfill on the browser. |
| `Last-Event-Id: <stream_id>` | no | Resume from a known Redis Streams ID instead of from the tail. |

| Query param | Default | Description |
|---|---|---|
| `topics` | all topics visible to the user's tier | Comma-separated subset of `companies,alerts,ingest` |

### Topic visibility per tier

| Tier | companies | alerts | ingest |
|---|---|---|---|
| FREE | yes | yes (only own rules) | no |
| STARTER | yes | yes (own rules) | yes |
| PRO+ | yes | yes (own + system feed) | yes |

`alerts.fired` events are RLS-filtered: a user only sees events whose
`user_id`/`owner_id` matches their own. PRO+ additionally see un-tagged
system-wide alert events.

### Frame format

Each frame follows the standard SSE wire protocol:

```
id: 1716901234567-0
event: companies
data: {"stream":"events:company_discovered","payload":{...}}

```

A heartbeat is sent every ~30 seconds:

```
event: ping
data: {}

```

The very first frame is always a `hello` event so the client can confirm the
stream is live before any business event arrives.

## Client examples

### `curl`

```bash
curl -N \
  -H "Authorization: Bearer $JWT" \
  "http://localhost:8000/api/v1/events/stream?topics=companies,alerts"
```

### Python (`httpx`)

```python
import httpx

async with httpx.AsyncClient(timeout=None) as client:
    async with client.stream(
        "GET",
        "http://localhost:8000/api/v1/events/stream",
        headers={"Authorization": f"Bearer {jwt}"},
        params={"topics": "companies,alerts"},
    ) as resp:
        async for line in resp.aiter_lines():
            print(line)
```

### Browser (with `@microsoft/fetch-event-source`)

```ts
import { fetchEventSource } from "@microsoft/fetch-event-source";

await fetchEventSource("/api/v1/events/stream?topics=companies,alerts", {
  headers: { Authorization: `Bearer ${jwt}` },
  onmessage(ev) {
    if (ev.event === "ping") return;
    const { stream, payload } = JSON.parse(ev.data);
    console.log(ev.event, stream, payload);
  },
  onerror(err) {
    console.error(err);
    throw err; // disables auto-retry on auth errors
  },
});
```

Plain `EventSource` works only without auth headers; the JWT-protected
endpoint requires either a polyfill (`event-source-polyfill`) or
`fetchEventSource` as above.

## Operational notes

- Events stream from Redis Streams (`events:<event_type>`), so the outbox
  publisher (`app.events.bus.publish_pending`) must be running.
- Each connection holds an open Redis client; expect ~1 connection per
  active subscriber. Scale Redis accordingly.
- Heartbeats every 30 s prevent intermediary proxies (nginx, Cloudflare)
  from killing idle connections.
- `Last-Event-Id` is forwarded as the starting cursor for **all** subscribed
  streams. Clients that need per-stream resume can call the endpoint once per
  topic.
