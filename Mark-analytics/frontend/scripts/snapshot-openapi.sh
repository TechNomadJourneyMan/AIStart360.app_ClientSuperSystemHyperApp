#!/usr/bin/env bash
# snapshot-openapi.sh
#
# Boot the FastAPI backend, wait for /health, dump /openapi.json to
# ./openapi.json (next to frontend/package.json), and shut the backend
# back down. Idempotent: safe to re-run; will not double-spawn.
#
# Used by CI when no live backend is available, so `openapi-typescript`
# can regenerate `src/types/api.ts` from a stable snapshot.

set -euo pipefail

# --- locations ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${FRONTEND_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

OUT_FILE="${FRONTEND_DIR}/openapi.json"
PID_FILE="${FRONTEND_DIR}/.uvicorn.pid"
LOG_FILE="${FRONTEND_DIR}/.uvicorn.log"

HOST="${OPENAPI_HOST:-127.0.0.1}"
PORT="${OPENAPI_PORT:-8000}"
BASE_URL="http://${HOST}:${PORT}"
WAIT_TIMEOUT="${OPENAPI_WAIT_TIMEOUT:-40}"

log() { printf '[snapshot-openapi] %s\n' "$*"; }

# --- cleanup ------------------------------------------------------------------
stop_backend() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      log "Stopping backend (pid=${pid})"
      kill "${pid}" 2>/dev/null || true
      # Give it 5s to drain
      for _ in 1 2 3 4 5; do
        kill -0 "${pid}" 2>/dev/null || break
        sleep 1
      done
      kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${PID_FILE}"
  fi
}
trap stop_backend EXIT

# --- preconditions ------------------------------------------------------------
if [[ ! -d "${BACKEND_DIR}" ]]; then
  log "ERROR: backend dir not found at ${BACKEND_DIR}"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  log "ERROR: curl is required"
  exit 1
fi

# Idempotent: kill any previous instance we own.
stop_backend

# --- detect existing backend on the port --------------------------------------
ALREADY_UP=0
if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  log "Backend already responding at ${BASE_URL}, reusing it"
  ALREADY_UP=1
fi

# --- spawn backend ------------------------------------------------------------
if [[ "${ALREADY_UP}" -eq 0 ]]; then
  if ! command -v uvicorn >/dev/null 2>&1; then
    log "ERROR: uvicorn not on PATH; install backend deps first"
    exit 1
  fi

  log "Starting uvicorn from ${BACKEND_DIR}"
  (
    cd "${BACKEND_DIR}"
    nohup uvicorn app.main:app --host "${HOST}" --port "${PORT}" \
      >"${LOG_FILE}" 2>&1 &
    echo $! >"${PID_FILE}"
  )

  log "Waiting up to ${WAIT_TIMEOUT}s for ${BASE_URL}/health"
  ok=0
  for _ in $(seq 1 "${WAIT_TIMEOUT}"); do
    if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done

  if [[ "${ok}" -ne 1 ]]; then
    log "ERROR: backend never became healthy"
    [[ -f "${LOG_FILE}" ]] && tail -n 50 "${LOG_FILE}" >&2 || true
    exit 1
  fi
fi

# --- snapshot -----------------------------------------------------------------
log "Fetching ${BASE_URL}/openapi.json -> ${OUT_FILE}"
TMP_FILE="$(mktemp)"
if ! curl -fsS "${BASE_URL}/openapi.json" -o "${TMP_FILE}"; then
  log "ERROR: failed to fetch openapi.json"
  rm -f "${TMP_FILE}"
  exit 1
fi

# Sanity check: must be JSON with a "paths" key.
if ! grep -q '"paths"' "${TMP_FILE}"; then
  log "ERROR: fetched file does not look like an OpenAPI document"
  rm -f "${TMP_FILE}"
  exit 1
fi

mv "${TMP_FILE}" "${OUT_FILE}"
log "Wrote $(wc -c <"${OUT_FILE}" | tr -d ' ') bytes to ${OUT_FILE}"
log "Done. Run: npm run gen:api:file"
