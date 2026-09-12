#!/usr/bin/env node
/**
 * One-time Next.js generated-output reset for TENH.
 * Run from the project root AFTER stopping all dev/build/start processes.
 * No dependencies, configuration edits, Git writes, or automatic build hooks.
 */
import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `TENH: reset generated Next.js output\n\nFrom your project root, after stopping all Next.js processes:\n  node scripts/reset-next-generated.mjs --dry-run\n  node scripts/reset-next-generated.mjs --confirm-stopped\n  npm run build\n\nDeletes ONLY:\n  .next/\n  tsconfig.tsbuildinfo\n  tsconfig.build.tsbuildinfo\n\nThe next build regenerates Next.js route types. Source, .env files,\nnode_modules, lockfiles, configuration and tenh-extension are not modified.\nDo not run against a directory serving a live next start process.\n`;

async function statOrNull(target) {
  try { return await lstat(target); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--help', '-h', '--dry-run', '--confirm-stopped']);
  const unknown = args.find(arg => !allowed.has(arg));
  if (unknown) throw new Error(`Unknown option: ${unknown}. Run with --help.`);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP); return;
  }

  const dryRun = args.includes('--dry-run');
  if (!dryRun && !args.includes('--confirm-stopped')) {
    throw new Error('No files changed. Stop every Next.js dev/build/start process, then run with --confirm-stopped. Use --dry-run to preview.');
  }

  // The script must live directly under <project>/scripts; never clean an
  // arbitrary --path or a different working directory.
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptPath);
  if (path.basename(scriptsDir) !== 'scripts') {
    throw new Error('Keep this file at scripts/reset-next-generated.mjs inside your project.');
  }
  const root = await realpath(path.resolve(scriptsDir, '..'));
  if (root !== await realpath(process.cwd())) {
    throw new Error('Run this script from the project root containing package.json. No files changed.');
  }

  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { throw new Error('Cannot read a valid package.json in the project root. No files changed.'); }
  if (!pkg.dependencies?.next && !pkg.devDependencies?.next) {
    throw new Error('This does not appear to be a Next.js project. No files changed.');
  }

  const targets = [
    { relative: '.next', directory: true },
    { relative: 'tsconfig.tsbuildinfo', directory: false },
    { relative: 'tsconfig.build.tsbuildinfo', directory: false },
  ];

  // Preflight every path before removing anything. Refuse symlink/junction
  // targets and unexpected types instead of following them outside the repo.
  const present = [];
  for (const target of targets) {
    const absolute = path.join(root, target.relative);
    const stat = await statOrNull(absolute);
    if (!stat) continue;
    if (stat.isSymbolicLink() || (target.directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Refusing unexpected or linked target: ${target.relative}. No files changed.`);
    }
    present.push({ ...target, absolute });
  }

  if (present.length === 0) {
    console.log('No generated output to clear. Source files are unchanged.');
  }
  for (const target of present) {
    if (dryRun) {
      console.log(`[dry-run] Would remove ${target.relative}${target.directory ? '/' : ''}`);
      continue;
    }
    await rm(target.absolute, {
      recursive: target.directory,
      force: true,
      maxRetries: target.directory ? 3 : 0,
      retryDelay: 300,
    });
    console.log(`Removed ${target.relative}${target.directory ? '/' : ''}`);
  }

  if (dryRun) console.log('Preview only. No files changed.');
  else console.log('Reset complete. Run npm run build with your existing dependencies. This reset is not a build verification.');
}

main().catch(error => {
  console.error(`TENH reset: ${error?.message ?? error}`);
  console.error('If files are locked, stop the Next.js process before retrying.');
  process.exitCode = 1;
});
