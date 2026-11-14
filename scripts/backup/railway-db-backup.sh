#!/usr/bin/env bash
# scripts/backup/railway-db-backup.sh — бэкап базы и файлов Storage портала AIStart360 (R-011).
#
# Запускается cron-сервисом Railway `db-backup` (образ postgres:17) 3 раза в сутки:
#   30 0,8,16 * * *  (UTC) = 05:30 / 13:30 / 21:30 Алматы.
# Полное описание, переменные, развёртывание и восстановление — docs/backup/README.md.
#
# Шаги:
#   1. db       pg_dump всей базы (-Fc) в одном снимке с подсчётом строк ключевых таблиц →
#               проверки (размер, число таблиц по pg_restore -l, ключевые таблицы в оглавлении,
#               sha256) → загрузка в бакет: runs/ГГГГ-ММ-ДДTЧЧZ.dump (+ .manifest), хранится
#               последние BACKUP_KEEP_RUNS (21 ≈ 7 дней); monthly/ГГГГ-ММ.dump — первый успешный
#               запуск месяца, хранится BACKUP_KEEP_MONTHLY (12); latest.dump, latest.manifest,
#               latest.sha256. Удаляются ТОЛЬКО свои имена в runs/ и monthly/.
#   2. storage  rclone sync бакета файлов Storage → <BUCKET>/storage/current/; удалённое или
#               перезаписанное в источнике уезжает в storage/deleted/<время>/ и живёт
#               STORAGE_KEEP_DELETED_DAYS (30) дней. Источник только читается. Пропускается без
#               STORAGE_BUCKET.
#   3. vps      (необязательно) rsync дампа и манифеста на резервный сервер по SSH-ключу с
#               forced-command (rrsync -wo). Пропускается без VPS_BACKUP_HOST.
#   4. журнал   по строке на каждый шаг в public.ops_backup_runs (миграция 142) — и при сбое
#               (ok=false, error). Крон портала /api/cron/backup-freshness следит за свежестью.
#
# Коды выхода: 0 — всё хорошо; 1 — бэкап базы не удался; 2 — база в порядке, но упал storage/vps.
#
# Секретов в файле нет: всё из переменных окружения. Скрипт никогда не печатает их значения
# (никакого set -x; адреса баз в сообщениях об ошибках маскируются).
set -euo pipefail
umask 077

# ─── Настройки ───────────────────────────────────────────────────────────────
: "${POSTGRES_PRIVATE_URL:?POSTGRES_PRIVATE_URL не задан}"
PG_BIN="${PG_BIN:-}"                                   # каталог pg_dump/pg_restore/psql; пусто — из PATH
BACKUP_SKIP_UPLOAD="${BACKUP_SKIP_UPLOAD:-0}"          # 1 — только дамп и проверки (локальная отладка)
BACKUP_JOURNAL="${BACKUP_JOURNAL:-1}"                  # 0 — не писать в ops_backup_runs
BACKUP_MIN_BYTES="${BACKUP_MIN_BYTES:-1048576}"
BACKUP_MIN_TABLES="${BACKUP_MIN_TABLES:-200}"
BACKUP_KEEP_RUNS="${BACKUP_KEEP_RUNS:-21}"
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"
BACKUP_KEY_TABLES="${BACKUP_KEY_TABLES:-public.profiles public.companies public.survey_answers auth.users}"
BACKUP_DUMP_TIMEOUT="${BACKUP_DUMP_TIMEOUT:-3600}"
BACKUP_WORKDIR="${BACKUP_WORKDIR:-/tmp/a360-backup}"
S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-false}"
STORAGE_BUCKET="${STORAGE_BUCKET:-}"
STORAGE_FORCE_PATH_STYLE="${STORAGE_FORCE_PATH_STYLE:-$S3_FORCE_PATH_STYLE}"
STORAGE_KEEP_DELETED_DAYS="${STORAGE_KEEP_DELETED_DAYS:-30}"
STORAGE_SYNC_MAX_DELETE="${STORAGE_SYNC_MAX_DELETE:-500}"
VPS_BACKUP_HOST="${VPS_BACKUP_HOST:-}"
VPS_BACKUP_PORT="${VPS_BACKUP_PORT:-22}"
VPS_BACKUP_USER="${VPS_BACKUP_USER:-a360backup}"

TS="$(date -u +%Y-%m-%dT%HZ)"                          # ключ запуска: 2026-11-14T00Z
MONTH="$(date -u +%Y-%m)"
NAME="${TS}.dump"
WORK="${BACKUP_WORKDIR}/${TS}.$$"
DUMP="${WORK}/${NAME}"
MANIFEST="${WORK}/${TS}.manifest"
DST="a360dst"                                          # rclone-remote бакета бэкапов
SRC="a360src"                                          # rclone-remote бакета Storage

pg() { if [ -n "$PG_BIN" ]; then printf '%s/%s' "$PG_BIN" "$1"; else printf '%s' "$1"; fi; }
log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
# Маскирует логин:пароль в адресах (postgres://u:p@h → postgres://***@h) и обрезает до одной строки.
mask() { sed -E 's#://[^@/[:space:]]*@#://***@#g' | tr '\n' ' ' | cut -c1-1500; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
size_of() { wc -c <"$1" | tr -d ' '; }
with_timeout() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }

mkdir -p "$WORK"
cleanup() {
  exec 7>&- 2>/dev/null || true
  if [ -n "${SNAP_PID:-}" ]; then kill "$SNAP_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ─── Зависимости ─────────────────────────────────────────────────────────────
need_upload=0; [ "$BACKUP_SKIP_UPLOAD" = "1" ] || need_upload=1
need_storage=0; [ -z "$STORAGE_BUCKET" ] || need_storage=1
need_vps=0; [ -z "$VPS_BACKUP_HOST" ] || need_vps=1

install_deps() {
  local pkgs=""
  if [ $((need_upload + need_storage)) -gt 0 ] && ! command -v rclone >/dev/null 2>&1; then pkgs="$pkgs rclone ca-certificates"; fi
  if [ "$need_vps" = 1 ] && ! command -v rsync >/dev/null 2>&1; then pkgs="$pkgs rsync"; fi
  if [ "$need_vps" = 1 ] && ! command -v ssh >/dev/null 2>&1; then pkgs="$pkgs openssh-client"; fi
  [ -n "$pkgs" ] || return 0
  command -v apt-get >/dev/null 2>&1 || { log "нет apt-get, а нужны:$pkgs"; return 1; }
  log "ставлю:$pkgs (обычно 20–40 с)"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
  # shellcheck disable=SC2086 # список пакетов намеренно разбивается по пробелам
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $pkgs >/dev/null
}

# rclone настраивается только переменными окружения: ключи не попадают ни на диск, ни в argv.
configure_rclone() {
  if [ "$need_upload" = 1 ]; then
    : "${BUCKET:?BUCKET не задан}" "${ENDPOINT:?ENDPOINT не задан}" "${ACCESS_KEY_ID:?ACCESS_KEY_ID не задан}" \
      "${SECRET_ACCESS_KEY:?SECRET_ACCESS_KEY не задан}"
    export RCLONE_CONFIG_A360DST_TYPE=s3 RCLONE_CONFIG_A360DST_PROVIDER=Other \
      RCLONE_CONFIG_A360DST_ENDPOINT="$ENDPOINT" RCLONE_CONFIG_A360DST_REGION="${REGION:-auto}" \
      RCLONE_CONFIG_A360DST_ACCESS_KEY_ID="$ACCESS_KEY_ID" RCLONE_CONFIG_A360DST_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" \
      RCLONE_CONFIG_A360DST_FORCE_PATH_STYLE="$S3_FORCE_PATH_STYLE" RCLONE_CONFIG_A360DST_NO_CHECK_BUCKET=true
  fi
  if [ "$need_storage" = 1 ]; then
    : "${STORAGE_ENDPOINT:?STORAGE_ENDPOINT не задан}" "${STORAGE_ACCESS_KEY_ID:?STORAGE_ACCESS_KEY_ID не задан}" \
      "${STORAGE_SECRET_ACCESS_KEY:?STORAGE_SECRET_ACCESS_KEY не задан}"
    export RCLONE_CONFIG_A360SRC_TYPE=s3 RCLONE_CONFIG_A360SRC_PROVIDER=Other \
      RCLONE_CONFIG_A360SRC_ENDPOINT="$STORAGE_ENDPOINT" RCLONE_CONFIG_A360SRC_REGION="${STORAGE_REGION:-auto}" \
      RCLONE_CONFIG_A360SRC_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY_ID" RCLONE_CONFIG_A360SRC_SECRET_ACCESS_KEY="$STORAGE_SECRET_ACCESS_KEY" \
      RCLONE_CONFIG_A360SRC_FORCE_PATH_STYLE="$STORAGE_FORCE_PATH_STYLE" RCLONE_CONFIG_A360SRC_NO_CHECK_BUCKET=true
  fi
  export RCLONE_STATS=0 RCLONE_RETRIES=3 RCLONE_LOW_LEVEL_RETRIES=10
}

# ─── Общее для шагов ─────────────────────────────────────────────────────────
# Каждый шаг идёт в подоболочке с собственным set -e: сбой шага не мешает остальным и
# журналу. Итог шага — файлы $WORK/<шаг>.{rc,error,bytes,tables,sha256,key}.
# ВАЖНО: run_step нельзя звать в условии (if / || / &&) — bash там отключает set -e для всего
# вызванного, включая подоболочку, и упавшая команда шага не остановила бы его. Поэтому
# run_step всегда возвращает 0, а код шага лежит в $WORK/<шаг>.rc.
STEP=""
step() { STEP="$1"; log "$1"; }
on_err() {
  local kind="$1" rc="$2"
  if [ ! -s "$WORK/$kind.error" ]; then
    printf '%s: код %s; %s' "$STEP" "$rc" "$(tail -n 3 "$WORK/$kind.stderr" 2>/dev/null | mask)" >"$WORK/$kind.error"
  fi
}
fail() { printf '%s' "$2" >"$WORK/$1.error"; log "ОШИБКА: $2"; exit 1; }
put() { printf '%s' "$3" >"$WORK/$1.$2"; }
get() { if [ -f "$WORK/$1.$2" ]; then cat "$WORK/$1.$2"; fi; }

run_step() {
  local kind="$1" started rc
  started="$(now_iso)"; put "$kind" started "$started"
  set +e
  (
    set -Eeuo pipefail
    trap 'on_err '"$kind"' $?' ERR
    "${kind}_backup"
  ) 2>>"$WORK/$kind.stderr"
  rc=$?
  set -e
  # Всё, что шаг написал в stderr, видно в логах Railway (адреса замаскированы).
  if [ -s "$WORK/$kind.stderr" ]; then mask_lines <"$WORK/$kind.stderr" >&2; fi
  put "$kind" finished "$(now_iso)"
  put "$kind" rc "$rc"
  if [ "$rc" -ne 0 ] && [ ! -s "$WORK/$kind.error" ]; then put "$kind" error "$kind: код выхода $rc"; fi
  return 0
}
step_ok() { if [ "$(get "$1" rc)" = "0" ]; then echo true; else echo false; fi; }
mask_lines() { sed -E 's#://[^@/[:space:]]*@#://***@#g'; }

# ─── Шаг 1: база ─────────────────────────────────────────────────────────────
SNAP_PID=""
snapshot_open() {
  # Отдельная сессия держит транзакцию REPEATABLE READ: pg_dump берёт её снимок (--snapshot),
  # а строки ключевых таблиц считаются в том же снимке — контрольные числа точно совпадут с дампом.
  mkfifo "$WORK/snap.in"
  "$(pg psql)" "$POSTGRES_PRIVATE_URL" -X -q -At -v ON_ERROR_STOP=1 <"$WORK/snap.in" >"$WORK/snap.out" 2>>"$WORK/db.stderr" &
  SNAP_PID=$!
  exec 7>"$WORK/snap.in"
  printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' 'SELECT pg_export_snapshot();' >&7
  local t
  for t in $BACKUP_KEY_TABLES; do
    printf '%s' "$t" | grep -Eq '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' || fail db "неверное имя таблицы в BACKUP_KEY_TABLES: $t"
    printf "SELECT 'rows.%s=' || count(*) FROM %s;\n" "$t" "$t" >&7
  done
  # shellcheck disable=SC2086 # список таблиц намеренно разбивается по пробелам
  local want=$(( $(printf '%s\n' $BACKUP_KEY_TABLES | wc -l) + 1 )) i=0
  while [ "$(wc -l <"$WORK/snap.out" | tr -d ' ')" -lt "$want" ]; do
    kill -0 "$SNAP_PID" 2>/dev/null || fail db "снимок: psql завершился ($(tail -n 2 "$WORK/db.stderr" | mask))"
    i=$((i + 1)); [ "$i" -lt 600 ] || fail db "снимок: нет ответа 60 с"
    sleep 0.1
  done
}
snapshot_close() {
  printf '%s\n' 'COMMIT;' >&7
  exec 7>&-
  wait "$SNAP_PID" || true
  SNAP_PID=""
}

db_backup() {
  step "db: снимок и счётчики строк"
  snapshot_open
  local snapshot; snapshot="$(head -n 1 "$WORK/snap.out")"
  printf '%s' "$snapshot" | grep -Eq '^[0-9A-F-]+$' || fail db "снимок: неожиданный ответ"

  step "db: pg_dump"
  with_timeout "$BACKUP_DUMP_TIMEOUT" "$(pg pg_dump)" "$POSTGRES_PRIVATE_URL" --format=custom --snapshot="$snapshot" \
    --no-password --file="$DUMP"
  snapshot_close

  step "db: проверки"
  local bytes tables sum toc
  bytes="$(size_of "$DUMP")"
  [ "$bytes" -gt "$BACKUP_MIN_BYTES" ] || fail db "дамп слишком мал: $bytes байт (порог $BACKUP_MIN_BYTES)"
  toc="$WORK/toc.txt"
  "$(pg pg_restore)" --list "$DUMP" >"$toc"
  tables="$(grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE ' "$toc" || true)"
  [ "$tables" -gt "$BACKUP_MIN_TABLES" ] || fail db "в дампе $tables таблиц (порог $BACKUP_MIN_TABLES)"
  local t
  for t in $BACKUP_KEY_TABLES; do
    grep -Eq "^[0-9]+; [0-9]+ [0-9]+ TABLE ${t%%.*} ${t#*.} " "$toc" || fail db "в дампе нет таблицы $t"
    grep -Eq "^[0-9]+; [0-9]+ [0-9]+ TABLE DATA ${t%%.*} ${t#*.} " "$toc" || fail db "в дампе нет данных таблицы $t"
  done
  sum="$(sha256_of "$DUMP")"
  put db bytes "$bytes"; put db tables "$tables"; put db sha256 "$sum"
  {
    echo "format=a360-backup-manifest-v1"
    echo "created_at=$(now_iso)"
    echo "name=$NAME"
    echo "bytes=$bytes"
    echo "sha256=$sum"
    echo "tables=$tables"
    awk '$4 == "TABLE" && $5 ~ /^(public|auth|storage)$/ { n[$5]++ } END { for (s in n) print "tables." s "=" n[s] }' "$toc" | sort
    { grep '^rows\.' "$WORK/snap.out" || true; } | sort
  } >"$MANIFEST"
  log "дамп: $bytes байт, таблиц $tables, sha256 $sum"

  if [ "$need_upload" != 1 ]; then
    put db key "local:$NAME"
    mkdir -p "${BACKUP_KEEP_LOCAL_DIR:-$BACKUP_WORKDIR}" && cp "$DUMP" "$MANIFEST" "${BACKUP_KEEP_LOCAL_DIR:-$BACKUP_WORKDIR}/"
    log "BACKUP_SKIP_UPLOAD=1: загрузка пропущена, файлы в ${BACKUP_KEEP_LOCAL_DIR:-$BACKUP_WORKDIR}"
    return 0
  fi

  local base="$DST:$BUCKET"
  step "db: загрузка runs/$NAME"
  rclone copyto "$DUMP" "$base/runs/$NAME"
  rclone copyto "$MANIFEST" "$base/runs/${TS}.manifest"
  local remote_bytes
  remote_bytes="$(rclone lsf --files-only --format s "$base/runs/$NAME" | head -n 1 | tr -d '[:space:]')"
  [ "$remote_bytes" = "$bytes" ] || fail db "в бакете $remote_bytes байт вместо $bytes"
  put db key "runs/$NAME"

  step "db: latest"
  rclone copyto "$base/runs/$NAME" "$base/latest.dump"
  rclone copyto "$MANIFEST" "$base/latest.manifest"
  printf '%s  latest.dump\n' "$sum" >"$WORK/latest.sha256"
  rclone copyto "$WORK/latest.sha256" "$base/latest.sha256"

  step "db: monthly"
  if ! rclone lsf --files-only "$base/monthly/" | grep -qx "${MONTH}.dump"; then
    rclone copyto "$base/runs/$NAME" "$base/monthly/${MONTH}.dump"
    rclone copyto "$MANIFEST" "$base/monthly/${MONTH}.manifest"
    log "monthly/${MONTH}.dump — первый успешный бэкап месяца"
  fi

  step "db: ротация"
  rotate "$base/runs/" '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}Z' "$BACKUP_KEEP_RUNS"
  rotate "$base/monthly/" '^[0-9]{4}-[0-9]{2}' "$BACKUP_KEEP_MONTHLY"
}

# Оставляет в каталоге $1 последние $3 «запусков» с именами вида <$2>.dump, удаляя вместе с
# дампом его .manifest. Чужие имена (не по шаблону) не трогает никогда.
rotate() {
  local dir="$1" stem="$2" keep="$3" listing old s
  listing="$(rclone lsf --files-only "$dir")"
  old="$(printf '%s\n' "$listing" | { grep -E "${stem}\\.dump\$" || true; } | sort | awk -v k="$keep" '{ a[NR] = $0 } END { for (i = 1; i <= NR - k; i++) print a[i] }')"
  for s in $old; do
    s="${s%.dump}"
    printf '%s' "$s" | grep -Eq "${stem}\$" || continue
    log "ротация: удаляю ${dir}${s}.dump"
    rclone deletefile "${dir}${s}.dump"
    if printf '%s\n' "$listing" | grep -qx "${s}.manifest"; then rclone deletefile "${dir}${s}.manifest"; fi
  done
}

# ─── Шаг 2: файлы Storage ────────────────────────────────────────────────────
storage_backup() {
  step "storage: sync $STORAGE_BUCKET → storage/current"
  [ "$need_upload" = 1 ] || fail storage "копия Storage требует бакет бэкапов (BACKUP_SKIP_UPLOAD=1)"
  if [ "${STORAGE_ENDPOINT%/}" = "${ENDPOINT%/}" ] && [ "$STORAGE_BUCKET" = "$BUCKET" ]; then
    fail storage "STORAGE_BUCKET совпадает с бакетом бэкапов"
  fi
  local base="$DST:$BUCKET"
  rclone sync "$SRC:$STORAGE_BUCKET" "$base/storage/current" \
    --backup-dir "$base/storage/deleted/$TS" --max-delete "$STORAGE_SYNC_MAX_DELETE" --fast-list
  step "storage: чистка storage/deleted старше ${STORAGE_KEEP_DELETED_DAYS} дн."
  rclone delete "$base/storage/deleted" --min-age "${STORAGE_KEEP_DELETED_DAYS}d"
  local size_json bytes
  size_json="$(rclone size --json "$base/storage/current")"
  bytes="$(printf '%s' "$size_json" | sed -nE 's/.*"bytes":([0-9]+).*/\1/p')"
  put storage bytes "${bytes:-0}"; put storage key "storage/current/"
  log "storage: ${bytes:-0} байт в storage/current"
}

# ─── Шаг 3: резервный сервер ─────────────────────────────────────────────────
vps_backup() {
  step "vps: передача на $VPS_BACKUP_HOST"
  [ -f "$DUMP" ] && [ -f "$MANIFEST" ] || fail vps "нет дампа: бэкап базы не удался"
  : "${VPS_SSH_KEY_B64:?VPS_SSH_KEY_B64 не задан}" "${VPS_SSH_KNOWN_HOSTS:?VPS_SSH_KNOWN_HOSTS не задан}"
  printf '%s' "$VPS_SSH_KEY_B64" | base64 -d >"$WORK/vps_key"
  printf '%s\n' "$VPS_SSH_KNOWN_HOSTS" >"$WORK/vps_known_hosts"
  chmod 600 "$WORK/vps_key" "$WORK/vps_known_hosts"
  local ssh_cmd="ssh -i $WORK/vps_key -p $VPS_BACKUP_PORT -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$WORK/vps_known_hosts -o ConnectTimeout=20 -o ServerAliveInterval=30"
  # Сначала дамп, потом манифест: появление манифеста запускает восстановление на сервере.
  rsync -t --timeout=600 -e "$ssh_cmd" "$DUMP" "${VPS_BACKUP_USER}@${VPS_BACKUP_HOST}:"
  rsync -t --timeout=120 -e "$ssh_cmd" "$MANIFEST" "${VPS_BACKUP_USER}@${VPS_BACKUP_HOST}:"
  put vps bytes "$(get db bytes)"; put vps sha256 "$(get db sha256)"; put vps key "vps:$NAME"
}

# ─── Журнал ──────────────────────────────────────────────────────────────────
journal() {
  local kind="$1" ok="$2"
  [ "$BACKUP_JOURNAL" = "1" ] || return 0
  # Значения идут psql-переменными (:'x') — экранирование делает psql, текст ошибки безопасен.
  if ! "$(pg psql)" "$POSTGRES_PRIVATE_URL" -X -q -v ON_ERROR_STOP=1 \
      -v kind="$kind" -v ok="$ok" -v started="$(get "$kind" started)" -v finished="$(get "$kind" finished)" \
      -v bytes="$(get "$kind" bytes)" -v tables="$(get "$kind" tables)" -v sha="$(get "$kind" sha256)" \
      -v key="$(get "$kind" key)" -v err="$(get "$kind" error | cut -c1-3900)" >/dev/null 2>>"$WORK/journal.stderr" <<'SQL'
INSERT INTO public.ops_backup_runs (started_at, finished_at, ok, kind, bytes, tables, sha256, object_key, error)
VALUES (:'started'::timestamptz, NULLIF(:'finished', '')::timestamptz, :'ok'::boolean, :'kind',
        NULLIF(:'bytes', '')::bigint, NULLIF(:'tables', '')::int, NULLIF(:'sha', ''),
        NULLIF(:'key', ''), NULLIF(:'err', ''));
SQL
  then
    log "ВНИМАНИЕ: запись в ops_backup_runs не удалась (миграция 142?): $(tail -n 2 "$WORK/journal.stderr" | mask)"
  fi
}

# ─── Запуск ──────────────────────────────────────────────────────────────────
main() {
  log "старт $TS (upload=$need_upload storage=$need_storage vps=$need_vps)"
  install_deps
  configure_rclone

  local db_ok=true storage_ok=true vps_ok=true
  run_step db; db_ok="$(step_ok db)"
  journal db "$db_ok"

  if [ "$need_storage" = 1 ]; then
    run_step storage; storage_ok="$(step_ok storage)"
    journal storage "$storage_ok"
  else
    log "storage: пропущено (нет STORAGE_BUCKET)"
  fi

  if [ "$need_vps" = 1 ] && [ "$db_ok" = true ]; then
    run_step vps; vps_ok="$(step_ok vps)"
    journal vps "$vps_ok"
  elif [ "$need_vps" = 1 ]; then
    log "vps: пропущено — бэкап базы не удался"
  fi

  if [ "$db_ok" != true ]; then log "ИТОГ: бэкап базы НЕ удался: $(get db error)"; exit 1; fi
  if [ "$storage_ok" != true ] || [ "$vps_ok" != true ]; then
    log "ИТОГ: база в порядке; storage=$storage_ok vps=$vps_ok"; exit 2
  fi
  log "ИТОГ: всё в порядке ($(get db key))"
}

main "$@"
