#!/usr/bin/env bash
# scripts/backup/vps/receive-and-restore.sh — приём и восстановление дампов на резервном сервере.
# Ставится install.sh в /usr/local/bin/a360-receive-and-restore, работает от пользователя a360backup.
#
# Модель PUSH: Railway-сервис db-backup после загрузки в бакет кладёт по rsync/SSH
# (ключ с forced-command `rrsync -wo`, только запись) в $INCOMING два файла:
#   <ГГГГ-ММ-ДДTЧЧZ>.dump      — pg_dump -Fc всей базы
#   <ГГГГ-ММ-ДДTЧЧZ>.manifest  — sha256, размер, число таблиц по схемам, строки ключевых таблиц
# Манифест приходит вторым; его появление запускает этот скрипт (systemd a360-restore.path, плюс
# страховочный a360-restore.timer раз в 30 мин).
#
# Режимы:
#   a360-receive-and-restore           обработать всё, что лежит во входящих
#   a360-receive-and-restore --check   сторож: успешного восстановления нет дольше MAX_AGE_HOURS →
#                                      уведомление (не чаще раза в REMIND_HOURS)
#
# Для каждого манифеста: sha256 и размер → база a360_<время> (CREATE DATABASE из template1, где
# install.sh заранее создал расширения) → pg_restore --no-owner --no-acl → сверка числа таблиц
# public/auth/storage и строк ключевых таблиц (profiles, companies, survey_answers, auth.users) с
# манифестом → переключение a360_current (старая текущая получает своё имя a360_<время>; держим
# KEEP_DBS восстановленных баз) → дамп шифруется age на диск в archive/runs (7 дней) и
# archive/monthly (первый за месяц, 12 штук) → открытый файл удаляется → журнал.
# Сбой: файлы уходят в incoming/failed/, база-кандидат удаляется, уведомление.
set -euo pipefail
umask 077

CONFIG="${A360_BACKUP_CONFIG:-/etc/a360backup/backup.env}"
# Конфиг — только KEY=VALUE, владелец root; читаем построчно, без source (никакого кода из файла).
if [ -r "$CONFIG" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    val="${val%\"}"; val="${val#\"}"
    if [ -z "${!key:-}" ]; then export "$key=$val"; fi
  done <"$CONFIG"
fi

INCOMING="${INCOMING:-/srv/a360backup/incoming}"
ARCHIVE="${ARCHIVE:-/srv/a360backup/archive}"
STATE="${STATE:-/var/lib/a360backup}"
LOG_FILE="${LOG_FILE:-/var/log/a360backup/restore.log}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-/etc/a360backup/age-recipients.txt}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PGHOST="${PGHOST:-/var/run/postgresql}"
KEEP_DAYS="${KEEP_DAYS:-7}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
KEEP_DBS="${KEEP_DBS:-2}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-10}"
REMIND_HOURS="${REMIND_HOURS:-6}"
RESTORE_JOBS="${RESTORE_JOBS:-2}"
export PGHOST

log() {
  local msg; msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  printf '%s\n' "$msg" >&2
  mkdir -p "$(dirname "$LOG_FILE")" && printf '%s\n' "$msg" >>"$LOG_FILE"
}

# Уведомление: Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) и/или вебхук (ALERT_WEBHOOK_URL,
# POST {"text": …}). Токены не печатаются; сбой отправки только пишется в журнал.
notify() {
  local text="[AIStart360 VPS-бэкап $(hostname -s)] $*"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS --max-time 20 -o /dev/null \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}" \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" 2>/dev/null \
      || log "уведомление в Telegram не ушло"
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    local body headers=(-H 'Content-Type: application/json')
    body="$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}))')"
    if [ -n "${ALERT_WEBHOOK_SECRET:-}" ]; then headers+=(-H "Authorization: Bearer ${ALERT_WEBHOOK_SECRET}"); fi
    curl -fsS --max-time 20 -o /dev/null "${headers[@]}" --data "$body" "$ALERT_WEBHOOK_URL" 2>/dev/null \
      || log "вебхук уведомления не ответил"
  fi
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
    log "уведомлять некуда (нет TELEGRAM_BOT_TOKEN/ALERT_WEBHOOK_URL): $text"
  fi
}

psql_q() { "$PG_BIN/psql" -X -At -v ON_ERROR_STOP=1 -d "${1}" -c "$2"; }
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
field() { grep -E "^$2=" "$1" | head -n 1 | cut -d= -f2- || true; }

# ─── Сторож ──────────────────────────────────────────────────────────────────
check_freshness() {
  local last="$STATE/last-success" now age_h
  now="$(date +%s)"
  if [ -f "$last" ]; then age_h=$(( (now - $(stat -c %Y "$last")) / 3600 )); else age_h=99999; fi
  if [ "$age_h" -le "$MAX_AGE_HOURS" ]; then log "check: последнее восстановление $age_h ч назад — норма"; return 0; fi
  local alert="$STATE/last-stale-alert"
  if [ -f "$alert" ] && [ $(( (now - $(stat -c %Y "$alert")) / 3600 )) -lt "$REMIND_HOURS" ]; then
    log "check: восстановления нет $age_h ч — уже сообщали"; return 0
  fi
  notify "Нет успешного восстановления дольше ${MAX_AGE_HOURS} ч (последнее: $(cat "$last" 2>/dev/null || echo 'никогда')). Проверьте db-backup на Railway и журнал $LOG_FILE."
  touch "$alert"
}

# ─── Одна поставка ───────────────────────────────────────────────────────────
quarantine() {
  local stem="$1" reason="$2"
  mkdir -p "$INCOMING/failed"
  mv -f "$INCOMING/$stem.manifest" "$INCOMING/$stem.dump" "$INCOMING/failed/" 2>/dev/null || true
  log "СБОЙ $stem: $reason (файлы в $INCOMING/failed/)"
  notify "Восстановление $stem НЕ удалось: $reason"
}

# Зовётся только в подоболочке (см. main): свой set -e, ERR-ловушка, выход через exit:
#   0 — восстановлено; 1 — сбой (файлы уже в incoming/failed, уведомление отправлено).
# Любой исход убирает манифест из входящих — a360-restore.path не крутится вхолостую.
CURRENT_STEM="" CURRENT_DB=""
on_unexpected() {
  [ -n "$CURRENT_DB" ] && psql_q postgres "DROP DATABASE IF EXISTS \"$CURRENT_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  quarantine "${CURRENT_STEM:-?}" "неожиданная ошибка (строка $1), см. $LOG_FILE и journalctl -u a360-restore"
  exit 1
}

restore_one() {
  local manifest="$1" stem dump db sum bytes t0
  stem="$(basename "$manifest" .manifest)"
  CURRENT_STEM="$stem"
  [[ "$stem" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}Z$ ]] || { quarantine "$stem" "имя не по шаблону"; exit 1; }
  dump="$INCOMING/$stem.dump"
  [ "$(field "$manifest" name)" = "$stem.dump" ] || { quarantine "$stem" "манифест от другого дампа"; exit 1; }
  # rsync кладёт файл атомарно (временное имя → rename), а манифест отправляется только после
  # дампа — значит, манифест без дампа уже не дополнится. В карантин сразу: иначе a360-restore.path
  # перезапускал бы службу по кругу, пока манифест лежит во входящих.
  [ -f "$dump" ] || { quarantine "$stem" "нет файла дампа"; exit 1; }
  t0="$(date +%s)"
  bytes="$(stat -c %s "$dump")"
  [ "$bytes" = "$(field "$manifest" bytes)" ] || { quarantine "$stem" "размер $bytes ≠ манифесту"; exit 1; }
  sum="$(sha256_of "$dump")"
  [ "$sum" = "$(field "$manifest" sha256)" ] || { quarantine "$stem" "sha256 не совпадает"; exit 1; }

  db="a360_$(printf '%s' "$stem" | tr -d '-' | tr 'TZ' 'tz')"            # a360_20261114t00z
  log "$stem: восстанавливаю в $db ($bytes байт)"
  psql_q postgres "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null
  CURRENT_DB="$db"
  psql_q postgres "CREATE DATABASE \"$db\" TEMPLATE template1" >/dev/null
  local rc=0 errors
  "$PG_BIN/pg_restore" --dbname="$db" --no-owner --no-acl --jobs="$RESTORE_JOBS" "$dump" 2>"$STATE/restore-$stem.err" || rc=$?
  errors="$(grep -c '^pg_restore: error:' "$STATE/restore-$stem.err" || true)"
  # Ошибки на чисто супабейзовских объектах (graphql, vault, net, publications, event triggers)
  # на обычном Postgres ожидаемы; годность решает сверка ниже.
  log "$stem: pg_restore код $rc, ошибок $errors (подробно: $STATE/restore-$stem.err)"

  local bad="" schema want got key t
  for schema in public auth storage; do
    want="$(field "$manifest" "tables.$schema")"
    [ -n "$want" ] || continue
    got="$(psql_q "$db" "SELECT count(*) FROM pg_tables WHERE schemaname = '$schema'")"
    [ "$got" = "$want" ] || bad="$bad таблиц в $schema $got≠$want;"
  done
  while IFS='=' read -r key want; do
    t="${key#rows.}"
    [[ "$t" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]] || continue
    got="$(psql_q "$db" "SELECT count(*) FROM $t" 2>/dev/null || echo 'нет')"
    [ "$got" = "$want" ] || bad="$bad строк в $t $got≠$want;"
  done < <(grep -E '^rows\.' "$manifest")
  if [ -n "$bad" ]; then
    psql_q postgres "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null || true
    CURRENT_DB=""
    quarantine "$stem" "сверка не прошла:$bad"
    exit 1
  fi

  switch_current "$db" "$stem"
  CURRENT_DB=""
  archive "$stem" "$dump" "$manifest"
  printf '%s %s\n' "$stem" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATE/last-success"
  rm -f "$STATE/last-stale-alert" "$STATE/restore-$stem.err"
  log "$stem: УСПЕХ за $(( $(date +%s) - t0 )) с; a360_current = $stem; ошибок pg_restore $errors"
}

# a360_current — всегда последняя проверенная база. Предыдущая получает обратно своё имя
# a360_<время> (оно хранится в COMMENT), лишние старые удаляются.
switch_current() {
  local db="$1" stem="$2" prev_stem prev_db
  if [ -n "$(psql_q postgres "SELECT 1 FROM pg_database WHERE datname = 'a360_current'")" ]; then
    prev_stem="$(psql_q postgres "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = 'a360_current'" | sed -n 's/^a360:\(.*\)$/\1/p')"
    prev_db="a360_$(printf '%s' "${prev_stem:-unknown$(date +%s)}" | tr -d '-' | tr 'TZ' 'tz')"
    psql_q postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'a360_current' AND pid <> pg_backend_pid()" >/dev/null || true
    psql_q postgres "ALTER DATABASE a360_current RENAME TO \"$prev_db\"" >/dev/null
  fi
  psql_q postgres "ALTER DATABASE \"$db\" RENAME TO a360_current" >/dev/null
  psql_q postgres "COMMENT ON DATABASE a360_current IS 'a360:$stem'" >/dev/null
  # Держим KEEP_DBS баз: a360_current + (KEEP_DBS-1) предыдущих a360_<время>.
  local keep_prev=$(( KEEP_DBS - 1 )) old
  for old in $(psql_q postgres "SELECT datname FROM pg_database WHERE datname ~ '^a360_[0-9]{8}t[0-9]{2}z\$' ORDER BY datname DESC OFFSET $keep_prev"); do
    log "удаляю старую базу $old"
    psql_q postgres "DROP DATABASE IF EXISTS \"$old\" WITH (FORCE)" >/dev/null
  done
}

# Шифрованный архив: открытый дамп на диске не остаётся. Расшифровать можно только ключом
# (identity), который хранится ВНЕ сервера (см. README) — сервер знает лишь публичный ключ.
archive() {
  local stem="$1" dump="$2" manifest="$3" month
  [ -s "$AGE_RECIPIENTS" ] || { log "нет $AGE_RECIPIENTS — архив не зашифровать, дамп удалён без архива"; notify "Нет ключа age: дамп $stem восстановлен, но в архив не попал"; rm -f "$dump" "$manifest"; return 0; }
  mkdir -p "$ARCHIVE/runs" "$ARCHIVE/monthly"
  age -R "$AGE_RECIPIENTS" -o "$ARCHIVE/runs/$stem.dump.age.part" "$dump"
  mv -f "$ARCHIVE/runs/$stem.dump.age.part" "$ARCHIVE/runs/$stem.dump.age"
  cp -f "$manifest" "$ARCHIVE/runs/$stem.manifest"
  month="${stem:0:7}"
  if [ ! -f "$ARCHIVE/monthly/$month.dump.age" ]; then
    cp -f "$ARCHIVE/runs/$stem.dump.age" "$ARCHIVE/monthly/$month.dump.age"
    cp -f "$manifest" "$ARCHIVE/monthly/$month.manifest"
    log "$stem: месячная копия $month"
  fi
  rm -f "$dump" "$manifest"
  # Ротация: только свои имена.
  find "$ARCHIVE/runs" -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}Z\.(dump\.age|manifest)' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/удалён из архива: /' >>"$LOG_FILE" || true
  local m
  for m in $(find "$ARCHIVE/monthly" -maxdepth 1 -type f -regextype posix-extended -regex '.*/[0-9]{4}-[0-9]{2}\.dump\.age' -printf '%f\n' | sort -r | tail -n +"$((KEEP_MONTHLY + 1))"); do
    rm -f "$ARCHIVE/monthly/$m" "$ARCHIVE/monthly/${m%.dump.age}.manifest"
    log "удалён месячный архив $m"
  done
}

main() {
  mkdir -p "$STATE"
  if [ "${1:-}" = "--check" ]; then check_freshness; return 0; fi
  exec 9>"$STATE/lock"
  flock -n 9 || { log "уже идёт другой запуск"; return 0; }
  local m rc failed=0
  shopt -s nullglob
  for m in "$INCOMING"/*.manifest; do
    # Подоболочка вне условия: иначе bash отключил бы в ней set -e (как в if / ||).
    set +e
    ( set -Eeuo pipefail; trap 'on_unexpected $LINENO' ERR; restore_one "$m"; exit 0 )
    rc=$?
    set -e
    [ "$rc" = 0 ] || failed=1
  done
  return "$failed"
}

main "$@"
