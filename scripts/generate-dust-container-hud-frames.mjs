#!/usr/bin/env node
/**
 * Generates small, alpha-weighted box-downsampled HUD versions of the dust
 * container sprites (animation frames + empty/full states).
 *
 * The source art is 30x33px. Scaling that directly at runtime with
 * nearest-neighbor sampling to a tiny HUD box (e.g. 10x10) can land exactly
 * on the sprite's dark outline column on every sample, producing a solid
 * vertical line artifact. Pre-baking a proper alpha-weighted box average
 * offline avoids that: each output pixel is a weighted blend of the source
 * pixels it covers, weighted by source alpha so transparent pixels (which
 * may carry black RGB) don't darken the result.
 *
 * Run with: node scripts/generate-dust-container-hud-frames.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgba } from './sprite-atlas-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'ASSETS', 'SPRITES', 'DUST', 'DustContainer');
const ANIM_SRC_DIR = path.join(SRC_DIR, 'Animation');
const OUT_DIR = path.join(SRC_DIR, 'AnimationHud');

const HUD_TARGET_WIDTH = 10;

function downsampleAlphaWeighted(src, dstWidth, dstHeight) {
  const { width: sw, height: sh, data } = src;
  const out = Buffer.alloc(dstWidth * dstHeight * 4);
  for (let dy = 0; dy < dstHeight; dy++) {
    const sy0 = (dy * sh) / dstHeight;
    const sy1 = ((dy + 1) * sh) / dstHeight;
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx0 = (dx * sw) / dstWidth;
      const sx1 = ((dx + 1) * sw) / dstWidth;

      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, coverage = 0;
      const yStart = Math.floor(sy0);
      const yEnd = Math.min(sh, Math.ceil(sy1));
      const xStart = Math.floor(sx0);
      const xEnd = Math.min(sw, Math.ceil(sx1));

      for (let sy = yStart; sy < yEnd; sy++) {
        const yWeight = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = xStart; sx < xEnd; sx++) {
          const xWeight = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const weight = yWeight * xWeight;
          const si = (sy * sw + sx) * 4;
          const a = data[si + 3] / 255;
          // Weight color contribution by both pixel-coverage and source alpha
          // so fully-transparent (possibly black) pixels don't darken edges.
          rSum += data[si] * a * weight;
          gSum += data[si + 1] * a * weight;
          bSum += data[si + 2] * a * weight;
          aSum += a * weight;
          coverage += weight;
        }
      }

      const di = (dy * dstWidth + dx) * 4;
      if (aSum > 1e-6) {
        out[di] = Math.round(rSum / aSum);
        out[di + 1] = Math.round(gSum / aSum);
        out[di + 2] = Math.round(bSum / aSum);
      }
      out[di + 3] = coverage > 0 ? Math.round((aSum / coverage) * 255) : 0;
    }
  }
  return out;
}

async function processFile(srcPath, outPath) {
  const buf = await fs.readFile(srcPath);
  const decoded = decodePng(buf);
  const dstWidth = HUD_TARGET_WIDTH;
  const dstHeight = Math.round((HUD_TARGET_WIDTH * decoded.height) / decoded.width);
  const rgba = downsampleAlphaWeighted(decoded, dstWidth, dstHeight);
  const png = encodePngRgba(dstWidth, dstHeight, rgba);
  await fs.writeFile(outPath, png);
  console.log(`  ${path.relative(ROOT, srcPath)} (${decoded.width}x${decoded.height}) -> ${path.relative(ROOT, outPath)} (${dstWidth}x${dstHeight})`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log('Generating HUD-scaled dust container frames...');

  const animFiles = await fs.readdir(ANIM_SRC_DIR);
  for (const file of animFiles.filter((f) => f.endsWith('.png'))) {
    await processFile(path.join(ANIM_SRC_DIR, file), path.join(OUT_DIR, file));
  }

  await processFile(path.join(SRC_DIR, 'DustContainerFrame_Empty.png'), path.join(SRC_DIR, 'DustContainerFrame_Empty_Hud.png'));
  await processFile(path.join(SRC_DIR, 'DustContainerFrame_Full.png'), path.join(SRC_DIR, 'DustContainerFrame_Full_Hud.png'));

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
