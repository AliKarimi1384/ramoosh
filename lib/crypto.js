// The version fixes the KDF parameters and wire format for future compatibility.
const VERSION = 'rm1';
const ITERATIONS = 310000;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('فرمت پیام معتبر نیست.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('گذرواژه را وارد کنید.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptMessage(text, passphrase) {
  if (typeof text !== 'string' || !text.length) throw new Error('متن پیام را وارد کنید.');
  if (text.length > 100000) throw new Error('متن پیام بیش از حد طولانی است.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)));
  return [VERSION, toBase64Url(salt), toBase64Url(iv), toBase64Url(ciphertext)].join('.');
}

export async function decryptMessage(token, passphrase) {
  if (typeof token !== 'string' || token.length > 600000) throw new Error('فرمت پیام معتبر نیست.');
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('فرمت پیام معتبر نیست.');
  const salt = fromBase64Url(parts[1]);
  const iv = fromBase64Url(parts[2]);
  const ciphertext = fromBase64Url(parts[3]);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('فرمت پیام معتبر نیست.');
  const key = await keyFor(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    throw new Error('گذرواژه نادرست است یا پیام تغییر کرده است.');
  }
}
