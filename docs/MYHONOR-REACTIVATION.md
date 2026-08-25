# MyHonor customer reactivation

## Goal and safe boundary

This module turns verified MyHonor customer events into reviewable WhatsApp
marketing campaigns and deterministic product recommendations. It does not
scrape WhatsApp group members and does not treat an old chat, purchase, phone
number, or club membership as marketing permission.

Proactive messages use only the official WhatsApp Cloud API and an approved
Meta **MARKETING** template. The QR/WebSocket bridge remains an inbox/history
connector and is never a campaign transport. The default is `dry_run`; live
delivery also requires `MYHONOR_REACTIVATION_SEND_ENABLED=true`.

No existing `@lid` contact is automatically converted into a phone number.
The store must submit an E.164 number together with immutable consent evidence.
Names and numbers are encrypted before storage; logs and campaign lists expose
only a one-way contact hash and a masked number.

## Source contract

`POST /api/v1/integrations/myhonor/reactivation-events`

Headers:

```http
Authorization: Bearer <MYHONOR_REACTIVATION_API_KEY>
Idempotency-Key: myhonor:contact:00000000-0000-4000-8000-000000000042
X-MyHonor-Source-Version: 42
Content-Type: application/json
```

The Bearer key must contain at least 32 UTF-8 bytes. The idempotency key must
equal `event_id`. A reused key with a different
canonical body returns `409`. `source_version` is a strictly increasing
per-contact Store version; an older grant/revoke delivery is retained for audit
but cannot replace newer profile, consent or suppression state. Its value must
also equal `X-MyHonor-Source-Version`, making the ordering contract explicit in
both the transport envelope and body. Example grant event:

```json
{
  "schema_version": 1,
  "event_id": "myhonor:contact:00000000-0000-4000-8000-000000000042",
  "source_version": 42,
  "occurred_at": "2026-08-25T10:00:00+05:00",
  "contact": {
    "external_customer_id": "store-customer-42",
    "phone_e164": "+77000000000",
    "first_name": "Алия",
    "locale": "ru",
    "city": "Алматы",
    "interests": ["fishing", "footwear"],
    "size": "L",
    "budget_kzt": 80000,
    "club_status": "not_member",
    "customer_kind": "retail"
  },
  "lifecycle": {
    "registered_at": "2025-09-10T11:00:00+05:00",
    "last_activity_at": "2026-01-10T11:00:00+05:00",
    "last_order_at": null,
    "order_count": 0,
    "lifetime_value_kzt": 0,
    "last_order_product_ids": [],
    "abandoned_cart": null,
    "club_interest": false,
    "back_in_stock_product_ids": [],
    "unresolved_complaint": false,
    "marketing_hold": false,
    "marketing_hold_reason": null
  },
  "consent": {
    "status": "granted",
    "purposes": ["product_recommendations"],
    "source": "account_settings",
    "notice_version": "marketing-2026-08-25",
    "evidence_id": "myhonor:consent:00000000-0000-4000-8000-000000000042",
    "obtained_at": "2026-08-25T09:59:00+05:00",
    "revoked_at": null,
    "cross_border_disclosed": true
  }
}
```

An opt-out is submitted as a new event with `status=revoked`, an empty
`purposes` array, and `revoked_at`. It immediately suppresses all queued or
leased work that has not yet passed the atomic provider authorization fence.
That fence durably records the provider attempt and the worker starts the HTTP
request immediately. A revocation committed after the provider-attempt record
may not stop an HTTP request that has already started. Such a request cannot be
safely recalled; its provider outcome is reconciled as accepted or
`delivery_unknown`, never retried blindly. Transactional order status
notifications are a separate purpose and queue.

## Segments

| Segment | Practical trigger | First useful CTA |
| --- | --- | --- |
| `old_lead` | Asked before, no order, inactive for campaign threshold | Ask activity + season, or open catalog |
| `abandoned_cart` | Active cart is 2 hours–14 days old and no later order exists | Exact still-available cart product |
| `registered_no_order` | Account exists, no completed order | Offer two verified options |
| `dormant_customer` | Previous customer, no recent activity/order | Complement or seasonal replacement |
| `post_purchase` | Recent fulfilled purchase after a 14-day cooling period | Relevant current option; no compatibility claim |
| `seasonal` | Known activity and a timely seasonal need | Verified kit-builder/category selection |
| `club_interest` | Explicit club interest and separate `club_updates` consent | Current club page / community link |
| `back_in_stock` | Prior interest and exact variant is available again | Exact product URL and current price |

Wholesale contacts, VIPs, complaints, returns, payment disputes, unsafe product
categories, uncertain identity, and commercial proposals go to manual review.

## Recommendation rules

Recommendations are generated from current server-owned facts, never from an
LLM guess. A candidate must be active, have a canonical `myhonor.shop` URL,
have a fresh KZT price, and be in stock. When variants are available, activity,
season/temperature, city warehouse, size, color, budget, and past purchases are
used before ranking. Margin is only a final tie-breaker.

If data is insufficient, ask at most two questions in one message, in this
order: activity, season/temperature, city, size or height/weight, budget.
Broad proactive product campaigns (`old_lead`, `registered_no_order`,
`dormant_customer`, `post_purchase`) require a source-owned contact interest or
a human-selected campaign interest. Without one, the recipient is excluded as
`insufficient_personalization`; the engine never substitutes the cheapest or
first generic product. Qualification can then happen through an inbound reply
or a separately reviewed qualification template.

Useful destinations:

- catalog: https://myhonor.shop/catalog
- kit builder: https://myhonor.shop/kit-builder
- guided selection: https://myhonor.shop/podbor
- seasons: https://myhonor.shop/seasons
- colors: https://myhonor.shop/colors
- layers: https://myhonor.shop/layers
- club: https://myhonor.shop/club
- WhatsApp community: https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t

The current club benefit, sale price, and stock must be read from the live
store snapshot immediately before a recipient is authorized. They are not
hard-coded into templates.

## Approved-template copy briefs

Meta templates contain neutral placeholders, one clear CTA, and an opt-out.
The implemented placeholder contract deliberately omits the customer's name:

- Old lead (`product_name`, `price_kzt`, `product_url`): `Здравствуйте! Для
  вас есть актуальный вариант экипировки: {{1}} — {{2}}. Подробнее: {{3}}.
  Если подборки не нужны, ответьте СТОП.`
- Abandoned cart (`product_name`, `price_kzt`, `product_url`): `Здравствуйте!
  Вы оставили товар в корзине: {{1}} — {{2}}. Он сейчас доступен: {{3}}.
  Если напоминания не нужны, ответьте СТОП.`
- Registered, no order (`product_name`, `price_kzt`, `product_url`):
  `Здравствуйте! Можем помочь сократить выбор. Начать можно с {{1}} — {{2}}:
  {{3}}. Если подборки не нужны, ответьте СТОП.`
- Dormant customer (`product_name`, `price_kzt`, `product_url`):
  `Здравствуйте! Сейчас доступен актуальный вариант: {{1}} — {{2}}.
  Карточка товара: {{3}}. Если подборки не нужны, ответьте СТОП.`
- Post-purchase (`product_name`, `price_kzt`, `product_url`): `Здравствуйте!
  Можно рассмотреть актуальный вариант для экипировки: {{1}} — {{2}}.
  Подробнее: {{3}}. Если подборки не нужны, ответьте СТОП.`
- Seasonal (`season`, `product_name`, `price_kzt`, `product_url`):
  `Подборка на сезон «{{1}}»: {{2}} — {{3}}. Подробнее: {{4}}. Если подборки
  не нужны, ответьте СТОП.`
- Back in stock (`product_name`, `price_kzt`, `product_url`):
  `Вариант, которым вы интересовались, снова доступен: {{1}} — {{2}}. Карточка:
  {{3}}. Если подборки не нужны, ответьте СТОП.`
- Club (`catalog_url`, `club_invite_url`): `Посмотреть каталог HONOR:
  {{1}}. Открыть чат HONOR Club: {{2}}. Если сообщения клуба не нужны, ответьте СТОП.`

Exact wording and parameter order must match the templates approved in the
configured WhatsApp Business account.

This rollout has an exact Russian (`ru`) copy contract only. A contact whose
stored locale is `kk` is visible as excluded in preview and cannot be sent the
Russian template. Kazakh delivery requires a separately reviewed body contract
and an approved Meta template before it can be enabled.

## Eligibility and cadence

Before every provider call the worker atomically rechecks:

1. active, purpose-specific consent and its evidence;
2. no global suppression, complaint, return, payment uncertainty, identity
   conflict, incomplete source state, or manual-review hold;
3. campaign remains approved/running and the recipient is not holdout;
4. lifecycle/contact source refreshed within the last 24 hours, inventory and
   variant-price imports no older than 48 hours, and a catalog product snapshot
   no older than 168 hours; a stale variant-price override is ignored rather
   than presented as current;
5. no duplicate and frequency gap of at least 7–14 days;
6. no more than three marketing messages in 30 days;
7. local send window (`Asia/Almaty`): weekdays 10:00–20:00, weekends
   11:00–18:00;
8. the Cloud API, sender ID, locale, and template configuration are present.

Immediately before a live launch, AIStart360 queries the configured WhatsApp
Business Account and proves that the exact segment template and language are
currently `APPROVED`, category `MARKETING`, contain exactly one BODY component,
match the complete reviewed BODY copy and placeholder sequence, and include an
explicit `STOP`/`СТОП` instruction. Any HEADER, FOOTER, BUTTONS, or unknown
component fails the launch preflight. Preview stores this complete canonical
template-contract hash inside the approval snapshot; approval and launch both
require the same hash. A later Meta copy or environment-template change forces
a new campaign preview instead of silently changing an approved message.
The same exact provider-owned template verification runs again for every
recipient immediately before the atomic send authorization. If Meta changes,
pauses, removes or temporarily cannot prove the template contract, no WhatsApp
POST is attempted; a transient verification outage is retried before the
provider boundary, while a contract change fails closed.

The first rollout is internal numbers, then at most ten verified opted-in
customers, then 10%, 25%, and only then the full eligible audience. One
follow-up after 48–72 hours is the maximum; after that the contact pauses for
30 days. Meta error `131049` is a suppression/cooldown signal, not an immediate
retry.

## Administration and measurement

The Giga admin API supports draft creation, preview, approval, launch, pause,
and an overview. Preview exposes every recipient as a masked identity,
the fully rendered exact message, its parameter and template-contract hashes,
consent evidence, recommendation snapshot and exclusion reason. The operator
must load all pages and explicitly confirm the review before approval.
Re-preview replaces the prior draft revision under a database lock; an audience
above the 5,000-row safe limit is rejected and must be split rather than
silently truncated. A live campaign cannot launch while the global send flag
is off.

Primary KPI is incremental gross profit per eligible contact versus a stable
holdout group. Also track accepted, delivered, read, reply, qualified interest,
click, order within 7/14/30 days, paid/delivered order, opt-out, complaint,
incorrect recommendation, missing stock, duplicate, and human handoff.

## Operational launch checklist

- apply the dedicated database migration and verify its exact checksum;
- configure the ingestion key and separate 32-byte encryption key;
- configure an official WhatsApp Cloud API number and approved MARKETING
  templates, including `WHATSAPP_BUSINESS_ACCOUNT_ID`; never reuse the QR
  bridge for campaigns;
- import only contacts with documented, purpose-specific consent;
- run preview/dry-run and inspect every exclusion and product fact;
- verify STOP/revocation, pause/kill switch, idempotency, lease fencing, and
  `delivery_unknown` behavior;
- obtain current Kazakhstan privacy/legal review, including local source-of-
  truth storage and disclosed cross-border processing;
- run the controlled canary and review quality/complaint metrics before
  increasing volume.

Every campaign URL receives `utm_source=whatsapp`,
`utm_medium=reactivation`, and a server-owned `utm_campaign`. A provider-
accepted proactive message remains only in the encrypted reactivation ledger.
It is not copied with a plaintext phone or message into the legacy unified
inbox. If that customer later writes inbound, the already accepted offer is
restored once as conversation context before the AI reply is queued. Incoming
replies and deterministic `СТОП` variants are linked back to the campaign;
opt-out creates an immediate global suppression before any subsequent campaign
authorization.

## Current store-data readiness (audit 2026-08-25)

The live store contains 28 customer profiles. Eight currently carry only a
boolean WhatsApp-consent flag; without the original notice version, purpose,
timestamp, source and evidence id they remain excluded from this service. Two
identifiable active-cart candidates were found, but they are likewise blocked
until valid purpose-specific consent evidence is supplied. The current order
dataset cannot be treated as paid-purchase truth because all 375 rows are still
marked `payment_status=pending` and the payments table is empty. These are
activation blockers, not assumptions the campaign engine works around.

Lifecycle facts must also be refreshed from the Store before campaign preview
and authorization. A historical grant snapshot is not sufficient evidence that
an abandoned cart, open order, complaint or purchase state is still current;
if either the contact/profile source refresh is older than 24 hours or is
unavailable, the recipient is excluded as `source_snapshot_stale` rather than
receive a guessed message. The Store must set `marketing_hold=true` with one of
`open_order`, `recent_cancel_or_return`, `payment_unknown`, `source_incomplete`,
`identity_conflict`, or `manual_review` whenever the lifecycle is not safe for
marketing. That hold is checked again atomically at provider authorization.
