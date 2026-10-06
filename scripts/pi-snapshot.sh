#!/usr/bin/env bash
# Read-only snapshot of what runs on the Pi, for before/after comparison:
#   bash scripts/pi-snapshot.sh > ops/pi-before.txt
set -euo pipefail
PI="${PI:-mypi}"
ssh "$PI" 'bash -s' <<'REMOTE'
echo "## system services (systemctl list-units --type=service)"
systemctl list-units --type=service --all --no-pager --no-legend --plain | awk '{print $1, $3, $4}' | sort
echo
echo "## user services (systemctl --user list-units --type=service)"
systemctl --user list-units --type=service --all --no-pager --no-legend --plain | awk '{print $1, $3, $4}' | sort
echo
echo "## listening TCP (ss -ltn, local addresses)"
ss -ltnH | awk '{print $4}' | sort -u
echo
echo "## ls ~"
ls -1A ~
echo
echo "## crontab -l"
crontab -l 2>&1 || true
echo
echo "## HTTP status"
for port in ${CHECK_PORTS:-}; do  # ports of other local sites to health-check
  printf '127.0.0.1:%s -> %s\n' "$port" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$port/" || true)"
done
REMOTE
