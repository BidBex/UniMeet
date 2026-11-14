#!/usr/bin/env bash
set -euo pipefail

HOST="0.0.0.0"
PORT="${PORT:-${DEFAULT_APP_PORT:-3000}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-$PORT}"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --host)
      HOST="${2:-$HOST}"
      shift 2
      ;;
    --host=*)
      HOST="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONPATH="${ROOT_DIR}/backend"
export DATABASE_URL="${DATABASE_URL:-sqlite:///${ROOT_DIR}/backend/unimeet.db}"

VENV_DIR="${ROOT_DIR}/backend/.venv"
VENV_PY="${VENV_DIR}/bin/python"
VENV_UVICORN="${VENV_DIR}/bin/uvicorn"

bash "${ROOT_DIR}/backend/ensure_venv.sh"

# Ensure schema & demo data exist on first boot in non-production environments
if [[ "${ENVIRONMENT:-development}" != "production" && ! -s "${ROOT_DIR}/backend/unimeet.db" ]]; then
  "${VENV_PY}" -m app.seed >/dev/null 2>&1 || true
fi

exec "${VENV_UVICORN}" app.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --proxy-headers \
  --forwarded-allow-ips="*"
