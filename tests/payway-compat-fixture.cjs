/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// Reuse the exact existing synthetic schema/functions without registering its tests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve('tests/payway-sql-isolated.test.cjs');
const source = fs.readFileSync(filename,'utf8');
const marker = "\ntest('isolated PostgreSQL billing migrations";
const boundary = source.indexOf(marker);
if (boundary < 0) throw Error('Reviewed fixture boundary changed.');
const moduleFixture = { exports: {} };
vm.runInNewContext(source.slice(0,boundary) + '\nmodule.exports={setup,seed,purchase,activate,functions};',
  { require:createRequire(filename),module:moduleFixture,process,console,__dirname:path.dirname(filename),__filename:filename },
  { filename });
module.exports = moduleFixture.exports;
