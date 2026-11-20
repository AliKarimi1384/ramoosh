import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/chat.js';

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}

test('validates request and maps model tool call to client action', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output: [{ type: 'function_call', name: 'encrypt_message', arguments: '{}' }] }) };
    };
    const res = response();
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'رمزگذاری کن' }] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, 'encrypt');
    assert.match(res.body.reply, /ابزار رمزگذاری/);
    assert.match(payload.instructions, /فارسی/);
    assert.equal(payload.store, false);
    assert.deepEqual(payload.tools[0].parameters.properties, {});
    const invalid = response();
    await handler({ method: 'POST', body: { messages: [{ role: 'system', content: 'bad' }] } }, invalid);
    assert.equal(invalid.statusCode, 400);
    const english = response();
    await handler({ method: 'POST', body: { language: 'en', messages: [{ role: 'user', content: 'Encrypt a message' }] } }, english);
    assert.equal(english.body.action, 'encrypt');
    assert.match(english.body.reply, /encryption tool/i);
    assert.match(payload.instructions, /Respond in English/);
    const invalidEnglish = response();
    await handler({ method: 'POST', body: { language: 'en', messages: [] } }, invalidEnglish);
    assert.equal(invalidEnglish.body.error, 'The submitted messages are invalid.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
