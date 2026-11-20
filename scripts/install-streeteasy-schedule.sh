#!/usr/bin/env bash
# Installs (or removes) a daily StreetEasy sync on this computer.
#   scripts/install-streeteasy-schedule.sh --origin https://apartment-search.<subdomain>.workers.dev
#   scripts/install-streeteasy-schedule.sh --uninstall
# macOS uses launchd (a missed run happens when the Mac wakes); Linux uses cron.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/apartment-search"
LABEL="com.apartment-search.streeteasy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
KEYCHAIN_SERVICE="apartment-search-app-token"
HOUR="${SYNC_HOUR:-6}"
MINUTE="${SYNC_MINUTE:-17}"
ORIGIN=""
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --origin=*) ORIGIN="${arg#--origin=}" ;;
    --uninstall) UNINSTALL=1 ;;
    *) if [[ -z "$ORIGIN" && "$arg" == https://* ]]; then ORIGIN="$arg"; elif [[ "$arg" != --origin ]]; then echo "Unknown argument: $arg" >&2; exit 2; fi ;;
  esac
done

if [[ "$UNINSTALL" == 1 ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    security delete-generic-password -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
  else
    (crontab -l 2>/dev/null | grep -v "streeteasy-daily.sh") | crontab -
    rm -f "$CONFIG_DIR/token"
  fi
  echo "Removed the daily StreetEasy sync."
  exit 0
fi

[[ -n "$ORIGIN" ]] || { echo "Pass --origin=https://<your apartment-search Worker URL>" >&2; exit 2; }
[[ "$ORIGIN" == https://* ]] || { echo "The origin must start with https://" >&2; exit 2; }
BUN="$(command -v bun || true)"
[[ -n "$BUN" ]] || { echo "Install Bun 1.4.4 first: https://bun.sh" >&2; exit 1; }

(cd "$REPO" && "$BUN" install --frozen-lockfile >/dev/null)

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
printf '%s' "${ORIGIN%/}" > "$CONFIG_DIR/origin"

echo "Paste the app access token (APP_ACCESS_TOKEN on the Worker) when asked."
if [[ "$(uname)" == "Darwin" ]]; then
  # -w last makes security prompt, so the token never appears in a process list.
  security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" -w
  LOG="$HOME/Library/Logs/apartment-search-streeteasy.log"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO/scripts/streeteasy-daily.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>BUN</key><string>$BUN</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed. StreetEasy syncs daily at $HOUR:$(printf %02d "$MINUTE"). Log: $LOG"
  echo "Run it now with: launchctl kickstart gui/$(id -u)/$LABEL"
else
  read -r -s -p "Token: " TOKEN
  echo
  [[ -n "$TOKEN" ]] || { echo "No token entered." >&2; exit 1; }
  umask 077
  printf '%s' "$TOKEN" > "$CONFIG_DIR/token"
  LOG="$CONFIG_DIR/streeteasy.log"
  LINE="$MINUTE $HOUR * * * BUN=$BUN /bin/bash $REPO/scripts/streeteasy-daily.sh >> $LOG 2>&1"
  (crontab -l 2>/dev/null | grep -v "streeteasy-daily.sh"; echo "$LINE") | crontab -
  echo "Installed. StreetEasy syncs daily at $HOUR:$(printf %02d "$MINUTE"). Log: $LOG"
  echo "Run it now with: $REPO/scripts/streeteasy-daily.sh"
fi
