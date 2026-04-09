#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Chess Arena — Generate PWA Icons from SVG
#  Requires: inkscape OR rsvg-convert OR sharp-cli
#  Usage:    bash scripts/generate-icons.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SRC="chess-app/public/icons/icon-base.svg"
DEST="chess-app/public/icons"
SIZES=(72 96 128 144 152 192 384 512)

echo "🎨 Generating PWA icons from $SRC..."

if command -v inkscape &>/dev/null; then
  for SIZE in "${SIZES[@]}"; do
    inkscape "$SRC" --export-png="$DEST/icon-${SIZE}.png" --export-width=$SIZE --export-height=$SIZE
    echo "  ✓ icon-${SIZE}.png"
  done
elif command -v rsvg-convert &>/dev/null; then
  for SIZE in "${SIZES[@]}"; do
    rsvg-convert "$SRC" -w $SIZE -h $SIZE -o "$DEST/icon-${SIZE}.png"
    echo "  ✓ icon-${SIZE}.png"
  done
elif command -v npx &>/dev/null; then
  echo "  Using sharp-cli (npm)..."
  npx @squoosh/cli --resize '{"width":512}' --oxipng '{}' -d "$DEST" "$SRC" 2>/dev/null || true
  for SIZE in "${SIZES[@]}"; do
    npx sharp-cli -i "$SRC" -o "$DEST/icon-${SIZE}.png" resize $SIZE $SIZE 2>/dev/null \
      || echo "  ⚠ sharp-cli not installed: npm i -g sharp-cli"
  done
else
  echo "  ⚠ No SVG converter found."
  echo "  Options:"
  echo "    macOS:   brew install librsvg"
  echo "    Ubuntu:  apt install librsvg2-bin"
  echo "    npm:     npm i -g sharp-cli"
fi

echo ""
echo "✅ Icons generated in $DEST/"
echo "   Next: copy icon-512.png for screenshots/ if needed."
