// Forward provider events in a small, provider-independent SSE format.
export const actionFor = name => name === 'encrypt_message' ? 'encrypt' : name === 'decrypt_message' ? 'decrypt' : name === 'open_hash_tool' ? 'hash' : name === 'open_compress_tool' ? 'compress' : name === 'open_decompress_tool' ? 'decompress' : null;

// Treat provider arguments as untrusted and only expose algorithms valid for the operation.
export function algorithmFor(action, rawArguments) {
  try {
    const value = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
    const allowed = action === 'encrypt' || action === 'decrypt' ? ['aes', 'rsa']
      : action === 'hash' ? ['SHA-256', 'SHA-384', 'SHA-512']
      : action === 'compress' || action === 'decompress' ? ['gzip', 'deflate'] : [];
    return allowed.includes(value?.algorithm) ? value.algorithm : null;
  } catch { return null; }
}

async function* events(body) {
  if (!body) throw new Error('Missing response stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line === '') {
        if (data.length) yield data.join('\n');
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  buffer += decoder.decode();
  if (buffer || data.length) throw new Error('Incomplete event stream');
}

export async function streamChat(response, res, provider, translations) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  res.write(': connected\n\n');

  let text = '';
  let action = null;
  let algorithm = null;
  let complete = false;
  let finishReason = null;
  const toolCalls = new Map();
  try {
    for await (const raw of events(response.body)) {
      if (raw === '[DONE]') {
        if (provider === 'groq' && ['stop', 'tool_calls'].includes(finishReason)) complete = true;
        break;
      }
      const event = JSON.parse(raw);
      if (event.error || event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw new Error('Provider stream failed');
      let delta;
      if (provider === 'groq') {
        const choice = event.choices?.[0];
        delta = choice?.delta?.content;
        for (const call of choice?.delta?.tool_calls || []) {
          const previous = toolCalls.get(call.index) || { name: '', arguments: '' };
          previous.name += call.function?.name || '';
          previous.arguments += call.function?.arguments || '';
          toolCalls.set(call.index, previous);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } else {
        if (event.type === 'response.output_text.delta') delta = event.delta;
        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call' && !action) {
          action = actionFor(event.item.name);
          algorithm = algorithmFor(action, event.item.arguments);
        }
        if (event.type === 'response.completed') {
          complete = true;
          for (const item of event.response?.output || []) {
            if (item.type === 'function_call' && !action) {
              action = actionFor(item.name);
              algorithm = algorithmFor(action, item.arguments);
            }
          }
        }
      }
      if (typeof delta === 'string' && delta) {
        text += delta;
        send({ type: 'delta', text: delta });
      }
    }
    for (const call of toolCalls.values()) {
      if (action) break;
      action = actionFor(call.name);
      algorithm = algorithmFor(action, call.arguments);
    }
    const reply = action ? translations[action] : text.trim();
    if (!complete || !reply) throw new Error('Incomplete or empty response');
    send({ type: 'done', reply, action, algorithm });
  } catch {
    if (!res.destroyed) send({ type: 'error', error: translations.connection });
  } finally {
    if (!res.destroyed) res.end();
  }
}
