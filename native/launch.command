#!/bin/sh
# Kept for manual checks. Chrome uses ~/Library/Application Support/LexiLoop/oauth-host.
# Resolve the script directory so the launcher works from any checkout location.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin=${LEXILOOP_NODE:-$(command -v node)}
if [ -z "$node_bin" ]; then
  echo "Node.js 20.3+ not found. Install Node or set LEXILOOP_NODE." >&2
  exit 1
fi
exec "$node_bin" "$here/host.cjs"
