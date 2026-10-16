/* eslint-disable @typescript-eslint/no-require-imports -- Native decoder regression with synthetic images only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const sharp = require('sharp');
const { loader } = require('./tenh-seven/harness.cjs');

test('application and Next resolve patched native image decoders', () => {
  const nextRequire = createRequire(require.resolve('next/package.json'));
  assert.equal(nextRequire.resolve('sharp'), require.resolve('sharp'));
  for (const [name, minimum] of [['sharp', '0.35.5'], ['vips', '8.18.3'], ['heif', '1.23.2'], ['rsvg', '2.63.2']]) {
    const actual = sharp.versions[name].split('.').map(Number);
    const expected = minimum.split('.').map(Number);
    const difference = actual.map((value, i) => value - expected[i]).find(value => value !== 0) ?? 0;
    assert.ok(difference >= 0, `${name} ${sharp.versions[name]} must include the published decoder fixes`);
  }
});

test('patched decoders preserve bounded JPEG and WebP avatar output across supported inputs', async t => {
  const { avatarThumbnail } = loader({ 'server-only': {} })('lib/media/avatar-thumbnail.ts');
  for (const format of ['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'svg']) {
    await t.test(format, async () => {
      const input = format === 'svg'
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="blue"/></svg>')
        : await sharp({ create: { width: 64, height: 32, channels: 4, background: '#33669980' } }).toFormat(format).toBuffer();
      for (const outputFormat of ['jpeg', 'webp']) {
        const output = await avatarThumbnail(input, outputFormat);
        const metadata = await sharp(output).metadata();
        assert.equal(metadata.format, outputFormat);
        assert.equal(metadata.width, 64);
        assert.equal(metadata.height, 32);
        if (outputFormat === 'jpeg') assert.equal(metadata.hasAlpha, false);
      }
    });
  }
  await assert.rejects(() => avatarThumbnail(Buffer.from('not an image')));
});
