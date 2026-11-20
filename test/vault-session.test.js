import assert from 'node:assert/strict';
import test from 'node:test';
import { keyIdFromSpki } from '../lib/vault/keystore.js';
import { VAULT_PAYLOAD_REF } from '../lib/vault/protocol.js';
import { CryptoToolExecutor } from '../lib/vault/session.js';

async function setup() {
  const pair = await crypto.subtle.generateKey('X25519', false, ['deriveBits']);
  const id = await keyIdFromSpki(await crypto.subtle.exportKey('spki', pair.publicKey));
  const recipient = { id, alias: 'Ali', algo: 'X25519', ...pair };
  const executor = new CryptoToolExecutor({
    list: async () => [recipient],
    get: async keyId => keyId === id ? recipient : null,
    consumeView: async () => true,
  });
  const plan = {
    payload_ref: VAULT_PAYLOAD_REF, recipient_ids: [id], signer_id: null,
    cipher: 'AES-256-GCM', key_wrap: 'ECDH-ES+A256KW', expires_in_minutes: 1440, max_views: null,
  };
  return { executor, plan, id };
}

test('sends only references and safe key metadata, revises a plan, and seals and opens locally', async t => {
  const { executor, plan, id } = await setup();
  const secret = 'Persian test payload: متن محرمانه';
  executor.setText(secret);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/vault');
    assert.ok(!options.body.includes(secret));
    const body = JSON.parse(options.body);
    assert.deepEqual(body.keys, [{ id, alias: 'Ali', type: 'private', algo: 'X25519' }]);
    requests.push(body);
    return Response.json({
      plan: { ...plan, cipher: body.previous_plan ? 'ChaCha20-Poly1305' : plan.cipher }, reply: null,
    });
  });

  const first = await executor.ask(`Encrypt ${secret} for Ali for 24 hours`, 'en');
  assert.deepEqual(first.plan, plan);
  assert.equal(requests[0].messages[0].content, `Encrypt ${VAULT_PAYLOAD_REF} for Ali for 24 hours`);
  const revised = await executor.ask('Actually, switch the cipher to ChaCha20-Poly1305', 'en');
  assert.deepEqual(requests[1].previous_plan, plan);
  assert.equal(revised.plan.cipher, 'ChaCha20-Poly1305');
  const vault = await executor.seal();
  assert.equal(vault.crypto.cipher, 'ChaCha20-Poly1305');
  const opened = await executor.open(JSON.stringify(vault));
  assert.equal(new TextDecoder().decode(opened.bytes), secret);
  assert.equal(requests.length, 2);
});

test('rejects key material and bounds history to ten sanitized messages', async t => {
  const { executor } = await setup();
  const file = new File(['private contents'], 'confidential-notes.txt', { type: 'text/plain' });
  await executor.setFile(file);
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    assert.ok(!body.includes(file.name) && !body.includes('private contents'));
    const input = JSON.parse(body);
    assert.ok(input.messages.length <= 10);
    return Response.json({ plan: null, reply: 'Which recipient should be able to open it?' });
  });
  await assert.rejects(executor.ask('Use -----BEGIN PRIVATE KEY----- ...', 'en'), { code: 'invalid-intent' });
  assert.equal(fetch.mock.callCount(), 0);
  for (let index = 0; index < 7; index++) await executor.ask(`Seal ${file.name}`, 'en');
  assert.equal(executor.messages.length, 10);
  assert.equal(executor.messages[0].content, `Seal ${VAULT_PAYLOAD_REF}`);
  executor.clear();
  assert.deepEqual(executor.messages, []);
  assert.equal(executor.hasPayload(), false);
  assert.equal(executor.plan, null);
});

test('clearing the session discards a late planner reply and wipes an in-flight file buffer', async t => {
  const { executor, plan } = await setup();
  let completeFetch;
  const started = new Promise(resolve => {
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => {
      resolve(signal);
      return new Promise(done => { completeFetch = done; });
    });
  });
  executor.setText('placeholder message');
  const pendingPlan = executor.ask('Seal for Ali', 'en');
  const signal = await started;
  executor.clear();
  assert.equal(signal.aborted, true);
  completeFetch(Response.json({ plan, reply: null }));
  await assert.rejects(pendingPlan, { code: 'cancelled' });
  assert.deepEqual(executor.messages, []);

  const bytes = Uint8Array.of(1, 2, 3);
  let completeRead;
  const pendingFile = executor.setFile({
    name: 'file.bin', type: 'application/octet-stream', size: bytes.length,
    arrayBuffer: () => new Promise(resolve => { completeRead = resolve; }),
  });
  executor.clear();
  completeRead(bytes.buffer);
  await assert.rejects(pendingFile, { code: 'cancelled' });
  assert.deepEqual(bytes, Uint8Array.of(0, 0, 0));
  assert.equal(executor.hasPayload(), false);
});
