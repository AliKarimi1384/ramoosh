import { encryptMessage, decryptMessage } from '/lib/crypto.js';

const $ = (selector) => document.querySelector(selector);
const messages = [];
const messageList = $('#chat-messages');
const welcome = $('#welcome');
const cryptoCard = $('#crypto-card');
let mode = 'encrypt';
let busy = false;
let requestController = null;
let conversationVersion = 0;
let cryptoVersion = 0;

function hideWelcome() {
  if (welcome) welcome.hidden = true;
}

function scrollToLatest(element) {
  element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderMode() {
  const encrypting = mode === 'encrypt';
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-heading').textContent = encrypting ? 'رمزگذاری پیام' : 'رمزگشایی پیام';
  $('#tool-description').textContent = encrypting ? 'پیام و عبارت عبور را وارد کن. این اطلاعات در مرورگر خودت می‌مانند.' : 'پیام رمزگذاری‌شده و عبارت عبور آن را وارد کن.';
  $('#source-label').textContent = encrypting ? 'پیام اصلی' : 'پیام رمزگذاری‌شده';
  $('#source').placeholder = encrypting ? 'پیامی که می‌خواهی رمزگذاری کنی...' : 'پیام رمزگذاری‌شده را اینجا وارد کن...';
  $('#passphrase').placeholder = encrypting ? 'یک عبارت عبور انتخاب کن' : 'عبارت عبور پیام را وارد کن';
  $('#crypto-button').textContent = encrypting ? 'رمزگذاری پیام' : 'رمزگشایی پیام';
  $('#result-label').textContent = encrypting ? 'پیام رمزگذاری‌شده' : 'پیام اصلی';
  $('#result-hint').textContent = encrypting ? 'پیام رمزگذاری‌شده و عبارت عبور را جداگانه و از راهی امن به گیرنده برسان.' : 'پیام بازشده تنها در همین مرورگر نمایش داده می‌شود.';
}

function setMode(next) {
  if (next !== 'encrypt' && next !== 'decrypt') return;
  cryptoVersion += 1;
  mode = next;
  renderMode();
  $('#result-area').hidden = true;
  $('#result').value = '';
  $('#crypto-error').textContent = '';
  $('#crypto-button').disabled = false;
  hideWelcome();
  cryptoCard.hidden = false;
  messageList.append(cryptoCard);
  scrollToLatest(cryptoCard);
}

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
renderMode();

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
  const version = ++cryptoVersion;
  if (!text || !passphrase) return;
  $('#crypto-error').textContent = '';
  $('#result-area').hidden = true;
  button.disabled = true;
  try {
    const result = await (operation === 'encrypt' ? encryptMessage(text, passphrase) : decryptMessage(text, passphrase));
    if (version !== cryptoVersion) return;
    $('#result').value = result;
    $('#result-area').hidden = false;
    scrollToLatest($('#result-area'));
  } catch (error) {
    console.error('Local cryptography failed:', error);
    if (version === cryptoVersion) $('#crypto-error').textContent = operation === 'decrypt' ? 'رمزگشایی انجام نشد. پیام و عبارت عبور را بررسی کن.' : 'رمزگذاری انجام نشد. لطفاً مرورگر و ورودی‌ها را بررسی کن.';
  } finally {
    if (version === cryptoVersion) button.disabled = false;
  }
});

$('#copy-result').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText($('#result').value);
    button.textContent = 'کپی شد ✓';
    setTimeout(() => { button.textContent = 'کپی کردن'; }, 2000);
  } catch {
    $('#result').focus();
    $('#result').select();
    button.textContent = 'متن را کپی کن';
  }
});

function addMessage(role, text) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
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
  messageList.append(row);
  scrollToLatest(row);
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;
  const version = conversationVersion;
  busy = true;
  requestController = new AbortController();
  $('#send-button').disabled = true;
  $('#chat-input').value = '';
  addMessage('user', text);
  messages.push({ role: 'user', content: text });
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-20) }),
      signal: requestController.signal,
    });
    const data = await response.json();
    if (version !== conversationVersion) return;
    if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'خطا در ارتباط با دستیار');
    messages.push({ role: 'assistant', content: data.reply });
    addMessage('assistant', data.reply);
    if (data.action) setMode(data.action);
  } catch (error) {
    if (version !== conversationVersion) return;
    messages.pop();
    addMessage('assistant', 'اتصال به دستیار برقرار نشد. دوباره تلاش کن؛ ابزار رمزنگاری محلی همچنان در دسترس است.');
    console.error('Chat request failed:', error);
  } finally {
    if (version === conversationVersion) {
      busy = false;
      requestController = null;
      $('#send-button').disabled = false;
      $('#chat-input').focus();
    }
  }
}

$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('#chat-input').value); });
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));

$('#new-chat')?.addEventListener('click', () => {
  conversationVersion += 1;
  cryptoVersion += 1;
  requestController?.abort();
  requestController = null;
  busy = false;
  messages.length = 0;
  $('#chat-form').reset();
  $('#crypto-form').reset();
  $('#passphrase').type = 'password';
  $('#toggle-password').textContent = 'نمایش';
  $('#toggle-password').setAttribute('aria-label', 'نمایش عبارت عبور');
  $('#send-button').disabled = false;
  $('#crypto-button').disabled = false;
  $('#result-area').hidden = true;
  $('#result').value = '';
  $('#crypto-error').textContent = '';
  cryptoCard.hidden = true;
  if (welcome) welcome.hidden = false;
  messageList.replaceChildren(...[welcome, cryptoCard].filter(Boolean));
  mode = 'encrypt';
  renderMode();
  $('#chat-input').focus();
});
