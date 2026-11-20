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

test('supports Groq API with light LLM (qwen/qwen3.8-27b)', async () => {
  const originalFetch = globalThis.fetch;
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_test123';
    let requestUrl;
    let payload;
    globalThis.fetch = async (url, options) => {
      requestUrl = url;
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'encrypt_message', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    const res = response();
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'می‌خواهم پیامی را رمزگذاری کنم' }] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, 'encrypt');
    assert.match(res.body.reply, /ابزار رمزگذاری/);
    assert.equal(requestUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(payload.model, 'qwen/qwen3.8-27b');
    assert.equal(payload.tools[0].type, 'function');
    assert.equal(payload.tools[0].function.name, 'encrypt_message');

    // Test text reply without tool call
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'سلام! چطور می‌توانم در رمزگذاری یا رمزگشایی به شما کمک کنم؟',
            },
          },
        ],
      }),
    });
    const resText = response();
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'سلام' }] } }, resText);
    assert.equal(resText.statusCode, 200);
    assert.equal(resText.body.action, null);
    assert.match(resText.body.reply, /سلام/);

    // Test automatic routing when gsk_ key is set in OPENAI_API_KEY
    delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = 'gsk_auto_detect';
    const resAuto = response();
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'سلام' }] } }, resAuto);
    assert.equal(resAuto.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});
