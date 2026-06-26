#!/usr/bin/env bash
# Apply pending Alembic migrations using DATABASE_URL_DIRECT (sync driver).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../backend"
exec alembic upgrade head
