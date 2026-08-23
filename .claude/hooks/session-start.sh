#!/bin/bash
# Build the one pipeline artifact a web session can actually produce.
#
# There is nothing to install here — no package manager, no node_modules. What a
# fresh checkout is missing is generated data, and almost all of it is out of
# reach: the pipeline needs osmium, Java and a 772 MB OSM extract, and the hosts
# it downloads from are blocked in this environment.
#
# build/style.json is the exception. It is one fetch of OSM Liberty at a pinned
# commit from raw.githubusercontent.com, which is reachable, and it takes a few
# seconds. Without it test/style.test.mjs and test/blind.test.mjs skip — and
# blind.test.mjs is the one that holds the whole app's load-bearing rule, that a
# round leaves no readable name anywhere on the map. Skipping it silently is
# exactly the failure it exists to catch, so it is worth a few seconds of
# startup to make it run.
#
# Everything else stays skipped, which is correct and says so in its skip reason.
set -euo pipefail

# Local checkouts have the real pipeline; this is only for the web sandbox.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ -f build/style.json ]; then
  echo "session-start: build/style.json already present"
  exit 0
fi

# A failure here must not take the session down with it. Offline, or upstream
# moved, and the tests go back to skipping with a message that explains itself —
# which is where they would have been anyway.
if node scripts/build-style.mjs; then
  echo "session-start: built build/style.json (style + blind tests will run)"
else
  echo "session-start: could not build build/style.json; style/blind tests will skip" >&2
fi
