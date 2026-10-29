#!/usr/bin/env bash
set -euo pipefail
set +x
root=/var/www/aistart360
sha=${1:?Full reviewed SHA required}
[[ "$sha" =~ ^[a-f0-9]{40}$ ]]
release="$root/releases/$sha"
exec 9>"$root/deploy.lock"
flock -n 9
[[ "$(git -C "$release" rev-parse HEAD)" == "$sha" ]]
[[ -z "$(git -C "$release" status --porcelain --untracked-files=no)" ]]
[[ -f "$release/.next/BUILD_ID" && -f "$root/shared/.env.production" ]]
previous=$(readlink "$root/current" || true)
[[ -z "$previous" || "$previous" == "$root/releases/"* ]]
rollback() {
  trap - ERR
  if [[ -n "$previous" ]]; then
    ln -s "$previous" "$root/current.rollback"
    mv -Tf "$root/current.rollback" "$root/current"
    systemctl restart aistart360 || true
  else
    systemctl stop aistart360 || true
  fi
  exit 1
}
printf '{"sha":"%s"}\n' "$sha" > "$release/public/deployment.txt"
chown aistart360:aistart360 "$release/public/deployment.txt"
ln -s "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
trap rollback ERR
systemctl restart aistart360
ready=0
for attempt in {1..12}; do
  if node "$release/deploy/beget/readiness.mjs" "$sha"; then ready=1; break; fi
  sleep 3
done
if [[ "$ready" != 1 ]]; then
  rollback
fi
systemctl enable aistart360
trap - ERR
