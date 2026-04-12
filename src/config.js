/**
 * Configuration resolution with layered precedence:
 *   defaults < .avififyrc.json < package.json["avifify"] < CLI args
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const DEFAULTS = {
  // Paths / Globs
  include: ['**/*.{jpg,jpeg,png,webp,tiff,tif,gif,bmp,heif,heic}'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/vendor/**'],

  // Output
  outDir: null,          // null = convert in-place (same directory)
  suffix: '',            // e.g. '.min' → photo.min.avif  (empty = photo.avif)
  preserveOriginal: false,

  // AVIF encoding options
  quality: 50,           // 1-100, lower = smaller. 50 is a solid default
  speed: 5,              // 0-8, lower = slower but better compression
  effort: 5,             // alias for speed (sharp uses this)
  lossless: false,
  chromaSubsampling: '4:2:0', // '4:2:0' or '4:4:4'

  // Behavior
  concurrency: null,     // null = auto (CPU count)
  skipLarger: true,      // skip if AVIF is bigger than the original
  skipExisting: false,   // skip if .avif already exists
  dryRun: false,
  json: false,
  verbose: false,
  debug: false,
  silent: false,

  // Git hook specific
  stagedOnly: false,     // only process git-staged files
};

const RC_FILENAMES = ['.avififyrc', '.avififyrc.json'];

/**
 * Walk up from `cwd` to find the nearest config file.
 */
async function findRcFile(cwd) {
  let dir = resolve(cwd);
  const root = dirname(dir) === dir ? dir : undefined;

  while (true) {
    for (const name of RC_FILENAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

async function loadJsonFile(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the final config object.
 *
 * @param {object} cliArgs - Parsed CLI arguments (only defined keys)
 * @param {string} cwd     - Working directory
 * @returns {Promise<object>} Merged configuration
 */
export async function resolveConfig(cliArgs = {}, cwd = process.cwd()) {
  // Layer 1: RC file
  const rcPath = await findRcFile(cwd);
  const rcConfig = rcPath ? (await loadJsonFile(rcPath)) ?? {} : {};

  // Layer 2: package.json "avifify" key
  const pkgPath = resolve(cwd, 'package.json');
  const pkg = await loadJsonFile(pkgPath);
  const pkgConfig = pkg?.avifify ?? {};

  // Merge with precedence
  const merged = { ...DEFAULTS, ...rcConfig, ...pkgConfig, ...stripUndefined(cliArgs) };

  // Normalize
  merged.quality = clamp(merged.quality, 1, 100);
  merged.speed = clamp(merged.speed, 0, 8);
  merged.effort = merged.speed; // sharp calls it `effort`

  if (merged.concurrency === null) {
    const { availableParallelism } = await import('node:os');
    merged.concurrency = Math.max(1, (availableParallelism?.() ?? 4) - 1);
  }

  if (merged.outDir) {
    merged.outDir = resolve(cwd, merged.outDir);
  }

  // Determine log level
  if (merged.silent) merged.logLevel = 'silent';
  else if (merged.debug) merged.logLevel = 'debug';
  else if (merged.verbose) merged.logLevel = 'verbose';
  else merged.logLevel = 'info';

  // Source info for debugging
  merged._sources = {
    rc: rcPath ?? null,
    pkg: pkg?.avifify ? pkgPath : null,
  };

  return merged;
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, Number(val) || min));
}

export { DEFAULTS };
