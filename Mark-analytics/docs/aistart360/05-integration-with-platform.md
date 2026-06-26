# AIStart360 — Platform Integration

> How this backend integrates with the existing AIStart360.app portal: auth, billing, deep links, cross-module data flow.

## 1. Single Sign-On (Supabase Auth)

Both AIStart360.app and this Market Intelligence backend share **one Supabase project**.

- User signs in on `aistart360.app` (existing flow). Supabase issues a JWT.
- When the user navigates into the Market Intelligence module (Next.js route in same app), the same JWT is reused for API calls to this backend.
- Backend verifies JWT against `SUPABASE_JWT_SECRET` (HS256). See `backend/app/core/security.py`.
- No separate registration, no separate password.

See [ADR-0006](../adr/0006-supabase-auth.md).

## 2. User table relationship

| Table | Owner | Notes |
|-------|-------|-------|
| `auth.users` | Supabase | identity (id, email, hashed pw, OAuth providers) |
| `public.users` | this backend | extension: plan, org_id, requests_used, requests_limit |
| `aistart360.user_profiles` | AIStart360 app | display name, avatar, locale, role in their company |
| `aistart360.subscriptions` | AIStart360 app | current tier (free / starter / pro / business / enterprise), billing dates, payment method |

Backend reads `aistart360.subscriptions` (or a denormalized cache) to determine tier-gated access. Subscription source of truth stays in AIStart360 app's existing flow.

## 3. Tier resolution

```python
# backend/app/billing/tier.py
async def get_user_tier(claims: SupabaseUserClaims, session: AsyncSession) -> Tier:
    """Resolves the user's current tier.

    Order of lookup:
    1. Local cache (Redis, 5 min TTL) keyed by user_id
    2. Postgres `users` table (denormalized field `plan`)
    3. `aistart360.subscriptions` table (source of truth)
    4. Fallback to FREE.
    """
```

`aistart360.subscriptions` is written by the existing AIStart360 billing logic; this backend treats it read-only.

When the AIStart360 app updates a subscription, it should emit a webhook to this backend (`POST /api/v1/internal/webhooks/subscription-changed`) so we can invalidate the cache. Webhook secret = `AISTART360_WEBHOOK_SECRET`.

## 4. Deep-linking

Frontend builds Market Intelligence URLs like:

```
https://aistart360.app/market-intelligence/companies/{id}
https://aistart360.app/market-intelligence/forecasts/tam_sam_som?industry=62.01&region=KZ-ALA
https://aistart360.app/market-intelligence/search?q=fintech+startups
```

From other modules:
- Diagnostics report → "Explore your industry" button → Market Intelligence search prefilled.
- Coaching session → AI copilot can cite Market Intelligence companies (links).
- Toolkit → "Get market data" widget → Market Intelligence forecasts.

The AIStart360 frontend wraps deep links with our backend `GET /api/v1/companies/{id}` etc. — same auth, same tier check.

## 5. Cross-module data flow

### Read flow (most common)
```
AIStart360 frontend ── GET /api/v1/companies/{id} ──► this backend ──► Supabase Postgres
                                                            │
                                                            └──► AI Gateway (if /summary)
```

### Write flow (user saves a forecast)
```
AIStart360 frontend ── POST /api/v1/forecasts ──► this backend ──► forecasts table
                                                       │
                                                       └─ event published to outbox
                                                                │
                                                                └─ AIStart360 listener (separate consumer)
                                                                       └─ shows in user's workspace
```

### Write flow (user uploads data)
```
AIStart360 frontend ── POST /api/v1/uploads (multipart) ──► this backend ──► R2
                                                                  │
                                                                  └─ Arq queue: analyze_upload
                                                                         └─ updates upload status
                                                                                └─ frontend polls /uploads/{id}
```

## 6. AI Copilot integration

The existing AIStart360 AI copilot (cross-module) needs to be able to **call our backend** when the conversation enters market intelligence territory.

Implementation: the copilot is a separate service (already in AIStart360 app) — it gets a **tool/function-calling spec** for our API:

```json
{
  "name": "market_intelligence_search",
  "description": "Search companies / tenders / persons in the AIStart360 Market Intelligence dataset",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "filters": {"type": "object"}
    }
  }
}
```

The copilot calls our `POST /api/v1/search`, formats results inline.

We expose a small **bot-friendly endpoint** `POST /api/v1/copilot/answer` that takes a question + context, runs hybrid search + an explanation, and returns formatted markdown. Cost-gated to Pro+ tiers.

## 7. Branding / theming

Backend is brand-agnostic — returns JSON only. Frontend (separate repo in AIStart360 app) handles all theming, colors, logo, navigation chrome.

API responses include `meta.brand: "aistart360"` so the same backend could later serve a white-label customer without changing the schema.

## 8. CORS

`ALLOWED_ORIGINS` in env includes `https://aistart360.app` (and any preview/dev URLs). Wildcards forbidden in prod.

## 9. Observability handoff

- This backend ships logs and traces to the same Sentry/OTel project as AIStart360 main app (service name `aistart360-market-intel-backend`).
- Cost / usage metrics surfaced in AIStart360 admin dashboard via `GET /api/v1/admin/usage/{user_id}` (admin-only).

## 10. Local dev with AIStart360 frontend

If a developer wants to run the AIStart360 frontend against this backend locally:
1. Start backend on `:8000` (this repo's `make dev`).
2. Set `NEXT_PUBLIC_MARKET_INTEL_API=http://localhost:8000/api/v1` in AIStart360 frontend `.env.local`.
3. Frontend uses local Supabase project OR the same prod Supabase (recommended for matching identities).
