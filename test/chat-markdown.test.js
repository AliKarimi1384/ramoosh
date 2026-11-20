import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '../src/ChatMarkdown.js';

const render = content => renderToStaticMarkup(createElement(ChatMarkdown, { content }));

test('renders Persian emphasis and encoded spaces', () => {
  assert.match(render('برای **رمزگذاری**&#x20;یا **رمزگشایی**'), /برای <strong>رمزگذاری<\/strong> یا <strong>رمزگشایی<\/strong>/);
});

test('renders common Markdown blocks and keeps code readable', () => {
  const html = render('## Steps\n\n- First\n- Second\n\n```js\nconst x = 1;\n```');
  assert.match(html, /<h2>Steps<\/h2>/);
  assert.match(html, /<li>First<\/li>/);
  assert.match(html, /<code class="language-js">const x = 1;/);
});

test('does not execute raw HTML or unsafe Markdown links', () => {
  const html = render('<img src=x onerror=alert(1)> [bad](javascript:alert(1))');
  assert.doesNotMatch(html, /<img|onerror|href="javascript:/i);
});

test('does not load remote Markdown images', () => {
  const html = render('![description](https://example.com/tracker.png)');
  assert.doesNotMatch(html, /<img|tracker\.png/);
  assert.match(html, /description/);
});
