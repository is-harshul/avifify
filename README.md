# avifify

Production-ready CLI tool to convert images to AVIF format. Run on demand, in CI/CD pipelines, or as a git pre-push hook.

AVIF offers **30-60% better compression** than JPEG and **20-40% better** than WebP at equivalent visual quality. This tool makes adoption painless.

## Quick Start

```bash
# Install
npm install avifify --save-dev

# Convert all images in the current directory
npx avifify

# Convert specific paths
npx avifify src/assets "public/images/**/*.png"

# Preview without changing anything
npx avifify --dry-run --verbose

# Install as a git pre-push hook
npx avifify hook install
```

## Features

- **Fast** — parallel conversion using [sharp](https://sharp.pixelplumbing.com/) (libvips)
- **Smart defaults** — quality 50, skips if AVIF is larger, auto-concurrency
- **Git hook ready** — install as `pre-push` or `pre-commit` hook in one command
- **Pipeline friendly** — `--json` output, proper exit codes, non-TTY aware
- **Configurable** — `.avififyrc.json`, `package.json`, or CLI flags
- **Safe** — dry-run mode, skip-larger protection, preserves originals on demand
- **Programmatic API** — import and use in Node.js scripts or build tools

## Supported Input Formats

JPEG, PNG, WebP, TIFF, GIF, BMP, HEIF/HEIC

> SVG is excluded by default (vector format — converting to AVIF is lossy and almost never desirable). You can force it by passing SVG files explicitly.

## CLI Reference

```
avifify [options] [paths...]
```

### Encoding Options

| Flag | Default | Description |
|------|---------|-------------|
| `-q, --quality <n>` | `50` | AVIF quality (1-100, lower = smaller) |
| `-s, --speed <n>` | `5` | Encoding speed (0-8, lower = better compression) |
| `--lossless` | `false` | Lossless encoding |
| `--chroma <mode>` | `4:2:0` | Chroma subsampling (`4:2:0` or `4:4:4`) |

### Output Options

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --out-dir <dir>` | in-place | Write AVIF files to a separate directory |
| `--suffix <str>` | none | Suffix before extension (e.g. `--suffix .min` → `photo.min.avif`) |
| `--preserve` | `false` | Keep original files after conversion |

### Behavior Options

| Flag | Default | Description |
|------|---------|-------------|
| `--skip-larger` | `true` | Don't keep AVIF if it's bigger than the original |
| `--no-skip-larger` | | Always keep AVIF output |
| `--skip-existing` | `false` | Skip conversion if `.avif` already exists |
| `--staged-only` | `false` | Only process git-staged images |
| `--changed-since-push` | `false` | Only process images changed since last push |
| `-c, --concurrency <n>` | CPU-1 | Number of parallel conversions |
| `-n, --dry-run` | `false` | Preview changes without writing files |

### Output Options

| Flag | Description |
|------|-------------|
| `--json` | JSON Lines output (for piping to `jq` etc.) |
| `-v, --verbose` | Detailed per-file progress |
| `--debug` | Everything (very noisy) |
| `--silent` | Suppress all output |

### Hook Commands

```bash
avifify hook install              # Install pre-push hook
avifify hook install --hook-type pre-commit  # Use pre-commit instead
avifify hook uninstall            # Remove the hook
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All files converted (or nothing to do) |
| `1` | Some files failed to convert |
| `2` | Bad arguments or config error |

## Configuration

Config is resolved with this precedence: **CLI flags > `.avififyrc.json` > `package.json` > defaults**

### `.avififyrc.json`

```json
{
  "quality": 40,
  "speed": 4,
  "include": ["src/images/**"],
  "exclude": ["**/thumbnails/**"],
  "preserveOriginal": true,
  "skipLarger": true
}
```

### `package.json`

```json
{
  "avifify": {
    "quality": 40,
    "include": ["assets/**"]
  }
}
```

## Git Hook Integration

### Standalone

```bash
npx avifify hook install
```

This creates a `pre-push` hook that:
1. Scans staged image files
2. Converts them to AVIF
3. Auto-stages the new `.avif` files
4. Blocks the push if conversion fails

### With Husky

If you're already using Husky, `avifify` detects the `.husky/` directory and installs there:

```bash
npx avifify hook install
# Creates .husky/pre-push with avifify block
```

Or add it manually to an existing Husky hook:

```bash
# .husky/pre-push
npx avifify --staged-only
```

### CI/CD Pipeline

```yaml
# GitHub Actions example
- name: Convert images to AVIF
  run: npx avifify --json --verbose
```

```yaml
# GitLab CI example
optimize-images:
  script:
    - npx avifify --json | tee avifify-report.json
  artifacts:
    reports:
      dotenv: avifify-report.json
```

## Programmatic API

```js
import { avifify, convertFile } from 'avifify';

// Batch convert
const results = await avifify({
  quality: 40,
  paths: ['src/images'],
  preserveOriginal: true,
});

console.log(`Converted ${results.filter(r => r.status === 'converted').length} files`);

// Single file
const result = await convertFile('photo.jpg', { quality: 50 });
console.log(result);
// { file: 'photo.jpg', output: 'photo.avif', status: 'converted', savedBytes: 123456, ... }
```

## Why AVIF?

| Format | Lossy Compression | Browser Support (2024) |
|--------|-------------------|----------------------|
| JPEG | Baseline | 100% |
| WebP | ~30% better than JPEG | 97% |
| **AVIF** | **~50% better than JPEG** | **95%+** |

AVIF supports transparency, HDR, wide color gamuts, and both lossy and lossless modes. It's the clear successor for web images.

## Quality Guide

| Quality | Use Case | Typical Savings |
|---------|----------|-----------------|
| 30-40 | Thumbnails, backgrounds | 70-80% smaller |
| 50 | General web images (default) | 50-65% smaller |
| 60-70 | Photography, hero images | 40-55% smaller |
| 80-90 | High-fidelity, print-ready | 20-35% smaller |
| 100 / `--lossless` | Archival, pixel-perfect | 10-30% smaller |

## License

MIT
