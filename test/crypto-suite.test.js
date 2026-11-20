import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  hashText,
  verifyHash,
  generateHmac,
  verifyHmac,
  generateSecureToken,
  generateSecurePassphrase,
  calculateEntropy,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  generateEncryptionKeyPair,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  encryptMessage,
  decryptMessage,
  CRYPTO_TOOLS,
  executeCryptoTool
} from '../lib/crypto.js';

test('Hashing: standard test vectors and multi-format support', async () => {
  // RFC 6234 / NIST standard test vector for empty string and "hello world"
  const emptyHash = await hashText('', { algorithm: 'SHA-256', format: 'hex' });
  assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const helloHash = await hashText('hello world', { algorithm: 'SHA-256', format: 'hex' });
  assert.equal(helloHash, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');

  const base64Hash = await hashText('hello world', { algorithm: 'SHA-256', format: 'base64' });
  assert.ok(base64Hash.length > 0);

  const sha512Hash = await hashText('test', { algorithm: 'SHA-512', format: 'hex' });
  assert.equal(sha512Hash.length, 128);

  // verifyHash
  assert.equal(await verifyHash('hello world', helloHash, { algorithm: 'SHA-256', format: 'hex' }), true);
  assert.equal(await verifyHash('hello world!', helloHash, { algorithm: 'SHA-256', format: 'hex' }), false);
  assert.equal(await verifyHash('hello world', 'invalid', { algorithm: 'SHA-256', format: 'hex' }), false);
});

test('Hashing: SHA-2 algorithms match standard vectors for abc', async () => {
  const vectors = {
    'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA-384': 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    'SHA-512': 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
  };
  for (const [algorithm, expected] of Object.entries(vectors)) {
    assert.equal(await hashText('abc', { algorithm, format: 'hex' }), expected);
  }
});

test('HMAC: generation and verification against tampering', async () => {
  const secret = 'super-secret-key-123';
  const message = 'تأیید اصالت پیام فارسی';

  const sigHex = await generateHmac(message, secret, { algorithm: 'SHA-256', format: 'hex' });
  assert.equal(await verifyHmac(message, secret, sigHex, { algorithm: 'SHA-256', format: 'hex' }), true);
  assert.equal(await verifyHmac(message, 'wrong-secret', sigHex, { algorithm: 'SHA-256', format: 'hex' }), false);
  assert.equal(await verifyHmac('پیام تغییر یافته', secret, sigHex, { algorithm: 'SHA-256', format: 'hex' }), false);

  const sigB64 = await generateHmac(message, secret, { algorithm: 'SHA-512', format: 'base64' });
  assert.equal(await verifyHmac(message, secret, sigB64, { algorithm: 'SHA-512', format: 'base64' }), true);
});

test('CSPRNG: tokens, passphrases, and entropy metrics', () => {
  const tokenHex = generateSecureToken({ byteLength: 16, format: 'hex' });
  assert.equal(tokenHex.length, 32);

  const tokenB64url = generateSecureToken({ byteLength: 32, format: 'base64url' });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(tokenB64url));

  const phrase = generateSecurePassphrase({ wordCount: 4, separator: '.' });
  const words = phrase.split('.');
  assert.equal(words.length, 4);

  const stats = calculateEntropy('correct-horse-battery-staple');
  assert.ok(stats.entropyBits > 50);
  assert.ok(stats.uniqueChars > 10);
});

test('Asymmetric Signatures: ECDSA P-256 sign and verify round-trip', async () => {
  const keyPair = await generateSigningKeyPair();
  assert.equal(keyPair.publicKey.kty, 'EC');
  assert.equal(keyPair.publicKey.crv, 'P-256');

  const text = 'اطلاعیه رسمی برای امضای دیجیتال 🔏';
  const signature = await signMessage(text, keyPair.privateKey);
  assert.ok(signature.length > 0);

  const isValid = await verifySignature(text, signature, keyPair.publicKey);
  assert.equal(isValid, true);

  const isTamperedValid = await verifySignature(text + '!', signature, keyPair.publicKey);
  assert.equal(isTamperedValid, false);
});

test('Asymmetric Encryption: RSA-OAEP encrypt and decrypt round-trip', async () => {
  const keyPair = await generateEncryptionKeyPair({ modulusLength: 2048 });
  assert.equal(keyPair.publicKey.kty, 'RSA');

  const secretText = 'کلید خصوصی در مرورگر می‌ماند 🔒';
  const encrypted = await encryptWithPublicKey(secretText, keyPair.publicKey);
  assert.ok(encrypted.startsWith('rsa1.'));

  const decrypted = await decryptWithPrivateKey(encrypted, keyPair.privateKey);
  assert.equal(decrypted, secretText);

  // A 2048-bit OAEP key with SHA-256 supports at most 190 UTF-8 bytes.
  const maxMessage = 'a'.repeat(190);
  assert.equal(await decryptWithPrivateKey(await encryptWithPublicKey(maxMessage, keyPair.publicKey), keyPair.privateKey), maxMessage);
  await assert.rejects(encryptWithPublicKey('a'.repeat(191), keyPair.publicKey), /190/);
  await assert.rejects(encryptWithPublicKey('😊'.repeat(48), keyPair.publicKey), /190/);
  await assert.rejects(encryptWithPublicKey('message', {}));
  await assert.rejects(decryptWithPrivateKey(encrypted, keyPair.publicKey));
  await assert.rejects(decryptWithPrivateKey('rsa1.invalid!', keyPair.privateKey));

  // Other key cannot decrypt
  const otherKeyPair = await generateEncryptionKeyPair({ modulusLength: 2048 });
  await assert.rejects(decryptWithPrivateKey(encrypted, otherKeyPair.privateKey));
});

test('Symmetric rm2: upgraded 600k iterations and AAD protection', async () => {
  const message = 'متن آزمایشی با پروتکل rm2';
  const passphrase = 'گذرواژه امن و طولانی';

  const tokenRm2 = await encryptMessage(message, passphrase, { version: 'rm2' });
  assert.ok(tokenRm2.startsWith('rm2.'));

  const decrypted = await decryptMessage(tokenRm2, passphrase);
  assert.equal(decrypted, message);

  // Tampering the version prefix causes AAD failure in rm2
  const fakeRm1 = 'rm1' + tokenRm2.slice(3);
  await assert.rejects(decryptMessage(fakeRm1, passphrase));
});

test('Tool Definitions & Dispatcher: executes direct tools cleanly', async () => {
  assert.ok(Array.isArray(CRYPTO_TOOLS));
  assert.ok(CRYPTO_TOOLS.length >= 6);

  // Direct tool execution: hash_text
  const hashRes = await executeCryptoTool('hash_text', {
    text: 'test token',
    algorithm: 'SHA-256',
    format: 'hex'
  });
  assert.equal(hashRes.success, true);
  assert.ok(hashRes.result.hash);

  // Direct tool execution: verify_hash
  const verifyRes = await executeCryptoTool('verify_hash', {
    text: 'test token',
    expectedHash: hashRes.result.hash,
    algorithm: 'SHA-256',
    format: 'hex'
  });
  assert.equal(verifyRes.success, true);
  assert.equal(verifyRes.result.match, true);

  // Direct tool execution: generate_secure_token
  const tokenRes = await executeCryptoTool('generate_secure_token', { byteLength: 24, format: 'hex' });
  assert.equal(tokenRes.success, true);
  assert.equal(tokenRes.result.token.length, 48);

  // Direct tool execution: calculate_entropy
  const entropyRes = await executeCryptoTool('calculate_entropy', { text: 'P@ssw0rd123!' });
  assert.equal(entropyRes.success, true);
  assert.ok(entropyRes.result.entropyBits > 0);

  // Zero-knowledge tool call routing
  const encryptAction = await executeCryptoTool('encrypt_message', {});
  assert.equal(encryptAction.success, true);
  assert.equal(encryptAction.action, 'encrypt');
});
