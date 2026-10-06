#!/usr/bin/env bash
# npm run deploy: test, bundle, copy to the Pi, (re)start, health-check.
# On the Pi this writes only ~/redbull-tally, ~/.local/node and
# ~/.config/systemd/user/redbull-tally*. It never uses sudo.
set -euo pipefail
cd "$(dirname "$0")/.."
PI="${PI:-mypi}"
SECRETS="${SECRETS:-$HOME/redbull-secrets.env}"

echo "→ tests"
npm test
echo "→ bundle"
npm run build

echo "→ prepare ~/redbull-tally on $PI"
ssh "$PI" 'mkdir -p ~/redbull-tally/dist ~/redbull-tally/data ~/redbull-tally/backups ~/.config/systemd/user'

# The tunnel points at 8095. If something else already holds it, stop rather than pick another port.
if ssh "$PI" 'ss -ltnH "sport = :8095" | grep -q . && ! systemctl --user is-active -q redbull-tally.service'; then
  echo "✗ 127.0.0.1:8095 is already in use on $PI by something else. Stopping." >&2
  exit 1
fi

echo "→ node"
ssh "$PI" 'bash -s' < scripts/install-node-pi.sh

# Copy ONLY RESEND_API_KEY to the Pi, through stdin, never printed or put in argv.
if ! ssh "$PI" 'test -s ~/redbull-tally/.env'; then
  echo "→ secret (RESEND_API_KEY only)"
  key=""
  if [ -r "$SECRETS" ]; then
    key=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?RESEND_API_KEY[[:space:]]*=[[:space:]]*//p' "$SECRETS" | tail -1 | sed -E "s/^[\"']//; s/[\"'][[:space:]]*\$//")
  fi
  if [ -z "$key" ]; then
    key=$(security find-generic-password -s resend-api-key -w 2>/dev/null || true)
  fi
  if [ -z "$key" ]; then
    echo "✗ No RESEND_API_KEY found in $SECRETS or the Keychain (service resend-api-key)." >&2
    exit 1
  fi
  printf 'RESEND_API_KEY=%s\n' "$key" | ssh "$PI" 'umask 077; cat > ~/redbull-tally/.env; chmod 600 ~/redbull-tally/.env'
  unset key
fi

echo "→ copy dist/ and units"
rsync -a --delete dist/ "$PI:redbull-tally/dist/"
rsync -a deploy/redbull-tally.service deploy/redbull-tally-backup.service deploy/redbull-tally-backup.timer "$PI:.config/systemd/user/"

echo "→ restart"
ssh "$PI" 'systemctl --user daemon-reload \
  && systemctl --user enable -q redbull-tally.service redbull-tally-backup.timer \
  && systemctl --user restart redbull-tally.service \
  && systemctl --user start redbull-tally-backup.timer'

echo "→ health"
ssh "$PI" 'for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8095/healthz >/dev/null 2>&1; then echo "✓ http://127.0.0.1:8095/healthz is 200"; exit 0; fi
  sleep 0.5
done
echo "✗ healthz did not answer" >&2
journalctl --user-unit=redbull-tally.service -n 40 --no-pager >&2
exit 1'
