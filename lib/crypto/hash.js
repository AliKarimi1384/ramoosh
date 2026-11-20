const ALLOWED_HASH_ALGORITHMS = ['SHA-256', 'SHA-384', 'SHA-512'];
const encoder = new TextEncoder();

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
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

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  if (aNorm.length !== bNorm.length) return false;
  let diff = 0;
  for (let i = 0; i < aNorm.length; i++) {
    diff |= aNorm.charCodeAt(i) ^ bNorm.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Calculates a cryptographic hash digest of the input text.
 * @param {string} text - Plaintext to hash
 * @param {object} options
 * @param {'SHA-256'|'SHA-384'|'SHA-512'} [options.algorithm='SHA-256']
 * @param {'hex'|'base64'|'base64url'} [options.format='hex']
 * @returns {Promise<string>}
 */
export async function hashText(text, { algorithm = 'SHA-256', format = 'hex' } = {}) {
  if (typeof text !== 'string') throw new TypeError('متن ورودی باید رشته باشد.');
  const algoUpper = algorithm.toUpperCase();
  if (!ALLOWED_HASH_ALGORITHMS.includes(algoUpper)) {
    throw new Error(`الگوریتم هش پشتیبانی نمی‌شود: ${algorithm}`);
  }

  const cryptoObj = globalThis.crypto;
  const digestBuffer = await cryptoObj.subtle.digest(algoUpper, encoder.encode(text));

  switch (format.toLowerCase()) {
    case 'hex':
      return toHex(digestBuffer);
    case 'base64':
      return toBase64(digestBuffer);
    case 'base64url':
      return toBase64Url(digestBuffer);
    default:
      throw new Error(`فرمت خروجی نامعتبر است: ${format}`);
  }
}

/**
 * Verifies if the hash of the text matches the expected hash.
 * @param {string} text - Plaintext
 * @param {string} expectedHash - The expected hash string
 * @param {object} options
 * @param {'SHA-256'|'SHA-384'|'SHA-512'} [options.algorithm='SHA-256']
 * @param {'hex'|'base64'|'base64url'} [options.format='hex']
 * @returns {Promise<boolean>}
 */
export async function verifyHash(text, expectedHash, { algorithm = 'SHA-256', format = 'hex' } = {}) {
  if (typeof expectedHash !== 'string' || !expectedHash.trim()) return false;
  try {
    const calculated = await hashText(text, { algorithm, format });
    return constantTimeEqual(calculated, expectedHash.trim());
  } catch {
    return false;
  }
}
