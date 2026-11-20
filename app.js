import { encryptMessage, decryptMessage } from '/lib/crypto.js';

const $ = (selector) => document.querySelector(selector);
const messages = [];
let mode = 'encrypt';
let busy = false;

function setMode(next) {
  if (next !== 'encrypt' && next !== 'decrypt') return;
  mode = next;
  const encrypting = mode === 'encrypt';
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-heading').textContent = encrypting ? 'یک راز تازه بساز.' : 'پیامت را باز کن.';
  $('#tool-description').textContent = encrypting ? 'پیامت را بنویس و یک عبارت عبور انتخاب کن.' : 'پیام رمزگذاری‌شده و عبارت عبور آن را وارد کن.';
  $('#source-label').textContent = encrypting ? 'پیام اصلی' : 'پیام رمزگذاری‌شده';
  $('#source').placeholder = encrypting ? 'پیامی که می‌خواهی رمزگذاری کنی...' : 'پیام رمزگذاری‌شده را اینجا وارد کن...';
  $('#passphrase').placeholder = encrypting ? 'یک عبارت عبور انتخاب کن' : 'عبارت عبور پیام را وارد کن';
  $('#crypto-button').innerHTML = `${encrypting ? 'رمزگذاری پیام' : 'رمزگشایی پیام'} <span>←</span>`;
  $('#result-label').textContent = encrypting ? 'پیام رمزگذاری‌شده' : 'پیام اصلی';
  $('#result-hint').textContent = encrypting ? 'پیام رمزگذاری‌شده را همراه با عبارت عبور، جداگانه به گیرنده برسان.' : 'پیام بازشده تنها در همین مرورگر نمایش داده می‌شود.';
  $('#result-area').hidden = true;
  $('#result').value = '';
  $('#crypto-error').textContent = '';
}

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
setMode(mode);

$('#toggle-password').addEventListener('click', (event) => {
  const field = $('#passphrase');
  const show = field.type === 'password';
  field.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'پنهان' : 'نمایش';
  event.currentTarget.setAttribute('aria-label', show ? 'پنهان کردن عبارت عبور' : 'نمایش عبارت عبور');
});

$('#crypto-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#crypto-button');
  const text = $('#source').value;
  const passphrase = $('#passphrase').value;
  const operation = mode;
  if (!text || !passphrase) return;
  $('#crypto-error').textContent = '';
  $('#result-area').hidden = true;
  button.disabled = true;
  try {
    const result = await (operation === 'encrypt' ? encryptMessage(text, passphrase) : decryptMessage(text, passphrase));
    if (mode !== operation) return;
    $('#result').value = result;
    $('#result-area').hidden = false;
  } catch (error) {
    console.error('Local cryptography failed:', error);
    if (mode === operation) $('#crypto-error').textContent = operation === 'decrypt' ? 'رمزگشایی انجام نشد. پیام و عبارت عبور را بررسی کن.' : 'رمزگذاری انجام نشد. لطفاً مرورگر و ورودی‌ها را بررسی کن.';
  } finally {
    button.disabled = false;
  }
});

$('#copy-result').addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText($('#result').value);
    event.currentTarget.textContent = 'کپی شد ✓';
    setTimeout(() => { event.currentTarget.textContent = 'کپی کردن ◧'; }, 2000);
  } catch {
    $('#result').focus();
    $('#result').select();
    event.currentTarget.textContent = 'متن را کپی کن';
  }
});

function addMessage(role, text) {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = role === 'assistant' ? '✳' : 'ش';
  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = role === 'assistant' ? 'رموش' : 'شما';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  body.append(meta, bubble);
  row.append(avatar, body);
  $('#chat-messages').append(row);
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  $('#send-button').disabled = true;
  $('#chat-input').value = '';
  addMessage('user', text);
  messages.push({ role: 'user', content: text });
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-20) }),
    });
    const data = await response.json();
    if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'خطا در ارتباط با دستیار');
    messages.push({ role: 'assistant', content: data.reply });
    addMessage('assistant', data.reply);
    if (data.action) setMode(data.action);
  } catch (error) {
    messages.pop();
    addMessage('assistant', 'اتصال به دستیار برقرار نشد. تنظیمات سرویس را بررسی کن و دوباره تلاش کن. ابزار محلی همچنان در دسترس است.');
    console.error('Chat request failed:', error);
  } finally {
    busy = false;
    $('#send-button').disabled = false;
    $('#chat-input').focus();
  }
}

$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('#chat-input').value); });
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
