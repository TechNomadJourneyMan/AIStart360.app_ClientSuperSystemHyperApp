#!/usr/bin/env bash
# scripts/backup/restore-drill.sh — учение восстановления (и ручное восстановление) из бэкапа.
#
#   # 1) снять свежий дамп с базы и восстановить его рядом (учение):
#   scripts/backup/restore-drill.sh --source-url postgres://…/aistart360_test \
#       --target-admin-url postgres://postgres@127.0.0.1:54329/postgres
#
#   # 2) восстановить готовый дамп из бакета (runs/…dump + …manifest рядом):
#   scripts/backup/restore-drill.sh --dump ./2026-11-14T00Z.dump \
#       --target-admin-url postgres://postgres@127.0.0.1:5432/postgres --name a360_restored --keep
#
# Что делает: (дамп через railway-db-backup.sh в режиме BACKUP_SKIP_UPLOAD=1 — тот же снимок и
# манифест, что на проде) → сверка sha256 с манифестом → CREATE DATABASE → pg_restore → сверка
# числа таблиц по схемам public/auth/storage и строк ключевых таблиц с манифестом → отчёт.
# Без --keep учебная база удаляется в конце.
#
# Флаги:
#   --source-url URL        снять дамп с этой базы (локальная тестовая; НЕ прод без нужды)
#   --dump FILE             взять готовый дамп; манифест ищется рядом (<имя>.manifest) или --manifest
#   --manifest FILE         манифест к --dump
#   --target-admin-url URL  сервер, куда восстанавливать (подключение к служебной базе postgres)
#   --name DB               имя новой базы (по умолчанию a360_drill_<время>); существующую НЕ трогает
#   --exact                 сохранить владельцев и права (восстановление в Postgres с ролями Supabase);
#                           по умолчанию --no-owner --no-acl (обычный Postgres без ролей Supabase)
#   --jobs N                параллельность pg_restore (по умолчанию 2)
#   --keep                  не удалять восстановленную базу
#   PG_BIN=<каталог>        pg_dump / pg_restore / psql нужной версии (≥ версии сервера-источника)
set -euo pipefail
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
PG_BIN="${PG_BIN:-}"
pg() { if [ -n "$PG_BIN" ]; then printf '%s/%s' "$PG_BIN" "$1"; else printf '%s' "$1"; fi; }
log() { printf '[drill %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "ОШИБКА: $*"; exit 1; }
mask() { sed -E 's#://[^@/[:space:]]*@#://***@#g'; }
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
secs() { date -u +%s; }

source_url="" dump="" manifest="" admin_url="" name="" exact=0 jobs=2 keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source-url) source_url="$2"; shift 2 ;;
    --dump) dump="$2"; shift 2 ;;
    --manifest) manifest="$2"; shift 2 ;;
    --target-admin-url) admin_url="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --exact) exact=1; shift ;;
    --jobs) jobs="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) die "неизвестный флаг $1" ;;
  esac
done
[ -n "$admin_url" ] || die "нужен --target-admin-url"
[ -n "$source_url" ] || [ -n "$dump" ] || die "нужен --source-url или --dump"
name="${name:-a360_drill_$(date -u +%Y%m%d%H%M%S)}"
printf '%s' "$name" | grep -Eq '^[a-z_][a-z0-9_]{0,62}$' || die "плохое имя базы: $name"

work="$(mktemp -d "${TMPDIR:-/tmp}/a360-drill.XXXXXX")"
created=0
cleanup() {
  if [ "$created" = 1 ] && [ "$keep" != 1 ]; then
    "$(pg psql)" "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" >/dev/null 2>&1 || true
    log "учебная база $name удалена"
  fi
  rm -rf "$work"
}
trap cleanup EXIT
t0="$(secs)"

# ─── 1. Дамп ─────────────────────────────────────────────────────────────────
if [ -n "$source_url" ]; then
  log "1/4 дамп источника ($(printf '%s' "$source_url" | mask))"
  POSTGRES_PRIVATE_URL="$source_url" PG_BIN="$PG_BIN" BACKUP_SKIP_UPLOAD=1 BACKUP_JOURNAL=0 \
    BACKUP_MIN_BYTES="${BACKUP_MIN_BYTES:-10000}" BACKUP_MIN_TABLES="${BACKUP_MIN_TABLES:-100}" \
    BACKUP_WORKDIR="$work/w" BACKUP_KEEP_LOCAL_DIR="$work/out" STORAGE_BUCKET="" VPS_BACKUP_HOST="" \
    bash "$here/railway-db-backup.sh"
  dump="$(ls "$work"/out/*.dump)"
  manifest="$(ls "$work"/out/*.manifest)"
fi
[ -f "$dump" ] || die "нет файла дампа $dump"
if [ -z "$manifest" ] && [ -f "${dump%.dump}.manifest" ]; then manifest="${dump%.dump}.manifest"; fi
t1="$(secs)"

field() { [ -n "$manifest" ] && grep -E "^$1=" "$manifest" | head -n 1 | cut -d= -f2- || true; }

# ─── 2. Целостность ──────────────────────────────────────────────────────────
log "2/4 проверка файла"
bytes="$(wc -c <"$dump" | tr -d ' ')"
sum="$(sha256_of "$dump")"
if [ -n "$manifest" ]; then
  [ "$(field sha256)" = "$sum" ] || die "sha256 не совпадает с манифестом"
  [ "$(field bytes)" = "$bytes" ] || die "размер не совпадает с манифестом"
  log "sha256 и размер совпадают с манифестом"
else
  log "манифеста нет — сверка будет только по оглавлению дампа"
fi
toc_tables="$("$(pg pg_restore)" --list "$dump" | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE ' || true)"
log "дамп: $bytes байт, таблиц в оглавлении $toc_tables"

# ─── 3. Восстановление ───────────────────────────────────────────────────────
log "3/4 восстановление в новую базу $name"
exists="$("$(pg psql)" "$admin_url" -X -At -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = '$name'")"
[ -z "$exists" ] || die "база $name уже есть — выберите другое имя (--name), существующие не трогаю"
"$(pg psql)" "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$name\"" >/dev/null
created=1
target_url="$(printf '%s' "$admin_url" | sed -E "s#/[^/?]*(\\?|\$)#/${name}\\1#")"
restore_flags=(--jobs="$jobs" --no-password)
[ "$exact" = 1 ] || restore_flags+=(--no-owner --no-acl)
set +e
"$(pg pg_restore)" "${restore_flags[@]}" --dbname="$target_url" "$dump" 2>"$work/restore.err"
restore_rc=$?
set -e
restore_errors="$(grep -c '^pg_restore: error:' "$work/restore.err" || true)"
if [ "$restore_rc" -ne 0 ]; then
  log "pg_restore: код $restore_rc, ошибок $restore_errors (первые 5 ниже) — решает сверка"
  grep '^pg_restore: error:' "$work/restore.err" | head -n 5 | mask >&2 || true
fi
t2="$(secs)"

# ─── 4. Сверка ───────────────────────────────────────────────────────────────
log "4/4 сверка с манифестом"
q() { "$(pg psql)" "$target_url" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
ok=1
report=""
for schema in public auth storage; do
  got="$(q "SELECT count(*) FROM pg_tables WHERE schemaname = '$schema'")"
  want="$(field "tables.$schema")"
  if [ -n "$want" ] && [ "$got" != "$want" ]; then ok=0; report="$report\n  ✗ таблиц в $schema: $got, ожидалось $want"
  else report="$report\n  ✓ таблиц в $schema: $got${want:+ (манифест $want)}"; fi
done
if [ -n "$manifest" ]; then
  while IFS='=' read -r key want; do
    t="${key#rows.}"
    printf '%s' "$t" | grep -Eq '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' || continue
    got="$(q "SELECT count(*) FROM $t" 2>/dev/null || echo 'нет таблицы')"
    if [ "$got" != "$want" ]; then ok=0; report="$report\n  ✗ строк в $t: $got, ожидалось $want"
    else report="$report\n  ✓ строк в $t: $got"; fi
  done < <(grep -E '^rows\.' "$manifest")
fi
db_size="$(q "SELECT pg_size_pretty(pg_database_size(current_database()))")"
t3="$(secs)"

printf '\n=== Учение восстановления: %s ===\n' "$([ "$ok" = 1 ] && echo 'УСПЕХ' || echo 'ПРОВАЛ')"
printf 'дамп:        %s (%s байт, sha256 %s)\n' "$(basename "$dump")" "$bytes" "$sum"
printf 'база:        %s, размер после восстановления %s\n' "$name" "$db_size"
printf 'режим:       %s, pg_restore код %s, ошибок %s\n' "$([ "$exact" = 1 ] && echo 'с владельцами/правами' || echo '--no-owner --no-acl')" "$restore_rc" "$restore_errors"
printf 'время:       дамп %s с, восстановление %s с, сверка %s с, всего %s с\n' "$((t1 - t0))" "$((t2 - t1))" "$((t3 - t2))" "$((t3 - t0))"
printf 'сверка:%b\n' "$report"
[ "$keep" = 1 ] && printf 'база оставлена (--keep): %s\n' "$name"
[ "$ok" = 1 ] || exit 1
