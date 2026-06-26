#!/usr/bin/env bash
# Start local services and run the API with --reload.
# Usage: ./scripts/dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ docker compose up -d"
docker compose -f infra/docker/docker-compose.yml up -d

echo "→ waiting for postgres..."
for i in {1..30}; do
    if docker exec mark-postgres pg_isready -U postgres -d mark >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

cd backend
if [ -f .env ]; then
    echo "→ .env present"
else
    echo "→ no .env found; copying from .env.example"
    cp .env.example .env
    echo "  Please edit backend/.env and fill the SUPABASE_* / *_API_KEY values."
fi

echo "→ alembic upgrade head"
alembic upgrade head || echo "  (skipping — alembic not yet configured)"

echo "→ uvicorn"
exec uvicorn app.main:app --reload --port 8000
