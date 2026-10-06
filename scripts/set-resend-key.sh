#!/usr/bin/env bash
# Replaces RESEND_API_KEY in ~/redbull-secrets.env with a key you paste.
# The key is read without echo, never printed, and never passed as an argument.
# Every other line in the file is kept as it is.
set -euo pipefail
FILE="${SECRETS:-$HOME/redbull-secrets.env}"

[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
read -rsp "Paste the new Resend API key, then press Enter: " KEY
echo
KEY="${KEY//[[:space:]]/}"
[ -n "$KEY" ] || { echo "Empty, nothing changed." >&2; exit 1; }
case "$KEY" in re_*) ;; *) echo "Warning: Resend keys normally start with re_" >&2 ;; esac

umask 077
tmp=$(mktemp "$FILE.XXXXXX")
trap 'rm -f "$tmp"' EXIT
K="$KEY" awk '
  BEGIN { key = ENVIRON["K"]; done = 0 }
  /^[[:space:]]*(export[[:space:]]+)?RESEND_API_KEY[[:space:]]*=/ {
    prefix = ($0 ~ /^[[:space:]]*export[[:space:]]/) ? "export " : ""
    print prefix "RESEND_API_KEY=" key
    done = 1
    next
  }
  { print }
  END { if (!done) print "RESEND_API_KEY=" key }
' "$FILE" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$FILE"
trap - EXIT
unset KEY K
echo "Updated RESEND_API_KEY in $FILE (other lines unchanged)."
