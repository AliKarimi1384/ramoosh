import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatStream } from '../lib/chat-stream.js';

test('delivers UTF-8 deltas before completion and accepts split SSE frames', async () => {
  let controller;
  const response = new Response(new ReadableStream({ start(c) { controller = c; } }));
  const encoder = new TextEncoder();
  const deltas = [];
  const result = readChatStream(response, text => deltas.push(text));
  const bytes = encoder.encode('data: {"type":"delta","text":"سلام"}\r\n\r\n');
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(deltas, ['سلام']);
  controller.enqueue(encoder.encode('data: {"type":"done","reply":"سلام","action":"encrypt"}\n\n'));
  assert.deepEqual(await result, { reply: 'سلام', action: 'encrypt' });
});

test('rejects an error event and an incomplete stream', async () => {
  await assert.rejects(readChatStream(new Response('data: {"type":"error","error":"failed"}\n\n'), () => {}), /failed/);
  await assert.rejects(readChatStream(new Response('data: {"type":"delta","text":"partial"}\n\n'), () => {}), /before completion/);
});
