#!/usr/bin/env bash
# Runs ON THE PI (piped over ssh by deploy.sh). Installs the official Node 24 LTS
# linux-arm64 build into ~/.local/node. No sudo, no apt. Writes only ~/.local/node
# and a scratch dir under ~/redbull-tally.
set -euo pipefail

DEST="$HOME/.local/node"
TMP="$HOME/redbull-tally/tmp"

if [ -x "$DEST/bin/node" ] && "$DEST/bin/node" --version | grep -q '^v24\.'; then
  echo "node: $("$DEST/bin/node" --version) already in $DEST"
  exit 0
fi
if [ -e "$DEST" ] && [ ! -x "$DEST/bin/node" ]; then
  echo "node: $DEST exists but is not a Node install; refusing to touch it" >&2
  exit 1
fi

# index.json is newest-first; the newest v24.x is the current Node 24 LTS.
VERSION=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v24\.[0-9]*\.[0-9]*"' | head -1 | cut -d'"' -f4)
[ -n "$VERSION" ] || { echo "node: could not find a v24 release" >&2; exit 1; }
FILE="node-$VERSION-linux-arm64.tar.gz"
echo "node: installing $VERSION into $DEST"

mkdir -p "$TMP"
curl -fsSLo "$TMP/$FILE" "https://nodejs.org/dist/$VERSION/$FILE"
curl -fsSLo "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/$VERSION/SHASUMS256.txt"
(cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)

rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$TMP/$FILE" -C "$DEST" --strip-components=1
rm -rf "$TMP"
echo "node: $("$DEST/bin/node" --version) installed"
