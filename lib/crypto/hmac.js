const ALLOWED_HMAC_ALGORITHMS = ['SHA-256', 'SHA-384', 'SHA-512'];
const encoder = new TextEncoder();

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('رشته شانزده‌شانزدهی (Hex) نامعتبر است.');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(buffer) {
  return toBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(b64) {
  const binary = atob(b64.trim());
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function fromBase64Url(b64url) {
  const clean = b64url.trim();
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - clean.length % 4) % 4);
  return fromBase64(b64);
}

async function getHmacKey(secret, algorithm) {
  const algoUpper = algorithm.toUpperCase();
  if (!ALLOWED_HMAC_ALGORITHMS.includes(algoUpper)) {
    throw new Error(`الگوریتم HMAC پشتیبانی نمی‌شود: ${algorithm}`);
  }
  const cryptoObj = globalThis.crypto;
  return cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: { name: algoUpper } },
    false,
    ['sign', 'verify']
  );
}

/**
 * Generates an HMAC signature for the given text.
 * @param {string} text
 * @param {string} secret
 * @param {object} options
 * @param {'SHA-256'|'SHA-384'|'SHA-512'} [options.algorithm='SHA-256']
 * @param {'hex'|'base64'|'base64url'} [options.format='hex']
 * @returns {Promise<string>}
 */
export async function generateHmac(text, secret, { algorithm = 'SHA-256', format = 'hex' } = {}) {
  if (typeof text !== 'string') throw new TypeError('متن باید رشته باشد.');
  if (typeof secret !== 'string' || !secret.length) throw new Error('کلید محرمانه HMAC را وارد کنید.');

  const key = await getHmacKey(secret, algorithm);
  const cryptoObj = globalThis.crypto;
  const signatureBuffer = await cryptoObj.subtle.sign('HMAC', key, encoder.encode(text));

  switch (format.toLowerCase()) {
    case 'hex':
      return toHex(signatureBuffer);
    case 'base64':
      return toBase64(signatureBuffer);
    case 'base64url':
      return toBase64Url(signatureBuffer);
    default:
      throw new Error(`فرمت خروجی نامعتبر است: ${format}`);
  }
}

/**
 * Verifies an HMAC signature.
 * @param {string} text
 * @param {string} secret
 * @param {string} signature
 * @param {object} options
 * @param {'SHA-256'|'SHA-384'|'SHA-512'} [options.algorithm='SHA-256']
 * @param {'hex'|'base64'|'base64url'} [options.format='hex']
 * @returns {Promise<boolean>}
 */
export async function verifyHmac(text, secret, signature, { algorithm = 'SHA-256', format = 'hex' } = {}) {
  if (typeof text !== 'string' || typeof secret !== 'string' || !secret.length || typeof signature !== 'string') {
    return false;
  }
  try {
    let sigBytes;
    switch (format.toLowerCase()) {
      case 'hex':
        sigBytes = fromHex(signature);
        break;
      case 'base64':
        sigBytes = fromBase64(signature);
        break;
      case 'base64url':
        sigBytes = fromBase64Url(signature);
        break;
      default:
        return false;
    }

    const key = await getHmacKey(secret, algorithm);
    const cryptoObj = globalThis.crypto;
    return await cryptoObj.subtle.verify('HMAC', key, sigBytes, encoder.encode(text));
  } catch {
    return false;
  }
}
