/**
 * CLI entry point — parses args, resolves config, orchestrates conversion.
 */

import { resolveConfig } from './config.js';
import { scanFiles, getChangedSinceLastPush } from './scanner.js';
import { convertBatch } from './converter.js';
import { createLogger } from './logger.js';
import { installHook, uninstallHook } from './hooks.js';

const VERSION = '1.0.0';

const HELP = `
  avifify v${VERSION}
  Convert images to AVIF — on demand, in CI/CD, or as a git hook.

  USAGE
    avifify [options] [paths...]         Convert matching images to AVIF
    avifify hook install [--hook-type]   Install git hook (default: pre-push)
    avifify hook uninstall               Remove git hook

  PATHS
    Provide files, directories, or glob patterns.
    Defaults to scanning the current directory using include/exclude config.

  OPTIONS
    -q, --quality <n>        AVIF quality 1-100           (default: 50)
    -s, --speed <n>          Encoding speed 0-8            (default: 5)
    --lossless               Enable lossless encoding
    --chroma <mode>          Chroma subsampling 4:2:0|4:4:4 (default: 4:2:0)

    -o, --out-dir <dir>      Output directory (default: in-place)
    --suffix <str>           Add suffix before .avif       (e.g. ".min")
    --preserve               Keep original files            (default: delete)

    --skip-larger            Don't keep AVIF if it's bigger (default: true)
    --no-skip-larger         Always keep the AVIF output
    --skip-existing          Skip if .avif file exists
    --staged-only            Only process git-staged images
    --changed-since-push     Only process images changed since last push

    -c, --concurrency <n>    Parallel conversions           (default: CPU-1)
    -n, --dry-run            Preview changes without writing
    --json                   Output JSON lines (for pipelines)

    -v, --verbose            Show detailed progress
    --debug                  Show everything (very noisy)
    --silent                 Suppress all output

    --hook-type <type>       Hook type: pre-push|pre-commit (default: pre-push)
    -h, --help               Show this help
    --version                Show version

  CONFIG FILES
    .avififyrc or .avififyrc.json in project root:
      { "quality": 40, "include": ["src/images/**"], "preserve": true }

    Or in package.json:
      { "avifify": { "quality": 40 } }

    CLI args override config files. Config files override defaults.

  EXAMPLES
    avifify                         # Convert all images in current dir
    avifify src/assets              # Convert images in specific directory
    avifify "**/*.png"              # Convert only PNGs
    avifify -q 30 --preserve        # Low quality, keep originals
    avifify --dry-run --verbose     # Preview what would happen
    avifify --json | jq             # Pipe JSON output to jq
    avifify hook install            # Install pre-push git hook
    avifify --changed-since-push    # Only convert images changed since last push

  EXIT CODES
    0  All files converted successfully (or nothing to do)
    1  Some files failed to convert
    2  Invalid arguments or configuration error
`;

/**
 * Parse CLI arguments (minimal parser, no dependencies).
 */
function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    // Flags with values
    const withValue = {
      '-q': 'quality', '--quality': 'quality',
      '-s': 'speed', '--speed': 'speed',
      '-o': 'outDir', '--out-dir': 'outDir',
      '-c': 'concurrency', '--concurrency': 'concurrency',
      '--suffix': 'suffix',
      '--chroma': 'chromaSubsampling',
      '--hook-type': 'hookType',
    };

    // Boolean flags
    const booleans = {
      '--lossless': 'lossless',
      '--preserve': 'preserveOriginal',
      '--skip-larger': ['skipLarger', true],
      '--no-skip-larger': ['skipLarger', false],
      '--skip-existing': 'skipExisting',
      '--staged-only': 'stagedOnly',
      '--changed-since-push': 'changedSincePush',
      '-n': 'dryRun', '--dry-run': 'dryRun',
      '--json': 'json',
      '-v': 'verbose', '--verbose': 'verbose',
      '--debug': 'debug',
      '--silent': 'silent',
      '-h': 'help', '--help': 'help',
      '--version': 'version',
    };

    if (withValue[arg]) {
      const key = withValue[arg];
      const val = argv[++i];
      if (val === undefined) {
        console.error(`Missing value for ${arg}`);
        process.exit(2);
      }
      // Convert numeric values
      args[key] = ['quality', 'speed', 'concurrency'].includes(key) ? Number(val) : val;
    } else if (booleans[arg]) {
      const mapping = booleans[arg];
      if (Array.isArray(mapping)) {
        args[mapping[0]] = mapping[1];
      } else {
        args[mapping] = true;
      }
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}\nRun 'avifify --help' for usage.`);
      process.exit(2);
    } else {
      args._.push(arg);
    }

    i++;
  }

  return args;
}

/**
 * Main CLI entry point.
 */
export async function run(argv) {
  const args = parseArgs(argv);

  // Simple flags
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // Sub-commands
  const subcommand = args._[0];
  if (subcommand === 'hook') {
    return handleHookCommand(args);
  }

  // Main conversion flow
  try {
    const config = await resolveConfig(args);
    const logger = createLogger({ level: config.logLevel, json: config.json });

    logger.debug('Resolved config:', config);

    // Discover files
    let files;
    if (config.changedSincePush) {
      logger.info('Scanning for images changed since last push…');
      files = await getChangedSinceLastPush(process.cwd());
    } else {
      logger.info('Scanning for images…');
      files = await scanFiles(config, args._.length > 0 ? args._ : [], process.cwd());
    }

    if (files.length === 0) {
      logger.info('No images found matching the configured patterns.');
      process.exit(0);
    }

    logger.info(`Found ${files.length} image${files.length === 1 ? '' : 's'} to process`);

    if (config.dryRun) {
      logger.info('Dry run — no files will be modified\n');
    }

    // Convert
    const results = await convertBatch(files, config, logger);

    // Summarize
    const summary = results.reduce(
      (acc, r) => {
        acc.total++;
        if (r.status === 'converted') {
          acc.converted++;
          acc.savedBytes += r.savedBytes ?? 0;
        } else if (r.status === 'skipped') {
          acc.skipped++;
        } else {
          acc.errors++;
        }
        return acc;
      },
      { total: 0, converted: 0, skipped: 0, errors: 0, savedBytes: 0 }
    );

    logger.summary(summary);

    // Exit code: 1 if any errors, 0 otherwise
    process.exit(summary.errors > 0 ? 1 : 0);
  } catch (err) {
    const logger = createLogger({ level: 'error', json: args.json });
    logger.error(err.message);
    if (args.debug) logger.error(err.stack);
    process.exit(2);
  }
}

/**
 * Handle `avifify hook install` / `avifify hook uninstall`
 */
async function handleHookCommand(args) {
  const action = args._[1];
  const hookType = args.hookType ?? 'pre-push';
  const logger = createLogger({ level: args.silent ? 'silent' : 'info', json: args.json });

  try {
    if (action === 'install') {
      await installHook({ hookType }, logger);
    } else if (action === 'uninstall') {
      await uninstallHook({ hookType }, logger);
    } else {
      console.error(`Unknown hook action: ${action}\nUsage: avifify hook install|uninstall`);
      process.exit(2);
    }
  } catch (err) {
    logger.error(err.message);
    process.exit(2);
  }
}
