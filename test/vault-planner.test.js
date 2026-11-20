import test from 'node:test';
import assert from 'node:assert/strict';
import vault from '../api/vault.js';
import { MAX_VAULT_MESSAGES, MAX_VAULT_VIEWS, VAULT_PAYLOAD_REF, validatePlan } from '../lib/vault/protocol.js';

const ali = { id: `key_${'A'.repeat(43)}`, alias: 'Ali', type: 'public', algo: 'X25519' };
const sara = { id: `key_${'B'.repeat(43)}`, alias: 'Sara', type: 'public', algo: 'RSA-OAEP-256' };
const self = { id: `key_${'C'.repeat(43)}`, alias: 'My signature', type: 'private', algo: 'Ed25519' };
const keys = [ali, sara, self];
const plan = {
  payload_ref: VAULT_PAYLOAD_REF,
  recipient_ids: [ali.id],
  signer_id: self.id,
  cipher: 'AES-256-GCM',
  key_wrap: 'ECDH-ES+A256KW',
  expires_in_minutes: 1440,
  max_views: 2,
};

const request = {
  language: 'en',
  messages: [{ role: 'user', content: `Seal ${VAULT_PAYLOAD_REF} for Ali, expire after 24 hours, sign it and allow two opens.` }],
  keys,
  previous_plan: null,
};

const toolCall = (value = plan) => ({ type: 'function_call', name: 'propose_vault', arguments: JSON.stringify(value) });

async function callVault(body, method = 'POST') {
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await vault({ method, body }, res);
  return res;
}

function mockOpenAI(t, result) {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'vault-test-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });
  return t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => result }));
}

test('plans a local pipeline through a strict, stateless model tool call', async t => {
  const fetch = mockOpenAI(t, { status: 'completed', output: [toolCall()] });
  const res = await callVault(request);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { plan, reply: null });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const modelRequest = JSON.parse(options.body);
  assert.equal(modelRequest.store, false);
  assert.equal(modelRequest.parallel_tool_calls, false);
  assert.equal(modelRequest.tools.length, 1);
  assert.equal(modelRequest.tools[0].strict, true);
  assert.deepEqual(modelRequest.tools[0].parameters.properties.payload_ref.enum, [VAULT_PAYLOAD_REF]);
  assert.equal(modelRequest.tools[0].parameters.additionalProperties, false);
  const [context, intent] = modelRequest.input[0].content;
  assert.equal(context.type, 'input_text');
  assert.deepEqual(JSON.parse(context.text), { payload_ref: VAULT_PAYLOAD_REF, keys, previous_plan: null });
  assert.equal(intent.text, request.messages[0].content);
});

test('supports revising a reviewed draft and returns clarification without an action', async t => {
  const clarification = 'Which cipher do you want to use?';
  const fetch = mockOpenAI(t, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: clarification }] }] });
  const history = [
    ...request.messages,
    { role: 'assistant', content: 'Drafted a vault plan for Ali.' },
    { role: 'user', content: 'Actually, switch the cipher.' },
  ];
  const res = await callVault({ ...request, messages: history, previous_plan: plan });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { plan: null, reply: clarification });
  const modelRequest = JSON.parse(fetch.mock.calls[0].arguments[1].body);
  assert.deepEqual(modelRequest.input.slice(0, -1), history.slice(0, -1));
  assert.deepEqual(JSON.parse(modelRequest.input.at(-1).content[0].text).previous_plan, plan);
});

test('rejects sensitive or malformed request fields before an upstream call', async t => {
  const fetch = mockOpenAI(t, { status: 'completed', output: [toolCall()] });
  const invalidRequests = [
    { ...request, payload: 'raw secret' },
    { ...request, keys: [{ ...ali, publicKey: 'unexpected key bytes' }] },
    { ...request, keys: [{ ...self, privateKey: 'raw private key' }] },
    { ...request, keys: [{ ...ali, alias: '-----BEGIN PRIVATE KEY-----' }] },
    { ...request, keys: [{ ...ali, alias: 'A'.repeat(43) }] },
    { ...request, messages: [{ ...request.messages[0], file: 'secret file' }] },
    { ...request, messages: [{ role: 'user', content: '-----BEGIN RSA PRIVATE KEY-----' }] },
    { ...request, messages: [{ role: 'user', content: JSON.stringify({ kty: 'oct', k: 'raw key' }) }] },
    { ...request, messages: [{ role: 'user', content: 'aa'.repeat(32) }] },
    { ...request, messages: Array(MAX_VAULT_MESSAGES + 1).fill(request.messages[0]) },
    { ...request, messages: [{ role: 'assistant', content: 'Drafted a plan.' }] },
    { ...request, previous_plan: { ...plan, max_views: 0 } },
  ];
  for (const body of invalidRequests) assert.equal((await callVault(body)).statusCode, 400);
  const res = await callVault(request, 'GET');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejects mismatched keys, invalid limits, and unrecognized tool calls', async t => {
  const result = { status: 'completed', output: [] };
  mockOpenAI(t, result);
  const invalidPlans = [
    { ...plan, recipient_ids: [ali.id, ali.id] },
    { ...plan, recipient_ids: [ali.id, sara.id] },
    { ...plan, recipient_ids: [self.id] },
    { ...plan, recipient_ids: [`key_${'Z'.repeat(43)}`] },
    { ...plan, signer_id: ali.id },
    { ...plan, payload_ref: 'raw secret' },
    { ...plan, expires_in_minutes: -1 },
    { ...plan, max_views: MAX_VAULT_VIEWS + 1 },
    { ...plan, extra: 'unexpected' },
  ];
  for (const value of invalidPlans) {
    result.output = [toolCall(value)];
    assert.equal((await callVault(request)).statusCode, 422);
  }
  assert.equal(validatePlan(plan, [ali, { ...self, type: 'public' }]), false);
  result.output = [{ ...toolCall(), name: 'decrypt_message' }];
  assert.equal((await callVault(request)).statusCode, 422);
  result.output = [toolCall(), toolCall()];
  assert.equal((await callVault(request)).statusCode, 422);
  result.output = [{ ...toolCall(), arguments: '{' }];
  assert.equal((await callVault(request)).statusCode, 422);
});
