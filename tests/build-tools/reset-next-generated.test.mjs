import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../scripts/reset-next-generated.mjs', import.meta.url));
async function exists(p) { try { await lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tenh-next-reset-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(source, path.join(root, 'scripts/reset-next-generated.mjs'));
  await writeFile(path.join(root, 'package.json'), '{"dependencies":{"next":"16.2.12"},"scripts":{"build":"next build"}}');
  await mkdir(path.join(root, '.next/dev/types'), { recursive: true });
  // A synthetic malformed generated declaration, using the fragment the user reported.
  await writeFile(path.join(root, '.next/dev/types/routes.d.ts'), 'export {};\ndlerRoute extends AppRouteHandlerRoutes> {\n params: Promise<ParamMap[AppRouteHandlerRoute]>\n}\n');
  await mkdir(path.join(root, '.next/types'), { recursive: true });
  await writeFile(path.join(root, '.next/types/routes.d.ts'), '// old production output\n');
  await writeFile(path.join(root, 'tsconfig.tsbuildinfo'), 'old incremental cache');
  await writeFile(path.join(root, 'tsconfig.build.tsbuildinfo'), 'old build cache');
  return root;
}
function run(root, args = [], cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/reset-next-generated.mjs'), ...args], { cwd, encoding: 'utf8' });
}

test('no confirmation refuses to remove generated output', async t => {
  const root = await fixture(t); const r = run(root);
  assert.equal(r.status, 1); assert.match(r.stderr, /confirm-stopped/);
  assert.equal(await exists(path.join(root, '.next/dev/types/routes.d.ts')), true);
});

test('dry run keeps all generated output', async t => {
  const root = await fixture(t); const r = run(root, ['--dry-run']);
  assert.equal(r.status, 0); assert.match(r.stdout, /Would remove .next/);
  for (const p of ['.next/dev/types/routes.d.ts','tsconfig.tsbuildinfo','tsconfig.build.tsbuildinfo'])
    assert.equal(await exists(path.join(root, p)), true);
});

test('confirmed reset removes malformed dev types, production output and incremental caches', async t => {
  const root = await fixture(t); const r = run(root, ['--confirm-stopped']);
  assert.equal(r.status, 0, r.stderr);
  for (const p of ['.next','tsconfig.tsbuildinfo','tsconfig.build.tsbuildinfo'])
    assert.equal(await exists(path.join(root, p)), false);
});

test('keeps TENH source, extension version, secrets, lockfiles and configuration byte-identical', async t => {
  const root = await fixture(t);
  const files = ['app/api/telegram/send/route.ts','components/inbox/reply-box.tsx','tenh-extension/manifest.json',
    'tenh-extension/src/background.js','.env.local','package-lock.json','pnpm-lock.yaml','next.config.ts',
    'tsconfig.json','next-env.d.ts','.gitignore','node_modules/fixture.txt','db/data.txt','dist/extension.zip'];
  const original = new Map();
  original.set('package.json', await readFile(path.join(root, 'package.json')));
  for (const [i, name] of files.entries()) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    const body = Buffer.from(`fixture ${i} keep unchanged`);
    await writeFile(path.join(root, name), body); original.set(name, body);
  }
  const r = run(root, ['--confirm-stopped']); assert.equal(r.status, 0, r.stderr);
  for (const [name, body] of original) assert.deepEqual(await readFile(path.join(root, name)), body, name);
});

test('repeat reset safely reports nothing to clear', async t => {
  const root = await fixture(t); assert.equal(run(root, ['--confirm-stopped']).status, 0);
  const r = run(root, ['--confirm-stopped']); assert.equal(r.status, 0); assert.match(r.stdout, /No generated output/);
});

test('non Next project refused', async t => {
  const root = await fixture(t); await writeFile(path.join(root,'package.json'), '{}');
  const r = run(root,['--confirm-stopped']); assert.equal(r.status, 1); assert.match(r.stderr,/Next.js project/);
  assert.equal(await exists(path.join(root, '.next')), true);
});

test('invalid package.json refused', async t => {
  const root = await fixture(t); await writeFile(path.join(root,'package.json'), '{broken');
  assert.equal(run(root,['--confirm-stopped']).status, 1);
  assert.equal(await exists(path.join(root, '.next')), true);
});

test('wrong working directory refused', async t => {
  const root = await fixture(t); const r = run(root,['--confirm-stopped'],path.join(root,'scripts'));
  assert.equal(r.status, 1); assert.match(r.stderr,/project root/);
  assert.equal(await exists(path.join(root, '.next')), true);
});

test('unknown arguments cannot change cleanup target', async t => {
  const root = await fixture(t); const r = run(root,['--confirm-stopped','--path=app']);
  assert.equal(r.status, 1); assert.match(r.stderr,/Unknown option/);
  assert.equal(await exists(path.join(root, '.next')), true);
});

test('refuses linked .next directory', async t => {
  const root = await fixture(t); const outside = await mkdtemp(path.join(os.tmpdir(),'tenh-outside-'));
  t.after(() => rm(outside,{recursive:true,force:true}));
  await writeFile(path.join(outside,'keep.txt'),'unchanged');
  await rm(path.join(root,'.next'),{recursive:true,force:true});
  await symlink(outside,path.join(root,'.next'),'junction');
  const r = run(root,['--confirm-stopped']); assert.equal(r.status,1); assert.match(r.stderr,/linked target/);
  assert.equal(await readFile(path.join(outside,'keep.txt'),'utf8'),'unchanged');
});

test('preflight refuses unexpected cache directory before deleting .next', async t => {
  const root = await fixture(t); await rm(path.join(root,'tsconfig.tsbuildinfo'));
  await mkdir(path.join(root,'tsconfig.tsbuildinfo'));
  assert.equal(run(root,['--confirm-stopped']).status,1);
  assert.equal(await exists(path.join(root,'.next/dev/types/routes.d.ts')),true);
});

test('help succeeds without touching files', async t => {
  const root = await fixture(t); const r = run(root,['--help']); assert.equal(r.status,0);
  assert.match(r.stdout,/Stop|stopping/); assert.equal(await exists(path.join(root,'.next')),true);
});
