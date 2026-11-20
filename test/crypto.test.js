import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptMessage, decryptMessage } from '../lib/crypto.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('Persian and emoji round-trip with independently randomized envelopes', async () => {
  const text = 'سلام دنیا 🌍\nمتن محرمانه';
  const first = await encryptMessage(text, 'گذرواژه قوی');
  const second = await encryptMessage(text, 'گذرواژه قوی');
  assert.notEqual(first, second);
  assert.equal(await decryptMessage(first, 'گذرواژه قوی'), text);
});

test('wrong passphrase and modified ciphertext are rejected', async () => {
  const token = await encryptMessage('secret', 'correct');
  await assert.rejects(decryptMessage(token, 'incorrect'));
  const parts = token.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  await assert.rejects(decryptMessage(parts.join('.'), 'correct'));
});

test('invalid envelopes and empty passphrases are rejected', async () => {
  await assert.rejects(decryptMessage('rm1.invalid.token', 'password'));
  await assert.rejects(encryptMessage('hello', ''));
});
