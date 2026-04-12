#!/usr/bin/env node

/**
 * avifify - Convert images to AVIF format
 *
 * Usage:
 *   avifify [options] [paths...]
 *   avifify hook install
 *   avifify hook uninstall
 *
 * Run `avifify --help` for full usage info.
 */

import { run } from '../src/cli.js';

run(process.argv.slice(2));
