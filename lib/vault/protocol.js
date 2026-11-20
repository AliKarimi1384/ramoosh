export const VAULT_PAYLOAD_REF = '{{USER_PAYLOAD}}';
export const MAX_VAULT_MESSAGES = 10;
export const MAX_VAULT_INTENT_LENGTH = 1200;
export const MAX_VAULT_KEYS = 128;
export const MAX_VAULT_ALIAS_LENGTH = 80;
export const MAX_VAULT_RECIPIENTS = 32;
export const MAX_VAULT_EXPIRY_MINUTES = 5_256_000;
export const MAX_VAULT_VIEWS = 10_000;
export const KEY_ID_PATTERN = /^key_[A-Za-z0-9_-]{43}$/;

export const VAULT_CIPHERS = Object.freeze(['AES-256-GCM', 'ChaCha20-Poly1305']);
export const VAULT_KEY_WRAPS = Object.freeze(['RSA-OAEP-256', 'ECDH-ES+A256KW']);

/** @typedef {'RSA-OAEP-256'|'X25519'|'ECDSA-P256'|'Ed25519'} VaultKeyAlgorithm */
/** @typedef {{id: string, alias: string, type: 'public'|'private', algo: VaultKeyAlgorithm}} VaultKeyMetadata */
/** @typedef {{role: 'user'|'assistant', content: string}} VaultMessage */
/** @typedef {{
 * payload_ref: typeof VAULT_PAYLOAD_REF,
 * recipient_ids: string[],
 * signer_id: string|null,
 * cipher: 'AES-256-GCM'|'ChaCha20-Poly1305',
 * key_wrap: 'RSA-OAEP-256'|'ECDH-ES+A256KW',
 * expires_in_minutes: number|null,
 * max_views: number|null
 * }} VaultPlan */
/** @typedef {{language: 'en'|'fa', messages: VaultMessage[], keys: VaultKeyMetadata[], previous_plan: VaultPlan|null}} VaultRequest */

function hasFields(value, fields) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function validIntegerLimit(value, maximum) {
  return value === null || (Number.isSafeInteger(value) && value >= 1 && value <= maximum);
}

/**
 * @param {unknown} plan
 * @param {VaultKeyMetadata[]} keys
 * @returns {plan is VaultPlan}
 */
export function validatePlan(plan, keys) {
  if (!hasFields(plan, ['payload_ref', 'recipient_ids', 'signer_id', 'cipher', 'key_wrap', 'expires_in_minutes', 'max_views']) ||
      plan.payload_ref !== VAULT_PAYLOAD_REF || !VAULT_CIPHERS.includes(plan.cipher) || !VAULT_KEY_WRAPS.includes(plan.key_wrap) ||
      !Array.isArray(plan.recipient_ids) || plan.recipient_ids.length < 1 || plan.recipient_ids.length > MAX_VAULT_RECIPIENTS ||
      new Set(plan.recipient_ids).size !== plan.recipient_ids.length ||
      !validIntegerLimit(plan.expires_in_minutes, MAX_VAULT_EXPIRY_MINUTES) || !validIntegerLimit(plan.max_views, MAX_VAULT_VIEWS)) {
    return false;
  }

  const keyById = new Map(keys.map(key => [key.id, key]));
  const recipientAlgorithm = plan.key_wrap === 'ECDH-ES+A256KW' ? 'X25519' : 'RSA-OAEP-256';
  for (const id of plan.recipient_ids) {
    if (typeof id !== 'string' || !KEY_ID_PATTERN.test(id) || keyById.get(id)?.algo !== recipientAlgorithm) return false;
  }
  if (plan.signer_id === null) return true;

  const signer = keyById.get(plan.signer_id);
  return typeof plan.signer_id === 'string' && KEY_ID_PATTERN.test(plan.signer_id) && signer?.type === 'private' &&
    (signer.algo === 'ECDSA-P256' || signer.algo === 'Ed25519');
}

const keyAlgorithms = ['RSA-OAEP-256', 'X25519', 'ECDSA-P256', 'Ed25519'];

/** @param {string} value */
export function containsKeyMaterial(value) {
  return /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|SECRET KEY)(?: BLOCK)?-----|"(?:d|k)"\s*:\s*"|\bsk-[\w-]{12,}/i.test(value) ||
    (value.match(/[\w+/=-]{43,}/g) ?? []).some(token => !KEY_ID_PATTERN.test(token)) ||
    /\b[\da-f]{32,}\b/i.test(value);
}

/** @param {unknown} alias */
export function validateVaultAlias(alias) {
  return typeof alias === 'string' && alias.length >= 1 && alias.length <= MAX_VAULT_ALIAS_LENGTH &&
    alias === alias.trim() && !/[\p{Cc}\p{Bidi_Control}]/u.test(alias) && !containsKeyMaterial(alias);
}

function validMetadata(key) {
  return hasFields(key, ['id', 'alias', 'type', 'algo']) &&
    typeof key.id === 'string' && KEY_ID_PATTERN.test(key.id) && validateVaultAlias(key.alias) &&
    (key.type === 'public' || key.type === 'private') && keyAlgorithms.includes(key.algo);
}

function validMessage(message) {
  return hasFields(message, ['role', 'content']) && (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' && message.content.length <= MAX_VAULT_INTENT_LENGTH &&
    !!message.content.trim() && !containsKeyMaterial(message.content);
}

/**
 * @param {unknown} request
 * @returns {request is VaultRequest}
 */
export function validateVaultRequest(request) {
  return hasFields(request, ['language', 'messages', 'keys', 'previous_plan']) &&
    (request.language === 'en' || request.language === 'fa') &&
    Array.isArray(request.messages) && request.messages.length >= 1 && request.messages.length <= MAX_VAULT_MESSAGES &&
    request.messages.at(-1)?.role === 'user' && request.messages.every(validMessage) &&
    Array.isArray(request.keys) && request.keys.length <= MAX_VAULT_KEYS && request.keys.every(validMetadata) &&
    new Set(request.keys.map(key => key.id)).size === request.keys.length &&
    (request.previous_plan === null || validatePlan(request.previous_plan, request.keys));
}
