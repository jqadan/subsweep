// Renders the source images @capacitor/assets needs (assets/*.png) from the
// brand SVG, so app icons and splash screens come from the same artwork as
// the website. Run via `npm run assets`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.resolve(here, '..', '..', 'public', 'brand', 'icon.svg'));
const outDir = path.resolve(here, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const BRAND = '#5b3df5';
const LIGHT_BG = '#f6f7fb';
const DARK_BG = '#1b2233';

// The artwork without its rounded purple tile: Android draws the adaptive
// icon's own background behind it.
const glyphSvg = Buffer.from(svg.toString('utf8').replace(/<rect[^>]*\/>\s*/, ''));

const icon = (size, source = svg) => sharp(source, { density: 300 }).resize(size, size).png().toBuffer();

async function canvas(size, background, glyphSize, source = svg) {
  const glyph = await icon(glyphSize, source);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png();
}

// Full-bleed icon (iOS, and the Android legacy icon).
await sharp(svg, { density: 300 }).resize(1024, 1024).png().toFile(path.join(outDir, 'icon-only.png'));
// Android adaptive icon: the glyph sits inside the safe zone on a solid background.
await (await canvas(1024, { r: 0, g: 0, b: 0, alpha: 0 }, 720, glyphSvg)).toFile(path.join(outDir, 'icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BRAND } }).png()
  .toFile(path.join(outDir, 'icon-background.png'));
// Splash screens: icon centred on the site's page background.
await (await canvas(2732, LIGHT_BG, 512)).toFile(path.join(outDir, 'splash.png'));
await (await canvas(2732, DARK_BG, 512)).toFile(path.join(outDir, 'splash-dark.png'));

console.log(`make-assets: wrote ${fs.readdirSync(outDir).length} files to ${path.relative(process.cwd(), outDir)}`);
