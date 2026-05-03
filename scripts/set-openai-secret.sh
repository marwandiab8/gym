#!/usr/bin/env bash
# Securely stores OPENAI_API_KEY in Firebase Secret Manager.
# Usage:
#   export OPENAI_API_KEY="sk-..."
#   ./scripts/set-openai-secret.sh
set -euo pipefail

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r -s -p "Enter OPENAI_API_KEY: " OPENAI_API_KEY
  echo
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required." >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
printf '%s' "$OPENAI_API_KEY" > "$TMP_FILE"

exec firebase functions:secrets:set OPENAI_API_KEY --data-file="$TMP_FILE" --force
