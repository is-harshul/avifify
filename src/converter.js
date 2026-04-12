/**
 * Core AVIF converter: processes files with concurrency control,
 * progress reporting, and detailed result tracking.
 */

import sharp from 'sharp';
import { stat, mkdir, unlink, access } from 'node:fs/promises';
import { dirname, basename, extname, join, relative, resolve } from 'node:path';
import { formatBytes } from './logger.js';

/**
 * @typedef {Object} ConvertResult
 * @property {string}  file         - Original file path
 * @property {string}  output       - Output file path
 * @property {'converted'|'skipped'|'error'} status
 * @property {number}  [inputSize]  - Original file size in bytes
 * @property {number}  [outputSize] - AVIF file size in bytes
 * @property {number}  [savedBytes] - Bytes saved (positive = smaller)
 * @property {string}  [reason]     - Why it was skipped or errored
 * @property {number}  [duration]   - Conversion time in ms
 */

/**
 * Convert a batch of image files to AVIF.
 *
 * @param {string[]} files  - Absolute paths of source images
 * @param {object}   config - Resolved configuration
 * @param {object}   logger - Logger instance
 * @returns {Promise<ConvertResult[]>}
 */
export async function convertBatch(files, config, logger) {
  const results = [];
  const { concurrency } = config;
  let completed = 0;

  // Process files in chunks for controlled concurrency
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map(file => convertSingle(file, config, logger))
    );

    for (const result of chunkResults) {
      const res = result.status === 'fulfilled'
        ? result.value
        : { file: 'unknown', status: 'error', reason: result.reason?.message ?? String(result.reason) };

      results.push(res);
      completed++;
      logger.progress(completed, files.length, res.file);
    }
  }

  return results;
}

/**
 * Convert a single image file to AVIF.
 *
 * @param {string} filePath - Absolute path to the source image
 * @param {object} config   - Resolved configuration
 * @param {object} logger   - Logger instance
 * @returns {Promise<ConvertResult>}
 */
export async function convertSingle(filePath, config, logger) {
  const start = Date.now();
  const cwd = process.cwd();
  const relPath = relative(cwd, filePath);

  try {
    // Determine output path
    const outputPath = getOutputPath(filePath, config);
    const relOutput = relative(cwd, outputPath);

    // Check if output already exists
    if (config.skipExisting) {
      try {
        await access(outputPath);
        logger.verbose(`Skipped (exists): ${relPath}`);
        return { file: relPath, output: relOutput, status: 'skipped', reason: 'already exists' };
      } catch {
        // File doesn't exist, proceed
      }
    }

    // Get input file size
    const inputStat = await stat(filePath);
    const inputSize = inputStat.size;

    // Dry run — report what would happen
    if (config.dryRun) {
      logger.info(`[dry-run] Would convert: ${relPath} → ${relOutput}`);
      return { file: relPath, output: relOutput, status: 'skipped', reason: 'dry run', inputSize };
    }

    // Ensure output directory exists
    const outDir = dirname(outputPath);
    await mkdir(outDir, { recursive: true });

    // Build the sharp pipeline
    let pipeline = sharp(filePath, {
      failOn: 'none',       // Don't fail on minor issues
      sequentialRead: true,  // Better memory usage for large images
    });

    // Optionally get metadata for logging
    const metadata = logger.isVerbose ? await pipeline.metadata() : null;

    // Convert to AVIF
    pipeline = pipeline.avif({
      quality: config.lossless ? 100 : config.quality,
      effort: config.effort,
      lossless: config.lossless,
      chromaSubsampling: config.chromaSubsampling,
    });

    // Write output
    const outputInfo = await pipeline.toFile(outputPath);
    const outputSize = outputInfo.size;
    const savedBytes = inputSize - outputSize;
    const duration = Date.now() - start;

    // Skip if AVIF is larger and config says so
    if (config.skipLarger && outputSize >= inputSize) {
      // Remove the larger AVIF file
      try { await unlink(outputPath); } catch { /* ignore */ }
      logger.verbose(`Skipped (AVIF larger): ${relPath} — ${formatBytes(inputSize)} → ${formatBytes(outputSize)}`);
      return {
        file: relPath,
        output: relOutput,
        status: 'skipped',
        reason: 'avif is larger',
        inputSize,
        outputSize,
        savedBytes,
        duration,
      };
    }

    // Delete original if not preserving
    if (!config.preserveOriginal && outputPath !== filePath) {
      try { await unlink(filePath); } catch { /* ignore */ }
    }

    const pct = inputSize > 0 ? Math.round((1 - outputSize / inputSize) * 100) : 0;
    logger.verbose(
      `Converted: ${relPath} → ${formatBytes(inputSize)} → ${formatBytes(outputSize)} (${pct}% smaller, ${duration}ms)`,
      metadata ? { dimensions: `${metadata.width}×${metadata.height}` } : undefined
    );

    return {
      file: relPath,
      output: relOutput,
      status: 'converted',
      inputSize,
      outputSize,
      savedBytes,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    logger.error(`Failed: ${relPath} — ${err.message}`);
    logger.debug(err.stack);
    return {
      file: relPath,
      output: null,
      status: 'error',
      reason: err.message,
      duration,
    };
  }
}

/**
 * Compute the output .avif path for a given input file.
 */
function getOutputPath(filePath, config) {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = config.outDir
    ? resolve(config.outDir, relative(process.cwd(), dirname(filePath)))
    : dirname(filePath);

  const suffix = config.suffix || '';
  return join(dir, `${base}${suffix}.avif`);
}

export { getOutputPath };
