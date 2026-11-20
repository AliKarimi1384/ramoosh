import { hashText, verifyHash } from './crypto/hash.js';
import { generateHmac, verifyHmac } from './crypto/hmac.js';
import { generateSecureToken, generateSecurePassphrase, calculateEntropy } from './crypto/random.js';
import {
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  generateEncryptionKeyPair,
  encryptWithPublicKey,
  decryptWithPrivateKey
} from './crypto/asymmetric.js';
import { CRYPTO_TOOLS, executeCryptoTool } from './crypto/tool-definitions.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const CONFIG_BY_VERSION = {
  rm1: { iterations: 310000, useAad: false },
  rm2: { iterations: 600000, useAad: true },
};

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

async function keyFor(passphrase, salt, iterations) {
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('گذرواژه را وارد کنید.');
  const cryptoObj = globalThis.crypto;
  const material = await cryptoObj.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return cryptoObj.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a message using AES-256-GCM and PBKDF2-SHA-256.
 * @param {string} text - Message to encrypt
 * @param {string} passphrase - Secret passphrase
 * @param {object} [options]
 * @param {'rm1'|'rm2'} [options.version='rm1'] - Envelope protocol version
 * @returns {Promise<string>}
 */
export async function encryptMessage(text, passphrase, { version = 'rm1' } = {}) {
  if (typeof text !== 'string' || !text.length) throw new Error('متن پیام را وارد کنید.');
  if (text.length > 100000) throw new Error('متن پیام بیش از حد طولانی است.');
  const config = CONFIG_BY_VERSION[version] || CONFIG_BY_VERSION.rm1;

  const cryptoObj = globalThis.crypto;
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, config.iterations);

  const encryptParams = { name: 'AES-GCM', iv };
  if (config.useAad) {
    encryptParams.additionalData = encoder.encode(version);
  }

  const ciphertext = new Uint8Array(await cryptoObj.subtle.encrypt(encryptParams, key, encoder.encode(text)));
  return [version, toBase64Url(salt), toBase64Url(iv), toBase64Url(ciphertext)].join('.');
}

/**
 * Decrypts an envelope encrypted with encryptMessage (supports rm1 and rm2).
 * @param {string} token - The encrypted envelope string
 * @param {string} passphrase - Secret passphrase
 * @returns {Promise<string>}
 */
export async function decryptMessage(token, passphrase) {
  if (typeof token !== 'string' || token.length > 600000) throw new Error('فرمت پیام معتبر نیست.');
  const parts = token.trim().split('.');
  if (parts.length !== 4) throw new Error('فرمت پیام معتبر نیست.');
  const version = parts[0];
  const config = CONFIG_BY_VERSION[version];
  if (!config) throw new Error('فرمت پیام معتبر نیست.');

  const salt = fromBase64Url(parts[1]);
  const iv = fromBase64Url(parts[2]);
  const ciphertext = fromBase64Url(parts[3]);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('فرمت پیام معتبر نیست.');

  const key = await keyFor(passphrase, salt, config.iterations);
  const decryptParams = { name: 'AES-GCM', iv };
  if (config.useAad) {
    decryptParams.additionalData = encoder.encode(version);
  }

  try {
    const cryptoObj = globalThis.crypto;
    const plaintext = await cryptoObj.subtle.decrypt(decryptParams, key, ciphertext);
    return decoder.decode(plaintext);
  } catch {
    throw new Error('گذرواژه نادرست است یا پیام تغییر کرده است.');
  }
}

// Re-export modular cryptography suite
export {
  hashText,
  verifyHash,
  generateHmac,
  verifyHmac,
  generateSecureToken,
  generateSecurePassphrase,
  calculateEntropy,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  generateEncryptionKeyPair,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  CRYPTO_TOOLS,
  executeCryptoTool
};
