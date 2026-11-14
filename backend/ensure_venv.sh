#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${ROOT_DIR}/backend/.venv"
VENV_PY="${VENV_DIR}/bin/python"
VENV_UVICORN="${VENV_DIR}/bin/uvicorn"

if [[ ! -x "$VENV_UVICORN" ]]; then
  if [[ ! -x "$VENV_PY" ]]; then
    if ! python3 -m venv "$VENV_DIR" >/dev/null 2>&1; then
      rm -rf "$VENV_DIR"
      python3 -m venv --without-pip "$VENV_DIR"
    fi
  fi

  if ! "${VENV_PY}" -m pip --version >/dev/null 2>&1; then
    python3 -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')"
    "${VENV_PY}" /tmp/get-pip.py --no-cache-dir --no-warn-script-location
    rm -f /tmp/get-pip.py
  fi

  "${VENV_PY}" -m pip install --no-cache-dir --prefer-binary --no-compile --no-warn-script-location -r "${ROOT_DIR}/backend/requirements.txt"
fi
