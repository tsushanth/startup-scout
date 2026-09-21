#!/bin/bash
# Idempotent installer, run ON the Mac mini.
set -euo pipefail
BASE="$HOME/.startup-scout"; ROOT="$HOME/startup-scout-harness"; LABEL=com.sushanth.startup-scout
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
mkdir -p "$BASE/logs" "$ROOT"
[ -d "$ROOT/repo/.git" ] || git clone -q --depth 1 https://github.com/tsushanth/startup-scout.git "$ROOT/repo"
cd "$ROOT/repo"
git pull -q --ff-only
npm install --no-audit --no-fund --loglevel=error
[ -f "$BASE/env" ] || { echo "missing $BASE/env (see README.md)"; exit 1; }
chmod 600 "$BASE/env"
sed "s|__HOME__|$HOME|g" harness/com.sushanth.startup-scout.plist.template > "$HOME/Library/LaunchAgents/$LABEL.plist"
U=$(id -u); launchctl bootout gui/$U/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$U "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "installed and loaded $LABEL (daily 08:30 local)"
