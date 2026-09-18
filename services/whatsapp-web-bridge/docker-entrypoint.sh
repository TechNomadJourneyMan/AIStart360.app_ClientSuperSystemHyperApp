#!/bin/sh
set -eu

auth_dir="${BRIDGE_AUTH_DIR:-/data/auth}"
state_dir="${BRIDGE_STATE_DIR:-/data/state}"

case "$auth_dir" in
  /data/*) ;;
  *) echo "BRIDGE_AUTH_DIR must be mounted below /data" >&2; exit 1 ;;
esac
case "$state_dir" in
  /data/*) ;;
  *) echo "BRIDGE_STATE_DIR must be mounted below /data" >&2; exit 1 ;;
esac

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$auth_dir" "$state_dir"
  chown bridge:bridge /data "$auth_dir" "$state_dir"
  exec gosu bridge "$@"
fi

exec "$@"
