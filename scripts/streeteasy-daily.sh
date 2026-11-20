#!/usr/bin/env bash
# Runs the StreetEasy sync once and uploads the result to the apartment-search Worker.
# Installed as a daily job by scripts/install-streeteasy-schedule.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/apartment-search"
BUN="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"
KEYCHAIN_SERVICE="apartment-search-app-token"

if [[ -z "${APARTMENT_SEARCH_ORIGIN:-}" && -f "$CONFIG_DIR/origin" ]]; then
  APARTMENT_SEARCH_ORIGIN="$(<"$CONFIG_DIR/origin")"
fi
export APARTMENT_SEARCH_ORIGIN

read_token() {
  if [[ "$(uname)" == "Darwin" ]]; then
    security find-generic-password -s "$KEYCHAIN_SERVICE" -w
  elif [[ -f "$CONFIG_DIR/token" ]]; then
    cat "$CONFIG_DIR/token"
  else
    echo "No app access token found. Run scripts/install-streeteasy-schedule.sh first." >&2
    return 1
  fi
}

cd "$REPO"
read_token | "$BUN" scripts/sync-streeteasy.ts "$@"
