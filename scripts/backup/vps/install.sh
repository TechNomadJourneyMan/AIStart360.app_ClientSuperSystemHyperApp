#!/usr/bin/env bash
# scripts/backup/vps/install.sh — подготовка резервного сервера бэкапов AIStart360 (Ubuntu 24.04).
# Запуск: от root на чистом сервере, из каталога с этим файлом и receive-and-restore.sh:
#
#   sudo bash install.sh --push-key "ssh-ed25519 AAAA… railway-db-backup" \
#                        [--age-recipient "age1…"] [--ssh-port 22]
#
# Что делает (повторный запуск безопасен):
#   1. пакеты: PostgreSQL 17 + pgvector из PGDG, age, rsync (с rrsync), ufw, curl, python3;
#   2. Postgres слушает ТОЛЬКО localhost; роль a360backup (LOGIN CREATEDB, pg_signal_backend),
#      роли Supabase без входа (anon, authenticated, service_role, …) — чтобы политики RLS и
#      GRANT из дампа восстанавливались; в template1 — схема extensions и расширения из дампа;
#   3. системный пользователь a360backup, каталоги /srv/a360backup/{incoming,archive},
#      /var/lib/a360backup, /var/log/a360backup, /etc/a360backup;
#   4. ~a360backup/.ssh/authorized_keys: ключ Railway с forced-command `rrsync -wo` — этим ключом
#      можно ТОЛЬКО записать файл во входящие (ни shell, ни чтения, ни проброса портов);
#   5. /usr/local/bin/a360-receive-and-restore + systemd: a360-restore.path (появился манифест →
#      восстановление), a360-restore.timer (страховка раз в 30 мин), a360-backup-check.timer (раз в
#      час: восстановления нет дольше 10 ч → уведомление);
#   6. ufw: входящие только SSH;
#   7. ключ age: если --age-recipient не дан, создаётся пара; ПРИВАТНЫЙ ключ печатается один раз
#      и удаляется с сервера — его надо сохранить вне сервера (менеджер паролей PO).
set -euo pipefail

PUSH_KEY="" AGE_RECIPIENT="" SSH_PORT=22
while [ $# -gt 0 ]; do
  case "$1" in
    --push-key) PUSH_KEY="$2"; shift 2 ;;
    --age-recipient) AGE_RECIPIENT="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    *) echo "неизвестный флаг $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "нужен root (sudo)" >&2; exit 1; }
[[ "$PUSH_KEY" =~ ^ssh-(ed25519|rsa)\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "нужен --push-key \"ssh-ed25519 AAAA… комментарий\" (публичный ключ Railway)" >&2; exit 2; }
[ -z "$AGE_RECIPIENT" ] || [[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] || { echo "--age-recipient должен быть age1…" >&2; exit 2; }
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "--ssh-port — число" >&2; exit 2; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "ВНИМАНИЕ: проверено на Ubuntu 24.04, здесь ${PRETTY_NAME:-?}" >&2
here="$(cd "$(dirname "$0")" && pwd)"
[ -f "$here/receive-and-restore.sh" ] || { echo "рядом нет receive-and-restore.sh" >&2; exit 1; }

USER_NAME=a360backup
HOME_DIR=/srv/a360backup
PGV=17
say() { printf '\n=== %s\n' "$*"; }

say "1/7 пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql-common ca-certificates curl gnupg
if [ ! -f /etc/apt/sources.list.d/pgdg.list ] && [ ! -f /etc/apt/sources.list.d/pgdg.sources ]; then
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
fi
apt-get install -y -qq "postgresql-$PGV" "postgresql-$PGV-pgvector" age rsync ufw python3 util-linux

say "2/7 PostgreSQL $PGV: только localhost, роли, расширения"
systemctl enable --now "postgresql@$PGV-main" >/dev/null 2>&1 || systemctl enable --now postgresql
psu() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }
psu -c "ALTER SYSTEM SET listen_addresses = 'localhost'"
# Под 4 ГБ ОЗУ: быстрее восстановление, без риска OOM.
psu -c "ALTER SYSTEM SET shared_buffers = '1GB'" -c "ALTER SYSTEM SET maintenance_work_mem = '512MB'" \
    -c "ALTER SYSTEM SET work_mem = '16MB'" -c "ALTER SYSTEM SET max_wal_size = '4GB'"
systemctl restart "postgresql@$PGV-main" 2>/dev/null || systemctl restart postgresql
psu <<'SQL'
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'a360backup') THEN
    CREATE ROLE a360backup LOGIN CREATEDB;
  END IF;
  -- Роли self-hosted Supabase: без входа, только чтобы GRANT / CREATE POLICY … TO … из дампа
  -- восстанавливались (pg_restore --no-acl их и так пропускает, но политики RLS ссылаются на роли).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
    'supabase_auth_admin', 'supabase_storage_admin', 'supabase_functions_admin', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_read_only_user', 'dashboard_user', 'pgbouncer', 'pgsodium_keyholder',
    'pgsodium_keyiduser', 'pgsodium_keymaker', 'supabase_etl_admin']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
GRANT pg_signal_backend TO a360backup;
SQL
# Расширения, которые есть в дампе Supabase и бывают в обычном Postgres: создаём их в template1
# (в схеме extensions, как в Supabase) — каждая новая база a360_* получает их готовыми, а
# a360backup не нужен суперпользователь. Чего нет (pg_graphql, supabase_vault, pgsodium, pg_net)
# — восстановится с ошибками в своих схемах; сверка ключевых таблиц это учитывает.
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d template1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
SQL

say "3/7 пользователь и каталоги"
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$HOME_DIR" --create-home --shell /bin/bash "$USER_NAME"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR" "$HOME_DIR/incoming" "$HOME_DIR/incoming/failed" \
  "$HOME_DIR/archive" "$HOME_DIR/archive/runs" "$HOME_DIR/archive/monthly" /var/lib/a360backup
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" /var/log/a360backup
install -d -m 0750 -o root -g "$USER_NAME" /etc/a360backup
if [ ! -f /etc/a360backup/backup.env ]; then
  cat >/etc/a360backup/backup.env <<'ENV'
# /etc/a360backup/backup.env — настройки a360-receive-and-restore (KEY=VALUE, без кавычек-кода).
# Уведомления о сбое (любое из двух; пусто — только журнал):
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ALERT_WEBHOOK_URL=
ALERT_WEBHOOK_SECRET=
# Хранение
KEEP_DAYS=7
KEEP_MONTHLY=12
KEEP_DBS=2
MAX_AGE_HOURS=10
REMIND_HOURS=6
RESTORE_JOBS=2
ENV
fi
chown root:"$USER_NAME" /etc/a360backup/backup.env
chmod 0640 /etc/a360backup/backup.env

say "4/7 SSH: ключ Railway только на запись во входящие"
RRSYNC=/usr/bin/rrsync
if [ ! -x "$RRSYNC" ]; then
  if [ -f /usr/share/doc/rsync/scripts/rrsync.gz ]; then
    gunzip -c /usr/share/doc/rsync/scripts/rrsync.gz >/usr/local/bin/rrsync && chmod 0755 /usr/local/bin/rrsync
    RRSYNC=/usr/local/bin/rrsync
  else
    echo "не найден rrsync (пакет rsync ≥ 3.2.4)" >&2; exit 1
  fi
fi
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
LINE="command=\"$RRSYNC -wo $HOME_DIR/incoming\",restrict $PUSH_KEY"
touch "$AUTH"
grep -qxF "$LINE" "$AUTH" || printf '%s\n' "$LINE" >>"$AUTH"
chown "$USER_NAME:$USER_NAME" "$AUTH"; chmod 0600 "$AUTH"

say "5/7 скрипт и systemd"
install -m 0755 -o root -g root "$here/receive-and-restore.sh" /usr/local/bin/a360-receive-and-restore
cat >/etc/systemd/system/a360-restore.service <<UNIT
[Unit]
Description=AIStart360: восстановление пришедших дампов
After=postgresql.service

[Service]
Type=oneshot
User=$USER_NAME
Group=$USER_NAME
ExecStart=/usr/local/bin/a360-receive-and-restore
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=3h
UNIT
cat >/etc/systemd/system/a360-restore.path <<UNIT
[Unit]
Description=AIStart360: пришёл манифест дампа

[Path]
PathExistsGlob=$HOME_DIR/incoming/*.manifest
Unit=a360-restore.service

[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/systemd/system/a360-restore.timer <<'UNIT'
[Unit]
Description=AIStart360: страховочный запуск восстановления

[Timer]
OnCalendar=*:0/30
Persistent=true
Unit=a360-restore.service

[Install]
WantedBy=timers.target
UNIT
cat >/etc/systemd/system/a360-backup-check.service <<UNIT
[Unit]
Description=AIStart360: сторож свежести восстановлений

[Service]
Type=oneshot
User=$USER_NAME
Group=$USER_NAME
ExecStart=/usr/local/bin/a360-receive-and-restore --check
UNIT
cat >/etc/systemd/system/a360-backup-check.timer <<'UNIT'
[Unit]
Description=AIStart360: сторож свежести раз в час

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now a360-restore.path a360-restore.timer a360-backup-check.timer

say "6/7 ufw: входящие только SSH"
ufw allow "$SSH_PORT/tcp" comment 'ssh' >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,12p'

say "7/7 ключ шифрования архива (age)"
if [ ! -s /etc/a360backup/age-recipients.txt ]; then
  if [ -z "$AGE_RECIPIENT" ]; then
    tmp="$(mktemp)"; age-keygen -o "$tmp" 2>/dev/null
    AGE_RECIPIENT="$(grep -o 'age1[0-9a-z]*' "$tmp" | head -n 1)"
    echo "!!! ПРИВАТНЫЙ КЛЮЧ age — сохраните ЕГО ВНЕ сервера (менеджер паролей), здесь он будет удалён:"
    cat "$tmp"
    shred -u "$tmp" 2>/dev/null || rm -f "$tmp"
  fi
  printf '%s\n' "$AGE_RECIPIENT" >/etc/a360backup/age-recipients.txt
fi
chown root:"$USER_NAME" /etc/a360backup/age-recipients.txt; chmod 0640 /etc/a360backup/age-recipients.txt

echo
echo "Готово. Проверка:"
echo "  sudo -u postgres psql -c 'SHOW listen_addresses'      # localhost"
echo "  systemctl list-timers 'a360-*'; systemctl status a360-restore.path"
echo "  ssh-keyscan -t ed25519 <этот хост>                      # строка для VPS_SSH_KNOWN_HOSTS на Railway"
echo "  tail -f /var/log/a360backup/restore.log"
