/**
 * Logger with TTY-aware formatting.
 * - Interactive terminal: colored, human-readable output
 * - Piped / CI: structured JSON lines (--json) or plain text
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, verbose: 4, debug: 5 };

// ANSI codes — stripped automatically when not a TTY
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

class Logger {
  #level;
  #json;
  #isTTY;
  #startTime;

  constructor({ level = 'info', json = false } = {}) {
    this.#level = LEVELS[level] ?? LEVELS.info;
    this.#json = json;
    this.#isTTY = process.stdout.isTTY && !json;
    this.#startTime = Date.now();
  }

  get isVerbose() {
    return this.#level >= LEVELS.verbose;
  }

  get isDebug() {
    return this.#level >= LEVELS.debug;
  }

  #elapsed() {
    return `${((Date.now() - this.#startTime) / 1000).toFixed(1)}s`;
  }

  #write(level, color, label, message, data) {
    if (LEVELS[level] > this.#level) return;

    if (this.#json) {
      const entry = { level, message, timestamp: new Date().toISOString(), ...data };
      process.stdout.write(JSON.stringify(entry) + '\n');
      return;
    }

    const prefix = this.#isTTY ? `${color}${BOLD}${label}${RESET}` : label;
    const dim = this.#isTTY ? DIM : '';
    const reset = this.#isTTY ? RESET : '';

    let line = `${prefix} ${message}`;
    if (data?.file) line += ` ${dim}${data.file}${reset}`;
    if (data?.saved) line += ` ${dim}(${data.saved})${reset}`;

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(line + '\n');
  }

  error(message, data) { this.#write('error', RED, '✖', message, data); }
  warn(message, data) { this.#write('warn', YELLOW, '⚠', message, data); }
  info(message, data) { this.#write('info', CYAN, '●', message, data); }
  success(message, data) { this.#write('info', GREEN, '✔', message, data); }
  verbose(message, data) { this.#write('verbose', MAGENTA, '…', message, data); }
  debug(message, data) { this.#write('debug', DIM, '⊡', message, data); }

  /** Print a summary table at the end */
  summary({ total, converted, skipped, errors, savedBytes }) {
    if (this.#json) {
      process.stdout.write(JSON.stringify({
        level: 'summary',
        total,
        converted,
        skipped,
        errors,
        savedBytes,
        elapsed: this.#elapsed(),
      }) + '\n');
      return;
    }

    const saved = formatBytes(savedBytes);
    const c = this.#isTTY;
    console.log('');
    console.log(c ? `${BOLD}${GREEN}  avifify complete${RESET}` : '  avifify complete');
    console.log(`  ─────────────────────────────`);
    console.log(`  Files scanned   ${total}`);
    console.log(`  Converted       ${c ? GREEN : ''}${converted}${c ? RESET : ''}`);
    console.log(`  Skipped         ${skipped}`);
    if (errors > 0) {
      console.log(`  Errors          ${c ? RED : ''}${errors}${c ? RESET : ''}`);
    }
    console.log(`  Space saved     ${c ? CYAN : ''}${saved}${c ? RESET : ''}`);
    console.log(`  Elapsed         ${this.#elapsed()}`);
    console.log('');
  }

  /** Inline progress for TTY */
  progress(current, total, file) {
    if (!this.#isTTY || this.#level < LEVELS.info) return;
    const pct = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 4)) + '░'.repeat(25 - Math.floor(pct / 4));
    process.stdout.write(`\r${DIM}  ${bar} ${pct}% (${current}/${total})${RESET}  `);
    if (current === total) process.stdout.write('\n');
  }
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const neg = bytes < 0;
  const abs = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), units.length - 1);
  const val = (abs / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${neg ? '-' : ''}${val} ${units[i]}`;
}

export function createLogger(opts) {
  return new Logger(opts);
}
