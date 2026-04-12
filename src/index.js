/**
 * avifify — Programmatic API
 *
 * Usage:
 *   import { avifify, convertFile } from 'avifify';
 *
 *   // Convert all images in a directory
 *   const results = await avifify({ quality: 40, include: ['src/**'] });
 *
 *   // Convert a single file
 *   const result = await convertFile('photo.jpg', { quality: 50 });
 */

import { resolveConfig } from './config.js';
import { scanFiles } from './scanner.js';
import { convertBatch, convertSingle, getOutputPath } from './converter.js';
import { createLogger } from './logger.js';
import { installHook, uninstallHook } from './hooks.js';

/**
 * Convert images to AVIF.
 *
 * @param {object}   [options]         - Override any config option
 * @param {string[]} [options.paths]   - Explicit file/glob paths to process
 * @param {string}   [options.cwd]     - Working directory (default: process.cwd())
 * @returns {Promise<import('./converter.js').ConvertResult[]>}
 */
export async function avifify(options = {}) {
  const { paths = [], cwd = process.cwd(), ...rest } = options;
  const config = await resolveConfig({ ...rest, silent: rest.silent ?? true }, cwd);
  const logger = createLogger({ level: config.logLevel, json: config.json });

  const files = await scanFiles(config, paths, cwd);
  if (files.length === 0) return [];

  return convertBatch(files, config, logger);
}

/**
 * Convert a single file to AVIF.
 *
 * @param {string}  filePath  - Path to the source image
 * @param {object}  [options] - Override any config option
 * @returns {Promise<import('./converter.js').ConvertResult>}
 */
export async function convertFile(filePath, options = {}) {
  const config = await resolveConfig({ ...options, silent: options.silent ?? true });
  const logger = createLogger({ level: 'silent' });
  return convertSingle(filePath, config, logger);
}

export { installHook, uninstallHook, getOutputPath, resolveConfig };
