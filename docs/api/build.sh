#!/usr/bin/env bash
# Rebuilds the PDFs from the HTML sources. Needs Google Chrome. Run from anywhere: docs/api/build.sh
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for doc in integration-guide endpoint-reference; do
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$doc.pdf" "file://$PWD/$doc.html" >/dev/null 2>&1
  echo "built $doc.pdf"
done
