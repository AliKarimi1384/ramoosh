import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resilientFetch } from '../lib/http-client.js';

test('proxy fallback exposes response chunks before the response ends', async t => {
  const response = new PassThrough();
  response.statusCode = 200;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('direct connection failed'); });
  t.mock.method(http, 'request', () => {
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => request.emit('connect', { statusCode: 200 }, { destroy() {} }));
    return request;
  });
  t.mock.method(https, 'request', (_options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => queueMicrotask(() => callback(response));
    return request;
  });

  const result = await resilientFetch('https://example.com/chat', {}, 0);
  const chunks = result.body[Symbol.asyncIterator]();
  response.write('first');
  assert.equal((await chunks.next()).value.toString(), 'first');
  response.end('second');
  assert.equal((await chunks.next()).value.toString(), 'second');
  assert.equal((await chunks.next()).done, true);
});
