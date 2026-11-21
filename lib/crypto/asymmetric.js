const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (typeof value !== 'string') throw new TypeError('مقدار باید رشته باشد.');
  const clean = value.trim();
  if (!clean || !/^[A-Za-z0-9_-]+$/.test(clean) || clean.length % 4 === 1) throw new Error('فرمت پیام نامعتبر است.');
  const binary = atob(clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - clean.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// 1. Digital Signatures (ECDSA P-256 + SHA-256)
// ---------------------------------------------------------------------------

/**
 * Generates an ECDSA P-256 key pair for digital signatures, exported as JWK.
 * @returns {Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey, algorithm: 'ECDSA-P256' }>}
 */
export async function generateSigningKeyPair() {
  const cryptoObj = globalThis.crypto;
  const keyPair = await cryptoObj.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicKey = await cryptoObj.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await cryptoObj.subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKey, privateKey, algorithm: 'ECDSA-P256' };
}

/**
 * Signs a message using an ECDSA private key.
 * @param {string} text - Plaintext message to sign
 * @param {JsonWebKey} privateKeyJwk - The signer's private key in JWK format
 * @returns {Promise<string>} Base64URL-encoded signature
 */
export async function signMessage(text, privateKeyJwk) {
  if (typeof text !== 'string') throw new TypeError('متن پیام باید رشته باشد.');
  if (!privateKeyJwk || typeof privateKeyJwk !== 'object') throw new Error('کلید خصوصی معتبر نیست.');

  const cryptoObj = globalThis.crypto;
  const key = await cryptoObj.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await cryptoObj.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    encoder.encode(text)
  );

  return toBase64Url(signatureBuffer);
}

/**
 * Verifies an ECDSA digital signature.
 * @param {string} text - Original plaintext
 * @param {string} signature - Base64URL-encoded signature
 * @param {JsonWebKey} publicKeyJwk - The signer's public key in JWK format
 * @returns {Promise<boolean>}
 */
export async function verifySignature(text, signature, publicKeyJwk) {
  if (typeof text !== 'string' || typeof signature !== 'string' || !publicKeyJwk || typeof publicKeyJwk !== 'object') {
    return false;
  }
  try {
    const sigBytes = fromBase64Url(signature);
    const cryptoObj = globalThis.crypto;
    const key = await cryptoObj.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    return await cryptoObj.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      sigBytes,
      encoder.encode(text)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Public-Key Encryption (RSA-OAEP with SHA-256)
// ---------------------------------------------------------------------------

/**
 * Generates an RSA-OAEP key pair for asymmetric encryption, exported as JWK.
 * @param {object} options
 * @param {2048|4096} [options.modulusLength=2048]
 * @returns {Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey, algorithm: string }>}
 */
export async function generateEncryptionKeyPair({ modulusLength = 2048 } = {}) {
  const bits = modulusLength === 4096 ? 4096 : 2048;
  const cryptoObj = globalThis.crypto;
  const keyPair = await cryptoObj.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicKey = await cryptoObj.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await cryptoObj.subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKey, privateKey, algorithm: `RSA-OAEP-${bits}` };
}

/**
 * Import an RSA-OAEP key from a JWK object, JWK JSON, or standard PEM.
 * @param {JsonWebKey | string} keyInput
 * @param {'public' | 'private'} type
 * @param {boolean} [extractable=false]
 */
async function importEncryptionKey(keyInput, type, extractable = false) {
  const usage = type === 'public' ? 'encrypt' : 'decrypt';
  let keyData = keyInput;
  let format = 'jwk';

  if (typeof keyInput === 'string') {
    const value = keyInput.trim();
    if (value.startsWith('-----BEGIN')) {
      const label = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
      const match = value.match(new RegExp(`^-----BEGIN ${label}-----\\s+([A-Za-z0-9+/=\\s]+?)\\s+-----END ${label}-----$`));
      if (!match) throw new Error('فرمت کلید معتبر نیست.');
      const base64 = match[1].replace(/\s/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
        throw new Error('فرمت کلید معتبر نیست.');
      }
      const binary = atob(base64);
      keyData = Uint8Array.from(binary, char => char.charCodeAt(0));
      format = type === 'public' ? 'spki' : 'pkcs8';
    } else {
      keyData = JSON.parse(value);
    }
  }

  if (!keyData || typeof keyData !== 'object') throw new Error('کلید معتبر نیست.');
  return globalThis.crypto.subtle.importKey(
    format,
    keyData,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    extractable,
    [usage]
  );
}

/**
 * Export an RSA-OAEP JWK as a standard SPKI public or PKCS#8 private PEM.
 * @param {JsonWebKey} jwk
 * @param {'public' | 'private'} type
 * @returns {Promise<string>}
 */
export async function encryptionKeyToPem(jwk, type) {
  if (type !== 'public' && type !== 'private') throw new Error('نوع کلید معتبر نیست.');
  const key = await importEncryptionKey(jwk, type, true);
  const bytes = new Uint8Array(await globalThis.crypto.subtle.exportKey(type === 'public' ? 'spki' : 'pkcs8', key));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const label = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
}

/**
 * Encrypts a message using a recipient's RSA-OAEP public key.
 * @param {string} text - Message to encrypt (up to RSA key capacity, typically ~190 bytes for 2048-bit with SHA-256)
 * @param {JsonWebKey | string} publicKeyJwk - Recipient's public key as JWK, JWK JSON, or PEM
 * @returns {Promise<string>} Base64URL-encoded envelope: `rsa1.<ciphertext>`
 */
export async function encryptWithPublicKey(text, publicKeyJwk) {
  if (typeof text !== 'string' || !text.length) throw new Error('متن پیام را وارد کنید.');
  const cryptoObj = globalThis.crypto;
  const key = await importEncryptionKey(publicKeyJwk, 'public');

  // RSA-OAEP limits plaintext to modulus bytes minus twice the hash size and 2.
  // Measure UTF-8 bytes rather than characters, especially for Persian text.
  const plaintext = encoder.encode(text);
  const maxBytes = Math.ceil(key.algorithm.modulusLength / 8) - 2 * 32 - 2;
  if (plaintext.byteLength > maxBytes) {
    throw new Error(`پیام برای این کلید بیش از حد طولانی است (حداکثر ${maxBytes} بایت UTF-8).`);
  }

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    plaintext
  );

  return `rsa1.${toBase64Url(encryptedBuffer)}`;
}

/**
 * Decrypts a message using the recipient's RSA-OAEP private key.
 * @param {string} token - `rsa1.<ciphertext>`
 * @param {JsonWebKey | string} privateKeyJwk - Recipient's private key as JWK, JWK JSON, or PEM
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptWithPrivateKey(token, privateKeyJwk) {
  if (typeof token !== 'string' || !token.startsWith('rsa1.')) {
    throw new Error('فرمت پیام نامعتبر است.');
  }
  const ciphertext = fromBase64Url(token.slice(5));
  const cryptoObj = globalThis.crypto;
  const key = await importEncryptionKey(privateKeyJwk, 'private');

  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      { name: 'RSA-OAEP' },
      key,
      ciphertext
    );
    return decoder.decode(decryptedBuffer);
  } catch {
    throw new Error('رمزگشایی ناموفق بود؛ ممکن است کلید خصوصی نادرست باشد یا داده آسیب دیده باشد.');
  }
}
