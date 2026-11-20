/**
 * Read the chat endpoint's SSE protocol, including UTF-8 characters split across chunks.
 * @param {Response} response
 * @param {(text: string) => void} onDelta
 * @returns {Promise<{ reply: string, action: 'encrypt' | 'decrypt' | 'hash' | null }>}
 */
export async function readChatStream(response, onDelta) {
  if (!response.ok || !response.body) throw new Error('Chat request failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result;

  function processEvent(event) {
    const data = event.split(/\r\n|\r|\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const message = JSON.parse(data);
    if (message.type === 'delta' && typeof message.text === 'string') onDelta(message.text);
    else if (message.type === 'error') throw new Error(message.error || 'Chat stream failed');
    else if (message.type === 'done') {
      if (typeof message.reply !== 'string' || !message.reply.trim()) throw new Error('Invalid chat response');
      result = { reply: message.reply, action: message.action };
    }
  }

  try {
    while (!result) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let delimiter;
      while ((delimiter = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        processEvent(buffer.slice(0, delimiter.index));
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        if (result) break;
      }
      if (done) {
        if (buffer.trim() && !result) processEvent(buffer);
        if (!result) throw new Error('Chat stream ended before completion');
      }
    }
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
