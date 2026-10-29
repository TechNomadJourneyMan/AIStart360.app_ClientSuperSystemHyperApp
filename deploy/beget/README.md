# AIStart360 on Beget

This release starts from the previously deployed Vercel commit, not from an
unreviewed merge of newer branches. Application data remains in the existing
Supabase project. No database migration is part of this hosting change.

## Release procedure

1. Fetch remote refs, record the production SHA, inspect worktrees and dirty
   files, and review the exact commit. Do not reuse another operator's release.
2. Build on a development machine using Node 24 and dependencies matching
   `package-lock.json`. Supply the real target public environment at build time.
   Run the full test suite, type check, lint and production build. Keep secrets
   out of the Git checkout, release archive, logs and command arguments.
3. Create a dedicated system user `aistart360`, releases under
   `/var/www/aistart360/releases/<full-SHA>`, and protected shared configuration
   `/var/www/aistart360/shared/.env.production` (owner aistart360, mode 0600).
   Use verified existing application credentials. Sensitive Vercel values may
   be unavailable for export; do not replace scoped credentials with broader ones.
4. Fetch the reviewed Git commit into a new server release. Install its locked
   production dependencies on Linux using npm's cache and `--prefer-offline
   --no-audit --no-fund`. Prisma's client must be generated for the Linux host.
   Builds run elsewhere; the live shop host only installs runtime dependencies.
5. Transfer only `.next` (excluding cache) and generated public assets, with a
   checksum. Never transfer private environment files, dependency caches or
   customer data in the build archive. Attach the persistent report directory
   after the PWA build so reports are not included in its precache manifest.
6. Install `aistart360.service`, validate it, and run `activate.sh <full-SHA>` as
   root. The application runs as its dedicated user on 127.0.0.1:3100. Activation
   tests the exact SHA, login, database/configuration and Workflow health; failure
   restores the previous symlink, or stops a failed first installation.
7. Substitute the authorized hostname into `nginx.conf.template`. Bootstrap ACME
   with a separate vhost, obtain a certificate using the existing Certbot account,
   run `nginx -t`, and reload. Do not modify other websites' vhosts.
8. Run `node deploy/beget/readiness.mjs <SHA> https://<hostname>` and verify a real
   authenticated admin session, static assets, logout and denied anonymous APIs.
   Public Workflow mutations must return 403; internal dispatch uses loopback.

## Integration cutover

`*.vercel.app` belongs to Vercel and cannot point to this server. A new origin
needs the Supabase redirect allowlist, Google OAuth redirects (if NextAuth is
used), webhook destinations and dependent clients reviewed. Preserve existing
redirect entries when adding a new origin. Do not claim integrations migrated
merely because the login page loads.

The two former Vercel schedules are daily CRM digest (04:00 UTC) and Telegram
personal sync (05:00 UTC). Enable corresponding systemd timers only after their
existing authentication secrets and integration health are verified; never
silently install unauthenticated schedules or send customer test messages.

Workflow state is persistent in `shared/workflow`; use one application instance.
Do not forward public POST requests to its internal generated routes.

## Rollback

Run `activate.sh <previous-reviewed-SHA>` for a compatible, verified existing
release. Verify the public SHA and login again. This changes application code,
not database contents, shared configuration, uploaded files or Workflow state.
For the first release, stop only `aistart360.service` and disable only its vhost
if it fails; existing sites remain separate. No old releases are deleted.
