#!/usr/bin/env bash
# scripts/staging/apply-migration.sh — применить миграцию к STAGING (и только к нему) и записать
# её в public.schema_migrations так же, как scripts/apply-migration.js (file, sha256, applied_by).
#
#   STAGING_PG_PASSWORD_FILE=~/AI-Portal-backups/staging-secrets/pg \
#   scripts/staging/apply-migration.sh supabase/migrations/140_staff_rls_from_staff_roles.sql
#
# Миграция и запись в журнал — одной транзакцией (psql -1, ON_ERROR_STOP). Адрес — только staging
# (файл «addr» рядом с паролем); метка базы проверяется до применения.
set -euo pipefail

FILE="${1:?укажите файл миграции}"
PWFILE="${STAGING_PG_PASSWORD_FILE:?укажите STAGING_PG_PASSWORD_FILE}"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
[ -r "$FILE" ] || { echo "нет файла: $FILE" >&2; exit 1; }

PGPASSWORD="$(cat "$PWFILE")"; export PGPASSWORD
export PGCONNECT_TIMEOUT=15 PGAPPNAME=staging-migration
# Адрес TCP-прокси staging (host:port) — не в публичном репозитории: переменная STAGING_PG_ADDR
# или файл STAGING_PG_ADDR_FILE (по умолчанию «addr» рядом с файлом пароля), одна строка host:port.
ADDR="${STAGING_PG_ADDR:-}"
if [ -z "$ADDR" ]; then
  ADDR_FILE="${STAGING_PG_ADDR_FILE:-$(dirname "$PWFILE")/addr}"
  [ -r "$ADDR_FILE" ] || { echo "нет адреса staging: задайте STAGING_PG_ADDR или файл $ADDR_FILE (host:port)" >&2; exit 1; }
  ADDR="$(head -n1 "$ADDR_FILE" | tr -d '[:space:]')"
fi
case "$ADDR" in *?:[0-9]*) ;; *) echo "адрес staging должен быть host:port" >&2; exit 1 ;; esac
STAGING_HOST="${ADDR%:*}"
STAGING_PORT="${ADDR##*:}"
STG="host=$STAGING_HOST port=$STAGING_PORT dbname=postgres user=supabase_admin sslmode=disable"

name="$(basename "$FILE")"
sum="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"

# Метка staging обязательна (ставит 01-prepare.sql).
mark="$("$PGBIN/psql" "$STG" -X -At -c "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()")"
[ "$mark" = "aistart360-staging" ] || { echo "база не помечена как staging — стоп" >&2; exit 1; }

"$PGBIN/psql" "$STG" -X -q -v ON_ERROR_STOP=1 -1 \
  -f "$FILE" \
  -c "INSERT INTO public.schema_migrations (file, checksum, applied_by) VALUES ('$name', '$sum', 'staging-psql')
      ON CONFLICT (file) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), applied_by = EXCLUDED.applied_by"
echo "✓ $name применена к staging и записана в schema_migrations (${sum:0:12})"
