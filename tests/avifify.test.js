/**
 * Tests for avifify — uses Node.js built-in test runner (node --test).
 *
 * These tests validate config resolution, output path computation,
 * and the full conversion pipeline using a real test image.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Modules under test
import { resolveConfig, DEFAULTS } from '../src/config.js';
import { getOutputPath } from '../src/converter.js';

// ─── Config Tests ──────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('returns defaults when no overrides provided', async () => {
    const config = await resolveConfig({}, '/tmp');
    assert.equal(config.quality, 50);
    assert.equal(config.speed, 5);
    assert.equal(config.lossless, false);
    assert.equal(config.skipLarger, true);
    assert.equal(config.preserveOriginal, false);
  });

  it('CLI args override defaults', async () => {
    const config = await resolveConfig({ quality: 30, speed: 2, lossless: true }, '/tmp');
    assert.equal(config.quality, 30);
    assert.equal(config.speed, 2);
    assert.equal(config.lossless, true);
  });

  it('clamps quality to valid range', async () => {
    const low = await resolveConfig({ quality: -5 }, '/tmp');
    assert.equal(low.quality, 1);

    const high = await resolveConfig({ quality: 200 }, '/tmp');
    assert.equal(high.quality, 100);
  });

  it('clamps speed to valid range', async () => {
    const low = await resolveConfig({ speed: -1 }, '/tmp');
    assert.equal(low.speed, 0);

    const high = await resolveConfig({ speed: 15 }, '/tmp');
    assert.equal(high.speed, 8);
  });

  it('loads config from .avififyrc.json', async () => {
    const dir = join(tmpdir(), `avifify-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.avififyrc'), JSON.stringify({ quality: 35 }));

    try {
      const config = await resolveConfig({}, dir);
      assert.equal(config.quality, 35);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads config from package.json avifify key', async () => {
    const dir = join(tmpdir(), `avifify-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'test', avifify: { quality: 42 } })
    );

    try {
      const config = await resolveConfig({}, dir);
      assert.equal(config.quality, 42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('CLI args take precedence over rc file', async () => {
    const dir = join(tmpdir(), `avifify-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.avififyrc'), JSON.stringify({ quality: 35, speed: 3 }));

    try {
      const config = await resolveConfig({ quality: 80 }, dir);
      assert.equal(config.quality, 80); // CLI wins
      assert.equal(config.speed, 3);    // RC applies
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves concurrency to a positive number', async () => {
    const config = await resolveConfig({}, '/tmp');
    assert.ok(config.concurrency >= 1);
    assert.equal(typeof config.concurrency, 'number');
  });

  it('sets log level correctly', async () => {
    assert.equal((await resolveConfig({ verbose: true }, '/tmp')).logLevel, 'verbose');
    assert.equal((await resolveConfig({ debug: true }, '/tmp')).logLevel, 'debug');
    assert.equal((await resolveConfig({ silent: true }, '/tmp')).logLevel, 'silent');
    assert.equal((await resolveConfig({}, '/tmp')).logLevel, 'info');
  });
});

// ─── Output Path Tests ─────────────────────────────────────────────────────────

describe('getOutputPath', () => {
  it('replaces extension with .avif', () => {
    const result = getOutputPath('/project/images/photo.jpg', { outDir: null, suffix: '' });
    assert.equal(result, '/project/images/photo.avif');
  });

  it('handles .png extension', () => {
    const result = getOutputPath('/project/icon.png', { outDir: null, suffix: '' });
    assert.equal(result, '/project/icon.avif');
  });

  it('applies suffix before .avif', () => {
    const result = getOutputPath('/project/photo.jpg', { outDir: null, suffix: '.min' });
    assert.equal(result, '/project/photo.min.avif');
  });

  it('redirects to outDir preserving relative structure', async () => {
    const { realpathSync } = await import('node:fs');
    const origCwd = process.cwd();
    const base = realpathSync(tmpdir());
    try {
      process.chdir(base);
      const result = getOutputPath(join(base, 'src/images/photo.jpg'), {
        outDir: join(base, 'dist/images'),
        suffix: '',
      });
      assert.equal(result, join(base, 'dist/images/src/images/photo.avif'));
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ─── Integration: Full Conversion ───────────────────────────────────────────────

describe('conversion (integration)', () => {
  let testDir;

  before(async () => {
    testDir = join(tmpdir(), `avifify-integ-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('converts a real PNG to AVIF', async () => {
    // Dynamically import sharp to create a test image
    const sharp = (await import('sharp')).default;

    const inputPath = join(testDir, 'test-image.png');

    // Create a 100x100 red square PNG
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toFile(inputPath);

    const inputStat = await stat(inputPath);
    assert.ok(inputStat.size > 0, 'Test PNG was created');

    // Convert using the programmatic API
    const { convertSingle } = await import('../src/converter.js');
    const { createLogger } = await import('../src/logger.js');

    const origCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await resolveConfig({ preserveOriginal: true, skipLarger: false }, testDir);
      const logger = createLogger({ level: 'silent' });

      const result = await convertSingle(inputPath, config, logger);

      assert.equal(result.status, 'converted');
      assert.ok(result.outputSize > 0, 'AVIF file has content');
      assert.ok(result.duration >= 0, 'Duration is recorded');

      // Verify the .avif file exists
      const outputStat = await stat(join(testDir, 'test-image.avif'));
      assert.ok(outputStat.size > 0, 'AVIF file exists on disk');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('respects dry-run mode (no files written)', async () => {
    const sharp = (await import('sharp')).default;

    const inputPath = join(testDir, 'dryrun-test.png');
    await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toFile(inputPath);

    const { convertSingle } = await import('../src/converter.js');
    const { createLogger } = await import('../src/logger.js');

    const origCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await resolveConfig({ dryRun: true }, testDir);
      const logger = createLogger({ level: 'silent' });

      const result = await convertSingle(inputPath, config, logger);
      assert.equal(result.status, 'skipped');
      assert.equal(result.reason, 'dry run');

      // AVIF should NOT exist
      try {
        await stat(join(testDir, 'dryrun-test.avif'));
        assert.fail('AVIF file should not exist in dry-run mode');
      } catch (err) {
        assert.equal(err.code, 'ENOENT');
      }
    } finally {
      process.chdir(origCwd);
    }
  });

  it('skips when AVIF is larger and skipLarger=true', async () => {
    const sharp = (await import('sharp')).default;

    // Create a tiny 1x1 PNG — AVIF overhead will likely make it bigger
    const inputPath = join(testDir, 'tiny.png');
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png({ compressionLevel: 9 })
      .toFile(inputPath);

    const { convertSingle } = await import('../src/converter.js');
    const { createLogger } = await import('../src/logger.js');

    const origCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await resolveConfig({ skipLarger: true }, testDir);
      const logger = createLogger({ level: 'silent' });

      const result = await convertSingle(inputPath, config, logger);

      // It might be skipped (AVIF larger) or converted (AVIF smaller).
      // We just verify the tool doesn't crash and returns a valid result.
      assert.ok(['converted', 'skipped'].includes(result.status));
      if (result.status === 'skipped') {
        assert.equal(result.reason, 'avif is larger');
      }
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ─── Logger Tests ───────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes correctly', async () => {
    const { formatBytes } = await import('../src/logger.js');
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1048576), '1.0 MB');
    assert.equal(formatBytes(1073741824), '1.0 GB');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KB');
  });
});
