#!/usr/bin/env bash
# scripts/staging/load.sh — залить копию прода в STAGING и СРАЗУ обезличить.
#
#   STAGING_PG_PASSWORD_FILE=~/AI-Portal-backups/staging-secrets/pg \
#   scripts/staging/load.sh /путь/к/дампу.dump
#
# Дамп: pg_dump -Fc --no-owner --no-privileges облачной/прод-базы. Дамп НЕ распаковывается
# на диск: pg_restore пишет SQL в поток прямо в psql.
#
# Шаги:
#   1. 01-prepare.sql      — предохранитель (auth.users = 0), метка staging, роли, схема market, расширения.
#   2. pre-data            — DDL public/market (без данных) — отдельной транзакцией.
#   3. ОДНА транзакция:    данные auth.users/identities → данные public/market → post-data
#                          (индексы, ключи, RLS, политики, триггеры, публикация realtime)
#                          → anonymize.sql (+ verify-pii.sql: остаток ПДн = откат ВСЕГО)
#                          → 03-post.sql → 04-privileges.sql. Пока транзакция не зафиксирована,
#                          данных никто не видит; зафиксированы они только обезличенными.
#   4. verify.sql          — сверка (печать).
# Миграции, вышедшие после дампа, — отдельно (см. docs/staging/README.md).
#
# Пароль читается из файла и в командную строку не попадает. Подключение — только к staging
# (TCP-прокси Railway, окружение staging), без TLS: сервер его не поддерживает.
set -euo pipefail

DUMP="${1:?укажите путь к дампу}"
PWFILE="${STAGING_PG_PASSWORD_FILE:?укажите STAGING_PG_PASSWORD_FILE (файл с паролем supabase_admin staging)}"
STAGING_HOST="junction.proxy.rlwy.net"
STAGING_PORT="48460"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -r "$DUMP" ] || { echo "нет дампа: $DUMP" >&2; exit 1; }
[ -r "$PWFILE" ] || { echo "нет файла пароля: $PWFILE" >&2; exit 1; }

PGPASSWORD="$(cat "$PWFILE")"; export PGPASSWORD
export PGCONNECT_TIMEOUT=15 PGAPPNAME=staging-load
STG="host=$STAGING_HOST port=$STAGING_PORT dbname=postgres user=supabase_admin sslmode=disable"
psql_() { "$PGBIN/psql" "$STG" -X -q -v ON_ERROR_STOP=1 "$@"; }

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Только схемы public и market; spatial_ref_sys — данные расширения postgis (создаёт само расширение).
"$PGBIN/pg_restore" -l -n public -n market "$DUMP" | grep -v '^;' | grep -v '^$' | grep -v 'spatial_ref_sys' > "$work/pm.lst"
# порядок важен: сначала users, потом identities (FK identities.user_id)
{ "$PGBIN/pg_restore" -l "$DUMP" | grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth users '
  "$PGBIN/pg_restore" -l "$DUMP" | grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth identities '; } > "$work/auth.lst"
[ "$(wc -l < "$work/auth.lst")" -eq 2 ] || { echo "в дампе не нашлись данные auth.users/identities" >&2; exit 1; }
log "в списке восстановления: $(wc -l < "$work/pm.lst") объектов public/market + auth.users/identities"

log "1/4 подготовка (01-prepare.sql)"
psql_ -1 -f "$HERE/01-prepare.sql"

if [ "$(psql_ -Atc "select count(*) from pg_tables where schemaname='public' and tablename='profiles'")" = "0" ]; then
  log "2/4 DDL public/market (pre-data)"
  "$PGBIN/pg_restore" -L "$work/pm.lst" --section=pre-data --role=postgres -f - "$DUMP" | psql_ -1 -f - >/dev/null
else
  log "2/4 DDL уже на месте — пропуск"
fi

log "3/4 данные + post-data + обезличивание + права — одной транзакцией"
psql_ -1 \
  -c "DO \$\$ BEGIN IF (SELECT count(*) FROM auth.users) > 0 THEN RAISE EXCEPTION 'auth.users не пуст — стоп'; END IF; END \$\$" \
  -f <("$PGBIN/pg_restore" -L "$work/auth.lst" -a -f - "$DUMP") \
  -f <("$PGBIN/pg_restore" -L "$work/pm.lst" --section=data --role=postgres -f - "$DUMP") \
  -f <("$PGBIN/pg_restore" -L "$work/pm.lst" --section=post-data --role=postgres -f - "$DUMP") \
  -f "$HERE/anonymize.sql" \
  -f "$HERE/03-post.sql" \
  -f "$HERE/04-privileges.sql" \
  > "$work/load.out"
grep -E '^verify-pii' "$work/load.out" || true
log "транзакция зафиксирована"

log "4/4 сверка (verify.sql)"
psql_ -f "$HERE/verify.sql"
