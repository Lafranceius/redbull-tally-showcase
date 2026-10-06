#!/usr/bin/env bash
# npm run members -- emails.txt
# Replaces the allowlist on the Pi with the emails in the file (one per line, # comments ok).
# Users no longer on the list are deactivated and logged out. The admin email is always kept.
set -euo pipefail
FILE="${1:?Usage: npm run members -- emails.txt}"
PI="${PI:-mypi}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

rsync -a "$FILE" "$PI:redbull-tally/data/members-import.txt"
ssh "$PI" '~/.local/node/bin/node ~/redbull-tally/dist/cli.js members ~/redbull-tally/data/members-import.txt; rc=$?; rm -f ~/redbull-tally/data/members-import.txt; exit $rc'
