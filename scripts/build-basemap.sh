#!/usr/bin/env bash
# Phase 1a — basemap tiles (monthly cadence).
# Download Sweden extract -> clip to bbox with osmium -> Planetiler pmtiles.
# Fails loudly and leaves any previously-produced pmtiles untouched on error.
set -euo pipefail
cd "$(dirname "$0")/.."

CACHE=data/cache
SRC="$CACHE/sweden-latest.osm.pbf"
CLIP="$CACHE/malmo.osm.pbf"
OUT="$CACHE/malmo.pmtiles"
JAR=tools/planetiler.jar
GEOFABRIK="https://download.geofabrik.de/europe/sweden-latest.osm.pbf"

mkdir -p "$CACHE" tools

# Read bbox from config (no jq dependency).
read -r WEST SOUTH EAST NORTH < <(node -e '
  const b=require("./config/bbox.json").bbox;
  process.stdout.write(`${b.west} ${b.south} ${b.east} ${b.north}`);')
echo "bbox: W$WEST S$SOUTH E$EAST N$NORTH"

# Java (Homebrew keg-only openjdk@21 if present).
if [ -x /opt/homebrew/opt/openjdk@21/bin/java ]; then
  export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
fi
command -v java >/dev/null || { echo "FATAL: java not found (need 21+)"; exit 1; }
command -v osmium >/dev/null || { echo "FATAL: osmium not found"; exit 1; }

# planetiler.jar (fetch once).
if [ ! -f "$JAR" ]; then
  echo "downloading planetiler.jar ..."
  curl -fSL -o "$JAR.tmp" "https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"
  mv "$JAR.tmp" "$JAR"
fi

# 1. Download Sweden extract (fresh each run; atomic).
echo "downloading Sweden extract (~772 MB) ..."
curl -fSL --retry 3 -o "$SRC.tmp" "$GEOFABRIK"
mv "$SRC.tmp" "$SRC"

# 2. Clip to Malmö bbox.
echo "clipping to bbox ..."
osmium extract -b "$WEST,$SOUTH,$EAST,$NORTH" "$SRC" -o "$CLIP" --overwrite

# 3. Tile with Planetiler (write to temp, then atomic move).
MINZ=$(node -e 'process.stdout.write(String(require("./config/bbox.json").minzoom))')
MAXZ=$(node -e 'process.stdout.write(String(require("./config/bbox.json").maxzoom))')
echo "tiling z$MINZ-$MAXZ ..."
java -Xmx4g -jar "$JAR" \
  --osm-path="$CLIP" \
  --bounds="$WEST,$SOUTH,$EAST,$NORTH" \
  --minzoom="$MINZ" --maxzoom="$MAXZ" --download --force \
  --output="$OUT.tmp"
mv "$OUT.tmp" "$OUT"

SIZE=$(ls -l "$OUT" | awk '{printf "%.1f MB", $5/1024/1024}')
echo "OK: $OUT ($SIZE)"
