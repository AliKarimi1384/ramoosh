import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { keyIdFromSpki } from './keystore.js';
import {
  KEY_ID_PATTERN,
  MAX_VAULT_EXPIRY_MINUTES,
  MAX_VAULT_RECIPIENTS,
  MAX_VAULT_VIEWS,
} from './protocol.js';

export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const MAX_PLAINTEXT_BYTES = MAX_PAYLOAD_BYTES + MAX_METADATA_BYTES + 4;
export const MAX_VAULT_JSON_LENGTH = Math.ceil(MAX_PLAINTEXT_BYTES / 3) * 4 + 64 * 1024;

const VERSION = '1.0';
const RSA = 'RSA-OAEP-256';
const ECDH = 'ECDH-ES+A256KW';
const AES = 'AES-256-GCM';
const CHACHA = 'ChaCha20-Poly1305';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** @typedef {{kind:'text'} | {kind:'file', name:string, type:string}} PayloadMetadata */
/** @typedef {import('./keystore.js').KeyRecord} KeyRecord */
/** @typedef {Pick<import('./protocol.js').VaultPlan, 'cipher' | 'key_wrap' | 'expires_in_minutes' | 'max_views'>} PackagePlan */
/**
 * @typedef {{
 *   vault_version: '1.0',
 *   package_id: string,
 *   created_at: string,
 *   policy: {expires_at: string|null, max_views: number|null, signed: boolean},
 *   crypto: {cipher: PackagePlan['cipher'], key_wrap: PackagePlan['key_wrap'], iv: string, auth_tag: string},
 *   recipients: {key_id: string, wrapped_key: string, ephemeral_public_key?: string}[],
 *   signature: {signer_key_id: string, algo: 'Ed25519'|'ECDSA-P256', public_key: string, value: string}|null,
 *   ciphertext: string,
 * }} VaultPackage
 */

export class VaultError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VaultError';
    this.code = code;
  }
}

function requireValue(condition, code) {
  if (!condition) throw new VaultError(code);
}

function fields(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}

function keyId(value) {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value);
}

function nullableInteger(value, max) {
  return value === null || (Number.isSafeInteger(value) && value >= 1 && value <= max);
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Length(value, maxBytes) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0
    || value.length > Math.ceil(maxBytes / 3) * 4) return -1;
  const padding = value.endsWith('==') ? 2 : Number(value.endsWith('='));
  const end = value.length - padding;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, end))) return -1;
  // RFC 4648 requires the unused bits of the last alphabet character to be zero.
  if (padding && (BASE64.indexOf(value[end - 1]) & (padding === 2 ? 15 : 3)) !== 0) return -1;
  return value.length / 4 * 3 - padding;
}

/** @returns {VaultPackage} */
function validateVault(vault) {
  const valid = condition => requireValue(condition, 'invalid-package');
  valid(fields(vault, ['vault_version', 'package_id', 'created_at', 'policy', 'crypto', 'recipients', 'signature', 'ciphertext']));
  valid(vault.vault_version === VERSION && typeof vault.package_id === 'string' && UUID_V4.test(vault.package_id));
  const created = timestamp(vault.created_at);
  valid(Number.isFinite(created));

  const { policy, crypto: config, recipients, signature } = vault;
  valid(fields(policy, ['expires_at', 'max_views', 'signed']));
  if (policy.expires_at !== null) {
    const duration = timestamp(policy.expires_at) - created;
    valid(duration > 0 && duration <= MAX_VAULT_EXPIRY_MINUTES * 60_000);
  }
  valid(nullableInteger(policy.max_views, MAX_VAULT_VIEWS) && typeof policy.signed === 'boolean');

  valid(fields(config, ['cipher', 'key_wrap', 'iv', 'auth_tag']));
  valid([AES, CHACHA].includes(config.cipher) && [RSA, ECDH].includes(config.key_wrap));
  valid(base64Length(config.iv, NONCE_BYTES) === NONCE_BYTES && base64Length(config.auth_tag, TAG_BYTES) === TAG_BYTES);

  valid(Array.isArray(recipients) && recipients.length > 0 && recipients.length <= MAX_VAULT_RECIPIENTS);
  const seen = new Set();
  for (const recipient of recipients) {
    const ecdh = config.key_wrap === ECDH;
    valid(fields(recipient, ecdh ? ['key_id', 'wrapped_key', 'ephemeral_public_key'] : ['key_id', 'wrapped_key']));
    valid(keyId(recipient.key_id) && !seen.has(recipient.key_id));
    seen.add(recipient.key_id);
    const wrappedLength = base64Length(recipient.wrapped_key, 512);
    if (ecdh) {
      valid(wrappedLength === 40 && base64Length(recipient.ephemeral_public_key, 32) === 32);
    } else {
      valid([256, 384, 512].includes(wrappedLength));
    }
  }

  if (policy.signed) {
    valid(fields(signature, ['signer_key_id', 'algo', 'public_key', 'value']));
    valid(keyId(signature.signer_key_id) && ['Ed25519', 'ECDSA-P256'].includes(signature.algo));
    const spkiLength = signature.algo === 'Ed25519' ? 44 : 91;
    valid(base64Length(signature.public_key, spkiLength) === spkiLength && base64Length(signature.value, 64) === 64);
  } else {
    valid(signature === null);
  }

  const contentLength = base64Length(vault.ciphertext, MAX_PLAINTEXT_BYTES);
  valid(contentLength >= 4 && contentLength <= MAX_PLAINTEXT_BYTES);
  return vault;
}

/** @param {string} text */
export function parseVault(text) {
  requireValue(typeof text === 'string' && text.length <= MAX_VAULT_JSON_LENGTH, 'invalid-package');
  let vault;
  try {
    vault = JSON.parse(text);
  } catch {
    throw new VaultError('invalid-package');
  }
  return validateVault(vault);
}

function payloadMetadata(payload) {
  if (fields(payload, ['kind']) && payload.kind === 'text') return { kind: 'text' };
  requireValue(fields(payload, ['kind', 'name', 'type']) && payload.kind === 'file'
    && typeof payload.name === 'string' && payload.name.length > 0 && payload.name.length <= 255
    && !/[\u0000-\u001f\u007f/\\]/.test(payload.name) && payload.name !== '.' && payload.name !== '..'
    && typeof payload.type === 'string' && payload.type.length <= 255 && !/[^\x20-\x7e]/.test(payload.type), 'invalid-payload');
  return { kind: 'file', name: payload.name, type: payload.type };
}

function packPayload(bytes, payload) {
  requireValue(bytes instanceof Uint8Array && bytes.length <= MAX_PAYLOAD_BYTES, 'invalid-payload');
  const metadata = encoder.encode(JSON.stringify(payloadMetadata(payload)));
  const body = new Uint8Array(4 + metadata.length + bytes.length);
  new DataView(body.buffer).setUint32(0, metadata.length);
  body.set(metadata, 4);
  body.set(bytes, 4 + metadata.length);
  metadata.fill(0);
  return body;
}

function unpackPayload(body) {
  const metadataLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  const contents = 4 + metadataLength;
  requireValue(metadataLength > 0 && metadataLength <= MAX_METADATA_BYTES && contents <= body.length
    && body.length - contents <= MAX_PAYLOAD_BYTES, 'invalid-payload');
  try {
    const payload = payloadMetadata(JSON.parse(decoder.decode(body.subarray(4, contents))));
    return { bytes: body.slice(contents), payload };
  } catch {
    throw new VaultError('invalid-payload');
  }
}

function concatenate(...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function envelopeAad(vault) {
  const { policy, crypto: config, recipients, signature } = vault;
  // Ordered tuples keep authenticated bytes independent of JSON object property order.
  return encoder.encode(JSON.stringify([
    'Ramoosh Vault', vault.vault_version, vault.package_id, vault.created_at,
    [policy.expires_at, policy.max_views, policy.signed],
    [config.cipher, config.key_wrap, config.iv],
    recipients.map(recipient => [recipient.key_id, recipient.wrapped_key, recipient.ephemeral_public_key ?? null]),
    signature && [signature.signer_key_id, signature.algo, signature.public_key],
  ]));
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

async function deriveWrappingKey(privateKey, publicKey, usage) {
  const subtle = globalThis.crypto.subtle;
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256));
  let input;
  let derived;
  try {
    requireValue(secret.some(byte => byte !== 0), 'invalid-recipient');
    const algorithm = encoder.encode(ECDH);
    // RFC 7518 §4.6.2. The 256-bit key needs one SHA-256 round. PartyUInfo and PartyVInfo are empty.
    input = concatenate(uint32(1), secret, uint32(algorithm.length), algorithm, uint32(0), uint32(0), uint32(256));
    derived = new Uint8Array(await subtle.digest('SHA-256', input));
    return await subtle.importKey('raw', derived, 'AES-KW', false, [usage]);
  } finally {
    secret.fill(0);
    input?.fill(0);
    derived?.fill(0);
  }
}

async function wrapForRecipient(recipient, keyWrap, secret, keyToWrap) {
  const subtle = globalThis.crypto.subtle;
  if (keyWrap === RSA) {
    const wrapped = await subtle.encrypt('RSA-OAEP', recipient.publicKey, secret);
    return { key_id: recipient.id, wrapped_key: encodeBase64(new Uint8Array(wrapped)) };
  }
  const ephemeral = await subtle.generateKey('X25519', false, ['deriveBits']);
  const wrappingKey = await deriveWrappingKey(ephemeral.privateKey, recipient.publicKey, 'wrapKey');
  const wrapped = await subtle.wrapKey('raw', keyToWrap, wrappingKey, 'AES-KW');
  const publicKey = await subtle.exportKey('raw', ephemeral.publicKey);
  return {
    key_id: recipient.id,
    wrapped_key: encodeBase64(new Uint8Array(wrapped)),
    ephemeral_public_key: encodeBase64(new Uint8Array(publicKey)),
  };
}

async function unwrapForRecipient(privateKey, keyWrap, recipient) {
  const subtle = globalThis.crypto.subtle;
  const wrapped = decodeBase64(recipient.wrapped_key);
  if (keyWrap === RSA) return new Uint8Array(await subtle.decrypt('RSA-OAEP', privateKey, wrapped));
  const publicKey = await subtle.importKey('raw', decodeBase64(recipient.ephemeral_public_key), 'X25519', false, []);
  const wrappingKey = await deriveWrappingKey(privateKey, publicKey, 'unwrapKey');
  const unwrapped = await subtle.unwrapKey('raw', wrapped, wrappingKey, 'AES-KW', 'AES-GCM', true, ['decrypt']);
  return new Uint8Array(await subtle.exportKey('raw', unwrapped));
}

async function cryptPayload(operation, cipher, secret, iv, aad, bytes) {
  requireValue(secret.length === 32, 'authentication-failed');
  if (cipher === CHACHA) return chacha20poly1305(secret, iv, aad)[operation](bytes);
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', secret, 'AES-GCM', false, [operation]);
  return new Uint8Array(await subtle[operation]({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, bytes));
}

function signatureParams(algo) {
  return algo === 'Ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256' };
}

async function signerInfo(signer) {
  requireValue(keyId(signer.id) && signer.privateKey && signer.publicKey
    && ['Ed25519', 'ECDSA-P256'].includes(signer.algo), 'invalid-signer');
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', signer.publicKey));
  requireValue(await keyIdFromSpki(spki.buffer) === signer.id, 'invalid-signer');
  return { signer_key_id: signer.id, algo: signer.algo, public_key: encodeBase64(spki), value: '' };
}

async function verifyVaultSignature(signature, aad, sealed, getKey) {
  if (!signature) return 'unsigned';
  const subtle = globalThis.crypto.subtle;
  const spki = decodeBase64(signature.public_key);
  const algorithm = signatureParams(signature.algo);
  try {
    requireValue(await keyIdFromSpki(spki.buffer) === signature.signer_key_id, 'invalid-signature');
    const key = await subtle.importKey('spki', spki, algorithm, false, ['verify']);
    const valid = await subtle.verify(algorithm, key, decodeBase64(signature.value), concatenate(aad, sealed));
    requireValue(valid, 'invalid-signature');
  } catch {
    throw new VaultError('invalid-signature');
  }
  const local = await getKey(signature.signer_key_id);
  if (local?.algo !== signature.algo || !local.publicKey) return 'untrusted';
  const trustedSpki = new Uint8Array(await subtle.exportKey('spki', local.publicKey));
  return encodeBase64(trustedSpki) === signature.public_key ? 'verified' : 'untrusted';
}

/** @param {{bytes: Uint8Array, payload: PayloadMetadata, plan: PackagePlan, recipients: KeyRecord[], signer?: KeyRecord|null, signal?: AbortSignal}} options */
export async function createVault({ bytes, payload, plan, recipients, signer = null, signal }) {
  signal?.throwIfAborted();
  requireValue(plan && [AES, CHACHA].includes(plan.cipher) && [RSA, ECDH].includes(plan.key_wrap)
    && nullableInteger(plan.expires_in_minutes, MAX_VAULT_EXPIRY_MINUTES)
    && nullableInteger(plan.max_views, MAX_VAULT_VIEWS), 'invalid-policy');
  const recipientAlgorithm = plan.key_wrap === RSA ? RSA : 'X25519';
  requireValue(Array.isArray(recipients) && recipients.length > 0 && recipients.length <= MAX_VAULT_RECIPIENTS
    && [...recipients].every(recipient => recipient?.algo === recipientAlgorithm && recipient.publicKey && keyId(recipient.id))
    && new Set(recipients.map(recipient => recipient.id)).size === recipients.length, 'invalid-recipient');

  const crypto = globalThis.crypto;
  const signature = signer ? await signerInfo(signer) : null;
  signal?.throwIfAborted();
  const body = packPayload(bytes, payload);
  const secret = new Uint8Array(32);
  try {
    crypto.getRandomValues(secret);
    const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const keyToWrap = plan.key_wrap === ECDH
      ? await crypto.subtle.importKey('raw', secret, 'AES-GCM', true, ['encrypt'])
      : null;
    const wrappedKeys = [];
    for (const recipient of recipients) {
      signal?.throwIfAborted();
      wrappedKeys.push(await wrapForRecipient(recipient, plan.key_wrap, secret, keyToWrap));
    }
    signal?.throwIfAborted();
    const created = Date.now();
    const vault = {
      vault_version: VERSION,
      package_id: crypto.randomUUID(),
      created_at: new Date(created).toISOString(),
      policy: {
        expires_at: plan.expires_in_minutes === null ? null : new Date(created + plan.expires_in_minutes * 60_000).toISOString(),
        max_views: plan.max_views,
        signed: signature !== null,
      },
      crypto: { cipher: plan.cipher, key_wrap: plan.key_wrap, iv: encodeBase64(iv), auth_tag: '' },
      recipients: wrappedKeys,
      signature,
      ciphertext: '',
    };
    const aad = envelopeAad(vault);
    const sealed = await cryptPayload('encrypt', plan.cipher, secret, iv, aad, body);
    signal?.throwIfAborted();
    vault.crypto.auth_tag = encodeBase64(sealed.subarray(sealed.length - TAG_BYTES));
    vault.ciphertext = encodeBase64(sealed.subarray(0, sealed.length - TAG_BYTES));
    if (signature) {
      const signed = await crypto.subtle.sign(signatureParams(signer.algo), signer.privateKey, concatenate(aad, sealed));
      signature.value = encodeBase64(new Uint8Array(signed));
    }
    signal?.throwIfAborted();
    return validateVault(vault);
  } finally {
    secret.fill(0);
    body.fill(0);
  }
}

/**
 * @param {unknown} vault
 * @param {{getKey: (id: string) => Promise<KeyRecord|null>, consumeView: (id: string, max: number) => Promise<boolean>, signal?: AbortSignal}} options
 * @returns {Promise<{bytes: Uint8Array<ArrayBuffer>, payload: PayloadMetadata, signature: 'unsigned'|'verified'|'untrusted'}>}
 */
export async function openVault(vault, { getKey, consumeView, signal }) {
  signal?.throwIfAborted();
  // Snapshot the validated header and ciphertext before awaiting anything in the local keystore.
  const parsed = validateVault(vault);
  const { policy, crypto: config, recipients, signature, package_id: packageId, ciphertext } = parsed;
  const header = structuredClone({ policy, config, recipients, signature });
  const keyWrap = config.key_wrap;
  const recipientAlgorithm = keyWrap === RSA ? RSA : 'X25519';
  const aad = envelopeAad(parsed);
  let matchingRecipient;
  let privateKey;
  for (const recipient of header.recipients) {
    const local = await getKey(recipient.key_id);
    signal?.throwIfAborted();
    if (local?.id === recipient.key_id && local.algo === recipientAlgorithm && local.privateKey) {
      matchingRecipient = recipient;
      privateKey = local.privateKey;
      break;
    }
  }
  requireValue(matchingRecipient, 'no-recipient');

  const sealed = concatenate(decodeBase64(ciphertext), decodeBase64(header.config.auth_tag));
  const signatureStatus = await verifyVaultSignature(header.signature, aad, sealed, getKey);
  signal?.throwIfAborted();
  let secret;
  let body;
  try {
    secret = await unwrapForRecipient(privateKey, keyWrap, matchingRecipient);
    signal?.throwIfAborted();
    body = await cryptPayload('decrypt', header.config.cipher, secret, decodeBase64(header.config.iv), aad, sealed);
  } catch {
    signal?.throwIfAborted();
    throw new VaultError('authentication-failed');
  } finally {
    secret?.fill(0);
  }

  let opened;
  try {
    signal?.throwIfAborted();
    const expiresAt = header.policy.expires_at === null ? Infinity : Date.parse(header.policy.expires_at);
    requireValue(Date.now() < expiresAt, 'expired');
    opened = unpackPayload(body);
    if (header.policy.max_views !== null) {
      const permitted = await consumeView(packageId, header.policy.max_views);
      signal?.throwIfAborted();
      requireValue(permitted, 'view-limit');
    }
    requireValue(Date.now() < expiresAt, 'expired');
    return { ...opened, signature: signatureStatus };
  } catch (error) {
    opened?.bytes.fill(0);
    throw error;
  } finally {
    body.fill(0);
  }
}
