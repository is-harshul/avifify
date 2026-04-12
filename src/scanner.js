/**
 * File discovery: glob-based scanning or git-staged file detection.
 */

import fg from 'fast-glob';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, extname } from 'node:path';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif',
  '.gif', '.bmp', '.heif', '.heic',
]);

/**
 * Find image files matching the config patterns.
 *
 * @param {object} config - Resolved config
 * @param {string[]} explicitPaths - Explicit file/dir paths from CLI positional args
 * @param {string} cwd - Working directory
 * @returns {Promise<string[]>} Absolute paths of image files
 */
export async function scanFiles(config, explicitPaths = [], cwd = process.cwd()) {
  // Mode 1: git-staged files only (for pre-push hook)
  if (config.stagedOnly) {
    return getStagedImages(cwd);
  }

  // Mode 2: explicit paths provided
  if (explicitPaths.length > 0) {
    const { statSync } = await import('node:fs');
    const patterns = explicitPaths.map(p => {
      // If it looks like a glob, use as-is
      if (p.includes('*') || p.includes('{')) return p;
      // If it's a directory, append recursive glob
      try {
        if (statSync(resolve(cwd, p)).isDirectory()) return `${p}/**/*`;
      } catch { /* not a dir, treat as file path */ }
      return p;
    });

    const files = await fg(patterns, {
      cwd,
      absolute: true,
      onlyFiles: true,
      ignore: config.exclude,
      followSymbolicLinks: false,
    });

    return files.filter(f => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()));
  }

  // Mode 3: scan using include/exclude globs
  const files = await fg(config.include, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: config.exclude,
    followSymbolicLinks: false,
    dot: false,
  });

  return files.filter(f => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()));
}

/**
 * Get image files staged in git (for hook usage).
 */
async function getStagedImages(cwd) {
  try {
    // Get files staged for commit (including ones that are added/modified)
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      { cwd, maxBuffer: 10 * 1024 * 1024 }
    );

    return stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f && IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
      .map(f => resolve(cwd, f));
  } catch (err) {
    // Not a git repo or git not available
    throw new Error(`Failed to get staged files: ${err.message}`);
  }
}

/**
 * Get image files changed since the last push (for pre-push hook).
 */
export async function getChangedSinceLastPush(cwd) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', '@{push}..HEAD', '--diff-filter=ACMR'],
      { cwd, maxBuffer: 10 * 1024 * 1024 }
    );

    return stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f && IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
      .map(f => resolve(cwd, f));
  } catch {
    // Fallback: if no upstream, scan all tracked images
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--cached'],
        { cwd, maxBuffer: 10 * 1024 * 1024 }
      );

      return stdout
        .split('\n')
        .map(f => f.trim())
        .filter(f => f && IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
        .map(f => resolve(cwd, f));
    } catch (err) {
      throw new Error(`Failed to list git files: ${err.message}`);
    }
  }
}

export { IMAGE_EXTENSIONS };
