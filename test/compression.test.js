import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync, deflateSync, inflateSync } from 'node:zlib';
import { compressText, decompressText } from '../lib/compression.js';

for (const [algorithm, compress, decompress] of [
  ['gzip', gzipSync, gunzipSync],
  ['deflate', deflateSync, inflateSync],
]) {
  test(`${algorithm} round-trips text and interoperates with zlib`, async () => {
    for (const text of ['', 'hello hello hello', 'سلام دنیا 🌍\nمتن فارسی']) {
      const encoded = await compressText(text, { algorithm });
      assert.equal(await decompressText(encoded, { algorithm }), text);
      assert.equal(decompress(Buffer.from(encoded, 'base64')).toString('utf8'), text);
      assert.equal(await decompressText(compress(Buffer.from(text)).toString('base64'), { algorithm }), text);
    }
  });
}

test('invalid formats, damaged streams, and invalid UTF-8 are rejected', async () => {
  await assert.rejects(compressText(42));
  await assert.rejects(compressText('text', { algorithm: 'unknown' }));
  await assert.rejects(decompressText('not base64!'));
  await assert.rejects(decompressText('AB=='));
  await assert.rejects(decompressText(Buffer.from('not gzip').toString('base64')));
  await assert.rejects(decompressText(gzipSync(Buffer.from([0xff])).toString('base64')));
  await assert.rejects(decompressText(gzipSync(Buffer.from('hello')).toString('base64'), { algorithm: 'deflate' }));
});

test('limits prevent oversized text and decompression expansion', async () => {
  await assert.rejects(compressText('a'.repeat(1_000_001)));
  const expanded = gzipSync(Buffer.from('a'.repeat(1_000_001))).toString('base64');
  await assert.rejects(decompressText(expanded));
});
