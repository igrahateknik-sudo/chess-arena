#!/usr/bin/env node
/**
 * Chess Arena — Generate PWA icons from SVG using canvas/sharp
 * Run: node scripts/generate-icons.js
 * Requires: npm install sharp  (one-time)
 */

const path = require('path');
const fs = require('fs');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SRC = path.join(__dirname, '../chess-app/public/icons/icon-base.svg');
const DEST = path.join(__dirname, '../chess-app/public/icons');

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp not installed. Run: npm install sharp');
    console.error('Then re-run: node scripts/generate-icons.js');
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(SRC);
  console.log('Generating PWA icons...');

  for (const size of SIZES) {
    const out = path.join(DEST, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ✓ icon-${size}.png`);
  }

  console.log('\nDone! All icons in chess-app/public/icons/');
}

main().catch(console.error);
