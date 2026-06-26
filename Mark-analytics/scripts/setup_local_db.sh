#!/usr/bin/env bash
# Local dev DB bootstrap WITHOUT Docker.
# Requires: brew install postgresql@17 pgvector redis
#
# Idempotent — safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BREW_PREFIX="$(brew --prefix)"
PG_BIN="$BREW_PREFIX/opt/postgresql@17/bin"
DB_NAME="${DB_NAME:-mark}"

echo "→ Starting Postgres + Redis (brew services)"
brew services start postgresql@17 >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true

# Wait for Postgres
echo -n "→ Waiting for Postgres on 5432"
for i in {1..30}; do
    if "$PG_BIN/pg_isready" -h localhost -p 5432 >/dev/null 2>&1; then
        echo " ✓"
        break
    fi
    sleep 1
    echo -n "."
done

# Create DB if missing
if ! "$PG_BIN/psql" -h localhost -U "$USER" -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
    echo "→ Creating database '$DB_NAME'"
    "$PG_BIN/createdb" -h localhost -U "$USER" "$DB_NAME"
fi

# Enable extensions
echo "→ Enabling extensions in '$DB_NAME'"
"$PG_BIN/psql" -h localhost -U "$USER" -d "$DB_NAME" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'postgis unavailable — geo features degraded';
END $$;
SQL

# Update .env to use the local OS user (no password by default on macOS brew)
ENV_FILE="$ROOT/backend/.env"
if [ -f "$ENV_FILE" ]; then
    echo "→ Patching $ENV_FILE for local OS-user auth"
    python3 - "$ENV_FILE" "$USER" "$DB_NAME" <<'PY'
import sys, re, pathlib
path, user, db = sys.argv[1], sys.argv[2], sys.argv[3]
text = pathlib.Path(path).read_text()
def patch(line):
    if line.startswith("DATABASE_URL="):
        return f"DATABASE_URL=postgresql+asyncpg://{user}@localhost:5432/{db}"
    if line.startswith("DATABASE_URL_DIRECT="):
        return f"DATABASE_URL_DIRECT=postgresql://{user}@localhost:5432/{db}"
    return line
out = "\n".join(patch(l) for l in text.splitlines()) + "\n"
pathlib.Path(path).write_text(out)
PY
fi

# Run migrations
echo "→ Running Alembic migrations"
cd backend
../.venv/bin/alembic upgrade head

# Show created tables
echo
echo "→ Tables in '$DB_NAME':"
"$PG_BIN/psql" -h localhost -U "$USER" -d "$DB_NAME" -c "\dt"

echo
echo "✓ Local DB ready. Start backend with:  make dev  (or via .claude/launch.json)"
