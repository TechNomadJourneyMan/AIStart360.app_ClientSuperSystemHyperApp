# AIStart360 — User Uploads & Moderation Pipeline

> Users upload their own business intelligence (CSV/XLSX/PDF). After moderation, uploaded data **may** enrich shared analytics (with consent) or stay private to the user's workspace.

## 1. Flow

```
Upload → Virus scan → Format detection → Schema inference → Auto-structuring
   │                                              │
   │                                              ▼
   │                                       Sandboxed parse (LLM extraction if needed)
   │                                              │
   │                                              ▼
   │                                       User reviews mapping + corrects
   │                                              │
   │                                              ▼
   │           ┌────────────────────────────┬─────┴────────────────────┐
   ▼           ▼                            ▼                          ▼
Private to    Shared with org             Submitted for global       Marked sensitive
 user                                     enrichment (consent)        → encrypted
                                                │
                                                ▼
                                         Admin moderation queue
                                                │
                                       ┌────────┴───────────┐
                                       ▼                    ▼
                                   Approved →           Rejected →
                                   merged into          notify user
                                   shared analytics
```

## 2. Allowed formats (MVP)

| Format | Limits | Parser |
|--------|--------|--------|
| CSV / TSV | 100 MB | pandas + sniff |
| XLSX | 50 MB | openpyxl |
| PDF | 50 MB | trafilatura → fallback OCR (Gemini Flash vision) |
| JSON | 10 MB | direct |
| Text-only fallback | 5 MB | trafilatura |

Phase 2 adds: Parquet, Google Sheets via OAuth, automated CRM connectors (HubSpot, AmoCRM).

## 3. Use cases

| Upload type | Stored where | Visibility | Enriches platform? |
|-------------|--------------|------------|---------------------|
| Competitor list (companies user tracks) | `user_company_lists` | private/org | optional (consent) |
| Customer database | `user_datasets` (encrypted) | private | never (PII) |
| Market research PDF | `user_documents` + extracted facts | private | facts can be cited as a public source if user explicitly publishes |
| Financial reports | `user_documents` | private | never |
| Sales reports | `user_datasets` (encrypted) | private | never |
| Industry document (public) | `user_documents` | private + opt-in shared | yes if approved |
| Pricing comparisons | `user_datasets` | private | optional |

## 4. Storage

- **Files (raw)**: Cloudflare R2 — bucket `mark-uploads`, path `users/{user_id}/{upload_id}/{filename}`. Server-side encryption with R2 SSE-S3.
- **Extracted structured rows**: per-user Postgres rows in `user_uploaded_records` table, partitioned by `user_id` for isolation.
- **Sensitive flag**: if `is_sensitive=true`, table-level encryption via `pgcrypto` (column-level for PII fields). Plus row-level RLS so even our service-role bypass requires audit log.

## 5. Schema inference

After upload, we sample first 100 rows / first 10 pages and call:

- For CSV/XLSX: heuristic `dtype` inference → propose column types and probable semantic meaning (`name`, `bin`, `email`, `phone`, `industry`).
- For PDF: `Task.EXTRACT_COMPANY` per page-batch using LLM with structured schema.
- Result: a **mapping proposal** UI where the user accepts/edits column→semantic mapping before commit.

## 6. Moderation pipeline (for "submit to global enrichment")

```
User submits → enqueued in moderation_queue
     │
     ▼
Auto-checks:
- PII detector (regex + light LLM): if PII found → require user to redact
- Duplicate check: 80%+ similarity to existing source → flag
- Plausibility: numbers in reasonable ranges, geos valid
     │
     ▼
Admin review (manual, Phase 2 UI):
- approve → merge into shared schema, source attribution to user (optional)
- request changes
- reject (with reason)
     │
     ▼
On approve:
- run standard Extraction Agent on the data
- merge with existing entities (with provenance pointing back to user upload)
- credit user with "contributor karma" (Phase 3 reputation)
```

## 7. Security & legal

- **Consent**: explicit per-upload checkbox "share with platform". Default is OFF.
- **PII detection**: regex-based first, LLM-based second. Blocks submission if found.
- **Audit log**: every upload, every access, every moderation decision recorded.
- **Right to deletion** (GDPR/152-FZ analogue): user can delete an upload — cascades to all extracted records.
- **Data residency**: uploads stored in EU region (R2 EU) by default for CIS users; configurable per enterprise client.

## 8. Quotas (by tier)

| Tier | Upload size limit | Total storage | Uploads/mo |
|------|-------------------|---------------|------------|
| Free / Trial | 5 MB | 25 MB | 1 |
| Starter | 25 MB | 500 MB | 10 |
| Pro | 100 MB | 5 GB | 100 |
| Business | 500 MB | 50 GB | 1000 |
| Enterprise | custom | custom | custom |

Enforced in `app.uploads.service` before file accepted.

## 9. API surface

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/uploads` | Multipart upload, returns `{upload_id, status: 'analyzing'}` |
| GET | `/api/v1/uploads/{id}` | Status + mapping proposal |
| POST | `/api/v1/uploads/{id}/mapping` | Confirm/edit mapping + visibility |
| POST | `/api/v1/uploads/{id}/submit-for-review` | Send to moderation queue |
| GET | `/api/v1/uploads` | List my uploads |
| DELETE | `/api/v1/uploads/{id}` | Delete |
| GET | `/api/v1/admin/moderation/queue` | Admin only |
| POST | `/api/v1/admin/moderation/{id}/decision` | Admin only |

## 10. Background processing

Arq tasks:
- `analyze_upload(upload_id)` — virus scan, format detect, sample parse, schema infer.
- `extract_upload(upload_id)` — full extraction after user confirms mapping.
- `merge_approved_upload(upload_id)` — after admin approves, merge into global tables.

Status tracked in `uploads.status`: `uploading → analyzing → mapping_ready → extracting → ready | needs_review → approved | rejected`.

## 11. Future

- Connectors: HubSpot / AmoCRM / Bitrix24 OAuth, daily pull.
- Webhooks: user pushes data from their CRM into our API.
- Federated analytics: aggregate insights across opted-in user datasets without revealing per-user rows.
