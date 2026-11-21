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

function streamResponse() {
  return {
    headers: {}, chunks: [], writableEnded: false, destroyed: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; },
    write(chunk) { this.chunks.push(chunk); },
    end() { this.writableEnded = true; },
  };
}

function providerStream(events) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join(''));
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
}

function sentEvents(res) {
  return res.chunks.filter(chunk => chunk.startsWith('data: ')).map(chunk => JSON.parse(chunk.slice(6)));
}

test('opens the local hashing form for both providers, with and without streaming', async () => {
  const originalFetch = globalThis.fetch;
  const openai = process.env.OPENAI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  try {
    for (const provider of ['openai', 'groq']) {
      if (provider === 'openai') {
        process.env.OPENAI_API_KEY = 'test-key';
        delete process.env.GROQ_API_KEY;
      } else {
        delete process.env.OPENAI_API_KEY;
        process.env.GROQ_API_KEY = 'gsk_test';
      }
      for (const stream of [false, true]) {
        let payload;
        globalThis.fetch = async (_url, options) => {
          payload = JSON.parse(options.body);
          if (stream) return { ok: true, body: providerStream(provider === 'openai' ? [
            { type: 'response.completed', response: { output: [{ type: 'function_call', name: 'open_hash_tool' }] } },
            '[DONE]',
          ] : [
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'open_hash_' } }] }, finish_reason: null }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'tool' } }] }, finish_reason: 'tool_calls' }] },
            '[DONE]',
          ]) };
          return { ok: true, json: async () => provider === 'openai'
            ? { output: [{ type: 'function_call', name: 'open_hash_tool' }] }
            : { choices: [{ message: { tool_calls: [{ function: { name: 'open_hash_tool' } }] } }] } };
        };
        const res = stream ? streamResponse() : response();
        await handler({ method: 'POST', body: { language: 'en', messages: [{ role: 'user', content: 'hash a message' }], stream } }, res);
        const result = stream ? sentEvents(res).at(-1) : res.body;
        assert.equal(result.action, 'hash');
        assert.match(result.reply, /hashing tool/i);
        const tool = payload.tools.map(item => item.function || item).find(item => item.name === 'open_hash_tool');
        assert.deepEqual(tool.parameters.properties, {});
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = openai;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
  }
});


test('opens compression and decompression locally for both providers and response modes', async () => {
  const originalFetch = globalThis.fetch;
  const openai = process.env.OPENAI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  try {
    for (const provider of ['openai', 'groq']) {
      if (provider === 'openai') {
        process.env.OPENAI_API_KEY = 'test-key';
        delete process.env.GROQ_API_KEY;
      } else {
        delete process.env.OPENAI_API_KEY;
        process.env.GROQ_API_KEY = 'gsk_test';
      }
      for (const stream of [false, true]) {
        for (const [name, action] of [['open_compress_tool', 'compress'], ['open_decompress_tool', 'decompress']]) {
          let payload;
          globalThis.fetch = async (_url, options) => {
            payload = JSON.parse(options.body);
            if (stream) return { ok: true, body: providerStream(provider === 'openai' ? [
              { type: 'response.completed', response: { output: [{ type: 'function_call', name }] } },
              '[DONE]',
            ] : [
              { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: name.slice(0, 5) } }] }, finish_reason: null }] },
              { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: name.slice(5) } }] }, finish_reason: 'tool_calls' }] },
              '[DONE]',
            ]) };
            return { ok: true, json: async () => provider === 'openai'
              ? { output: [{ type: 'function_call', name }] }
              : { choices: [{ message: { tool_calls: [{ function: { name } }] } }] } };
          };
          const res = stream ? streamResponse() : response();
          await handler({ method: 'POST', body: { language: 'en', messages: [{ role: 'user', content: `${action} a message` }], stream } }, res);
          const result = stream ? sentEvents(res).at(-1) : res.body;
          assert.equal(result.action, action);
          assert.match(result.reply, action === 'compress' ? /compression tool/i : /decompression tool/i);
          const tool = payload.tools.map(item => item.function || item).find(item => item.name === name);
          assert.deepEqual(tool.parameters, { type: 'object', properties: {}, required: [], additionalProperties: false });
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = openai;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
  }
});

test('streams OpenAI text across byte boundaries and reports the final reply', async () => {
  const fetch = globalThis.fetch;
  const openai = process.env.OPENAI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.GROQ_API_KEY;
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, body: providerStream([
        { type: 'response.output_text.delta', delta: 'سلام ' },
        { type: 'response.output_text.delta', delta: 'دنیا' },
        { type: 'response.completed', response: { output: [] } },
        '[DONE]',
      ]) };
    };
    const res = streamResponse();
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'سلام' }], stream: true } }, res);
    assert.equal(payload.stream, true);
    assert.match(res.headers['Content-Type'], /^text\/event-stream/);
    assert.deepEqual(sentEvents(res), [
      { type: 'delta', text: 'سلام ' },
      { type: 'delta', text: 'دنیا' },
      { type: 'done', reply: 'سلام دنیا', action: null },
    ]);
    assert.equal(res.writableEnded, true);
  } finally {
    globalThis.fetch = fetch;
    if (openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = openai;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
  }
});

test('streams Groq tool calls and reports interrupted streams as errors', async () => {
  const fetch = globalThis.fetch;
  const groq = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = 'gsk_test';
    globalThis.fetch = async () => ({ ok: true, body: providerStream([
      { choices: [{ delta: { content: 'Working' }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'encrypt_' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'message' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]) });
    const res = streamResponse();
    await handler({ method: 'POST', body: { language: 'en', messages: [{ role: 'user', content: 'encrypt' }], stream: true } }, res);
    assert.deepEqual(sentEvents(res), [
      { type: 'delta', text: 'Working' },
      { type: 'done', reply: 'The encryption tool is ready. Choose a cryptography method and enter the details in the form.', action: 'encrypt' },
    ]);
    globalThis.fetch = async () => ({ ok: true, body: providerStream([
      { choices: [{ delta: { content: 'partial' }, finish_reason: null }] },
    ]) });
    const interrupted = streamResponse();
    await handler({ method: 'POST', body: { language: 'en', messages: [{ role: 'user', content: 'hello' }], stream: true } }, interrupted);
    assert.deepEqual(sentEvents(interrupted), [
      { type: 'delta', text: 'partial' },
      { type: 'error', error: 'Could not connect to the AI service. Please try again.' },
    ]);
  } finally {
    globalThis.fetch = fetch;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
  }
});

test('aborts the upstream request when the streaming client disconnects', async () => {
  const fetch = globalThis.fetch;
  const openai = process.env.OPENAI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.GROQ_API_KEY;
    let signal;
    globalThis.fetch = async (_url, options) => {
      signal = options.signal;
      return { ok: true, body: { async *[Symbol.asyncIterator]() { if (signal.aborted) throw new Error('aborted'); } } };
    };
    const res = streamResponse();
    let close;
    res.on = (event, callback) => { if (event === 'close') close = callback; };
    res.write = () => { res.destroyed = true; close(); };
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hello' }], stream: true } }, res);
    assert.equal(signal.aborted, true);
  } finally {
    globalThis.fetch = fetch;
    if (openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = openai;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
  }
});
