# RUNBOOK — SEC-01: Rotate the leaked Supabase DB password

**Severity:** Critical. **Owner action required — cannot be done from the codebase.**

## What happened
A live Postgres/Supabase connection string (with password) was committed to
`scripts/init-db.js` and is still present in **git history** before commit
`a36e099`. The working tree is already fixed (the script reads the password from
env), but anyone with the repo history has the credential.

## Impact
Direct DB access (read/write) to production Postgres, bypassing the app and RLS.

## Fix (do in this order)

1. **Rotate the database password** in the Supabase dashboard:
   Project → **Settings → Database → Reset database password**.
2. **Update the secret everywhere it is used** (do NOT commit it):
   - Vercel → Project → Settings → Environment Variables: update `DATABASE_URL`
     and `DIRECT_URL` (Production + Preview), then redeploy.
   - Any local `.env.local` / CI secrets store.
3. **Verify the app** still connects after redeploy (login + a data page).
4. **Confirm the old credential is dead:** attempt a connection with the OLD
   string — it must be refused.

## Optional but recommended — purge the secret from git history
Rotation makes the leaked password useless, so this is defense-in-depth /
hygiene. **It rewrites commit hashes** and force-pushes — coordinate with the
team first (everyone must re-clone or hard-reset), and it needs a **product-owner
decision** (master spec §16 Q11).

```bash
# with git-filter-repo (preferred over BFG for path+content edits)
git filter-repo --path scripts/init-db.js --invert-paths   # or redact just the string
# then force-push all branches/tags and have collaborators re-clone
```

## Acceptance
- New password set in Supabase and in Vercel/CI/local env; app works after redeploy.
- The old connection string no longer authenticates.
- (If history purge chosen) the string is absent from `git log -p`.

## Related
- The working-tree code fix landed in `a36e099` (per prior audits).
- Also confirm `.env*` is gitignored (audit: confirmed) and `public/uploads` is untracked.
