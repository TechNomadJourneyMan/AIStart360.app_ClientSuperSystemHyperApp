#!/usr/bin/env bash
# Redeploy the LATEST main commit to production — and NOTHING older.
#
# Why this exists: `vercel redeploy <url>` rebuilds the *exact commit* of the
# deployment you point it at. Pointing it at an old deployment silently ships an
# old commit to production. This script always resolves the current tip of
# origin/main and only ever (re)deploys THAT commit.
#
# Usage:  ./scripts/redeploy-latest.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM=team_xdferxvA0jNPmQ0r90px4lVy
PROJ=prj_Y35sNTaTo98oWp2BZoxIvMwIOFxz
SCOPE=technomadjourneymans-projects

if [ -z "${VERCEL_TOKEN:-}" ]; then
  export VERCEL_TOKEN=$(grep '^VERCEL_TOKEN=' .env.local | cut -d= -f2-)
fi
[ -n "${VERCEL_TOKEN:-}" ] || { echo "VERCEL_TOKEN not set (add it to .env.local)"; exit 1; }

git fetch -q origin main
LATEST=$(git rev-parse origin/main)
echo "→ Latest main commit: $LATEST"

# Find a production deployment already built from the latest commit.
URL=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PROJ&target=production&limit=20&teamId=$TEAM" \
  | python3 -c "import sys,json
d=json.load(sys.stdin)
sha='$LATEST'
for x in d.get('deployments',[]):
    if (x.get('meta',{}).get('githubCommitSha') or '')==sha and x.get('state')=='READY':
        print('https://'+x['url']); break")

if [ -z "$URL" ]; then
  echo "✗ No READY production deployment for the latest commit yet."
  echo "  Trigger a fresh build from git instead:"
  echo "    git commit --allow-empty -m 'chore: redeploy latest' && git push origin main"
  exit 1
fi

echo "→ Redeploying latest-commit deployment: $URL"
vercel redeploy "$URL" --scope "$SCOPE" --token "$VERCEL_TOKEN"
