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
 * Encrypts a message using a recipient's RSA-OAEP public key.
 * @param {string} text - Message to encrypt (up to RSA key capacity, typically ~190 bytes for 2048-bit with SHA-256)
 * @param {JsonWebKey} publicKeyJwk - Recipient's public key
 * @returns {Promise<string>} Base64URL-encoded envelope: `rsa1.<ciphertext>`
 */
export async function encryptWithPublicKey(text, publicKeyJwk) {
  if (typeof text !== 'string' || !text.length) throw new Error('متن پیام را وارد کنید.');
  if (!publicKeyJwk || typeof publicKeyJwk !== 'object') throw new Error('کلید عمومی معتبر نیست.');

  const cryptoObj = globalThis.crypto;
  const key = await cryptoObj.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    encoder.encode(text)
  );

  return `rsa1.${toBase64Url(encryptedBuffer)}`;
}

/**
 * Decrypts a message using the recipient's RSA-OAEP private key.
 * @param {string} token - `rsa1.<ciphertext>`
 * @param {JsonWebKey} privateKeyJwk - Recipient's private key
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptWithPrivateKey(token, privateKeyJwk) {
  if (typeof token !== 'string' || !token.startsWith('rsa1.')) {
    throw new Error('فرمت پیام نامعتبر است.');
  }
  if (!privateKeyJwk || typeof privateKeyJwk !== 'object') {
    throw new Error('کلید خصوصی معتبر نیست.');
  }

  const ciphertext = fromBase64Url(token.slice(5));
  const cryptoObj = globalThis.crypto;
  const key = await cryptoObj.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt']
  );

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
