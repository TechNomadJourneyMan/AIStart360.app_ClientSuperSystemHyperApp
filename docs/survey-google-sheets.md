# Survey persistence and Google Sheets sync

`POST /api/v1/onboarding/survey` stores each answer in
`public.survey_answers` first. Supabase is authoritative and uses the existing
unique key `(user_id, question_key)` for idempotent upserts.

After the database upsert succeeds, the route projects the saved rows into the
configured Google spreadsheet. The default target is spreadsheet
`1MkJzT1nvAVIyFV7L6dQif3A3v61G6o4TDIIx_kZ7Mo8`, tab `Лист1`. The integration
initializes these columns:

1. `record_key` (`user_id:question_key`)
2. `user_id`
3. `company_id`
4. `step`
5. `question_key`
6. `answer_json`
7. `answered_at`

Existing `record_key` rows are updated; new keys are appended.

The stored `step` is derived per answer from keys such as `s1_*`, `s2n_*`, or
`s10_*`. This keeps mixed full-form saves assigned to their original steps.
Unprefixed keys use the request's `step` as a fallback, including step `0`.

## Configuration

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Share the spreadsheet with its `client_email` as **Editor**.
3. Add server-only environment variables in Vercel. Use either:
   - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, containing the service-account JSON;
   - or both `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` and
     `GOOGLE_SHEETS_PRIVATE_KEY` (use escaped `\n` line breaks in Vercel).
4. Keep the defaults in `.env.example`, or override
   `GOOGLE_SHEETS_SPREADSHEET_ID` and `GOOGLE_SHEETS_SHEET_NAME`.

Never expose these credentials through `NEXT_PUBLIC_*` variables and never
commit the service-account JSON file.

## Existing-answer backfill

After adding or rotating credentials, project all answers that are already in
Supabase before relying on incremental saves:

```bash
npm run survey:sheets:backfill
```

The command reads `survey_answers` with the server-only Supabase service role,
pages deterministically by user/question, and sends bounded batches through
the same idempotent `record_key` upsert path used by the survey API. It never
prints either Google or Supabase credentials.

## Failure behavior

- A Supabase failure returns HTTP 500 and Sheets is not called.
- A Sheets failure after a successful Supabase upsert returns HTTP 200 with
  `data.sheet_sync = { "status": "failed", "reason": "sync_error" }`.
- Missing credentials return HTTP 200 with
  `data.sheet_sync = { "status": "skipped", "reason": "not_configured" }`.
- `GOOGLE_SHEETS_SYNC_ENABLED=false` explicitly disables the projection.
- The full Google sync is bounded by `GOOGLE_SHEETS_TIMEOUT_MS` (default 8s).

`GET /api/v1/onboarding/survey` continues to prefill from Supabase and accepts
both the canonical `{ "value": ... }` JSON shape and legacy/imported bare JSON
values.
