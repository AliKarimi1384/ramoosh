import assert from 'node:assert/strict';
import {
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  KeyObject,
} from 'node:crypto';
import test from 'node:test';
import { keyIdFromSpki } from '../lib/vault/keystore.js';
import { createVault, MAX_PAYLOAD_BYTES, openVault, parseVault } from '../lib/vault/package.js';

const text = 'درود 🗝️';
const bytes = new TextEncoder().encode(text);
const plan = {
  cipher: 'AES-256-GCM',
  key_wrap: 'RSA-OAEP-256',
  expires_in_minutes: null,
  max_views: null,
};

async function makeKey(algo, parameters, usages) {
  const pair = await crypto.subtle.generateKey(parameters, false, usages);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  assert.equal(pair.privateKey.extractable, false);
  return { id: await keyIdFromSpki(spki), alias: algo, algo, ...pair };
}

const rsaKey = () => makeKey('RSA-OAEP-256', {
  name: 'RSA-OAEP', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
}, ['encrypt', 'decrypt']);
const x25519Key = () => makeKey('X25519', 'X25519', ['deriveBits']);
const ecdsaKey = () => makeKey('ECDSA-P256', { name: 'ECDSA', namedCurve: 'P-256' }, ['sign', 'verify']);
const ed25519Key = () => makeKey('Ed25519', 'Ed25519', ['sign', 'verify']);

function opener(records, consumeView = async () => assert.fail('Unexpected view consumption')) {
  return {
    getKey: async id => records.find(record => record.id === id) ?? null,
    consumeView,
  };
}

function changeBase64(value) {
  return (value.startsWith('A') ? 'B' : 'A') + value.slice(1);
}

test('RSA, AES-GCM and ECDSA round trip with or without a locally trusted signer', async () => {
  const [recipient, signer, stranger] = await Promise.all([rsaKey(), ecdsaKey(), rsaKey()]);
  const recipientPublic = { ...recipient, privateKey: undefined };
  const vault = await createVault({ bytes, payload: { kind: 'text' }, plan, recipients: [recipientPublic], signer });
  const serialized = JSON.stringify({
    ...vault, policy: { signed: vault.policy.signed, max_views: null, expires_at: null },
  }, null, 2);
  assert.equal(serialized.includes(text), false);
  const parsed = parseVault(serialized);
  assert.equal(parsed.signature.algo, 'ECDSA-P256');
  assert.deepEqual(await openVault(parsed, opener([recipient])), {
    bytes, payload: { kind: 'text' }, signature: 'untrusted',
  });
  const signerPublic = { ...signer, privateKey: undefined };
  assert.equal((await openVault(parsed, opener([recipient, signerPublic]))).signature, 'verified');
  await assert.rejects(openVault(parsed, opener([recipientPublic, stranger])), { code: 'no-recipient' });
});

test('X25519, AES-KW, ChaCha20-Poly1305 and Ed25519 round trip a binary file for multiple contacts', async () => {
  const [first, second, signer] = await Promise.all([x25519Key(), x25519Key(), ed25519Key()]);
  const content = new Uint8Array([0, 0x80, 0xff, 1]);
  const payload = { kind: 'file', name: 'محرمانه.bin', type: 'application/octet-stream' };
  const vault = await createVault({
    bytes: content,
    payload,
    plan: { ...plan, cipher: 'ChaCha20-Poly1305', key_wrap: 'ECDH-ES+A256KW' },
    recipients: [first, second],
    signer,
  });
  const serialized = JSON.stringify(vault);
  for (const value of Object.values(payload)) assert.equal(serialized.includes(JSON.stringify(value)), false);
  const parsed = parseVault(serialized);
  assert.notEqual(parsed.recipients[0].ephemeral_public_key, parsed.recipients[1].ephemeral_public_key);
  for (const key of [first, second]) {
    assert.deepEqual(await openVault(parsed, opener([key, signer])), { bytes: content, payload, signature: 'verified' });
  }

  // Verify the ECDH/AES-KW composition and content cipher independently using OpenSSL-backed node:crypto.
  const { wrapped_key, ephemeral_public_key } = parsed.recipients[0];
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(ephemeral_public_key, 'base64')]),
    format: 'der',
    type: 'spki',
  });
  const sharedSecret = diffieHellman({ privateKey: KeyObject.from(first.privateKey), publicKey });
  const otherInfo = Buffer.from('0000000e454344482d45532b413235364b57000000000000000000000100', 'hex');
  const kek = createHash('sha256').update(Buffer.from([0, 0, 0, 1])).update(sharedSecret).update(otherInfo).digest();
  const unwrap = createDecipheriv('id-aes256-wrap', kek, Buffer.alloc(8, 0xa6));
  const cek = Buffer.concat([unwrap.update(Buffer.from(wrapped_key, 'base64')), unwrap.final()]);
  const chacha = createDecipheriv('chacha20-poly1305', cek, Buffer.from(parsed.crypto.iv, 'base64'), { authTagLength: 16 });
  chacha.setAAD(Buffer.from(JSON.stringify([
    'Ramoosh Vault', '1.0', parsed.package_id, parsed.created_at,
    [null, null, true],
    ['ChaCha20-Poly1305', 'ECDH-ES+A256KW', parsed.crypto.iv],
    parsed.recipients.map(entry => [entry.key_id, entry.wrapped_key, entry.ephemeral_public_key]),
    [parsed.signature.signer_key_id, 'Ed25519', parsed.signature.public_key],
  ])));
  chacha.setAuthTag(Buffer.from(parsed.crypto.auth_tag, 'base64'));
  const body = Buffer.concat([chacha.update(Buffer.from(parsed.ciphertext, 'base64')), chacha.final()]);
  assert.deepEqual(JSON.parse(body.subarray(4, 4 + body.readUInt32BE()).toString()), payload);
  assert.deepEqual(new Uint8Array(body.subarray(4 + body.readUInt32BE())), content);
});

test('authentication rejects edits to policy, recipient list, wrapped keys, ciphertext, and signature', async () => {
  const [recipient, other, signer] = await Promise.all([x25519Key(), x25519Key(), ed25519Key()]);
  const limitedPlan = { ...plan, key_wrap: 'ECDH-ES+A256KW', expires_in_minutes: 10, max_views: 2 };
  const options = { bytes, payload: { kind: 'text' }, plan: limitedPlan, recipients: [recipient, other] };
  const unsigned = await createVault(options);
  for (const tamper of [
    vault => { vault.package_id = crypto.randomUUID(); },
    vault => { vault.policy.max_views++; },
    vault => { vault.policy.expires_at = null; },
    vault => { vault.recipients.reverse(); },
    vault => { vault.recipients[0].ephemeral_public_key = Buffer.alloc(32).toString('base64'); },
    vault => { vault.recipients[1].wrapped_key = changeBase64(vault.recipients[1].wrapped_key); },
    vault => { vault.ciphertext = changeBase64(vault.ciphertext); },
  ]) {
    const forged = structuredClone(unsigned);
    tamper(forged);
    await assert.rejects(openVault(forged, opener([recipient])), { code: 'authentication-failed' });
  }

  const signed = await createVault({ ...options, signer });
  const invalidSignature = structuredClone(signed);
  invalidSignature.signature.value = changeBase64(invalidSignature.signature.value);
  await assert.rejects(openVault(invalidSignature, opener([recipient])), { code: 'invalid-signature' });
  signed.policy.signed = false;
  signed.signature = null;
  await assert.rejects(openVault(signed, opener([recipient])), { code: 'authentication-failed' });
});

test('app checks expiry and successful view limits on an authenticated vault', async t => {
  const recipient = await x25519Key();
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  const vault = await createVault({
    bytes, payload: { kind: 'text' }, recipients: [recipient],
    plan: { ...plan, expires_in_minutes: 1, max_views: 1, key_wrap: 'ECDH-ES+A256KW' },
  });
  let views = 0;
  const options = opener([recipient], async (id, max) => {
    assert.equal(id, vault.package_id);
    assert.equal(max, 1);
    if (views >= max) return false;
    views++;
    return true;
  });
  assert.equal((await openVault(vault, options)).signature, 'unsigned');
  await assert.rejects(openVault(vault, options), { code: 'view-limit' });
  Date.now.mock.mockImplementation(() => 1_800_000_060_000);
  await assert.rejects(openVault(vault, opener([recipient])), { code: 'expired' });
});

test('vault parser rejects malformed shape, encoding, and size', async () => {
  const recipient = await x25519Key();
  const options = {
    bytes, payload: { kind: 'text' }, plan: { ...plan, key_wrap: 'ECDH-ES+A256KW' },
    recipients: [recipient],
  };
  const valid = await createVault(options);
  for (const tamper of [
    vault => { vault.vault_version = '2.0'; },
    vault => { vault.crypto.key_wrap = 'unknown'; },
    vault => { vault.crypto.iv = 'AAAAAAAAAAAAAAA!'; },
    vault => { vault.crypto.auth_tag = vault.crypto.auth_tag.slice(0, -3) + 'B=='; },
    vault => { vault.recipients.push(vault.recipients[0]); },
    vault => { vault.recipients[0].private_key = 'unexpected'; },
    vault => { vault.policy.max_views = -1; },
  ]) {
    const malformed = structuredClone(valid);
    tamper(malformed);
    assert.throws(() => parseVault(JSON.stringify(malformed)), { code: 'invalid-package' });
  }
  const tooLarge = new Uint8Array(MAX_PAYLOAD_BYTES + 1);
  await assert.rejects(createVault({ ...options, bytes: tooLarge }), { code: 'invalid-payload' });
});

test('aborting after local key lookup stops a vault before a view is consumed', async () => {
  const recipient = await x25519Key();
  const vault = await createVault({
    bytes, payload: { kind: 'text' }, recipients: [recipient],
    plan: { ...plan, max_views: 1, key_wrap: 'ECDH-ES+A256KW' },
  });
  const controller = new AbortController();
  await assert.rejects(openVault(vault, {
    signal: controller.signal,
    getKey: async () => {
      controller.abort();
      return recipient;
    },
    consumeView: async () => assert.fail('Aborted open consumed a view'),
  }), { name: 'AbortError' });
});
