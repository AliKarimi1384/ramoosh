// Forward provider events in a small, provider-independent SSE format.
const actionFor = name => name === 'encrypt_message' ? 'encrypt' : name === 'decrypt_message' ? 'decrypt' : null;

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
  let complete = false;
  let finishReason = null;
  const toolNames = new Map();
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
          if (call.function?.name) toolNames.set(call.index, (toolNames.get(call.index) || '') + call.function.name);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } else {
        if (event.type === 'response.output_text.delta') delta = event.delta;
        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') action ||= actionFor(event.item.name);
        if (event.type === 'response.completed') {
          complete = true;
          for (const item of event.response?.output || []) {
            if (item.type === 'function_call') action ||= actionFor(item.name);
          }
        }
      }
      if (typeof delta === 'string' && delta) {
        text += delta;
        send({ type: 'delta', text: delta });
      }
    }
    for (const name of toolNames.values()) action ||= actionFor(name);
    const reply = action ? translations[action] : text.trim();
    if (!complete || !reply) throw new Error('Incomplete or empty response');
    send({ type: 'done', reply, action });
  } catch {
    if (!res.destroyed) send({ type: 'error', error: translations.connection });
  } finally {
    if (!res.destroyed) res.end();
  }
}
