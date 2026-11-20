import { createVault, MAX_PAYLOAD_BYTES, openVault, parseVault, VaultError } from './package.js';
import {
  containsKeyMaterial, MAX_VAULT_INTENT_LENGTH, MAX_VAULT_MESSAGES, VAULT_PAYLOAD_REF, validatePlan, validateVaultRequest,
} from './protocol.js';

/** @typedef {import('./keystore.js').KeyRecord} KeyRecord */
/** @typedef {import('./keystore.js').VaultKeystore} VaultKeystore */
/** @typedef {import('./package.js').PayloadMetadata} PayloadMetadata */
/** @typedef {import('./protocol.js').VaultKeyMetadata} VaultKeyMetadata */
/** @typedef {import('./protocol.js').VaultMessage} VaultMessage */
/** @typedef {import('./protocol.js').VaultPlan} VaultPlan */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

class PayloadStore {
  /** @type {{bytes: Uint8Array, payload: PayloadMetadata} | null} */
  current = null;
  revision = 0;

  clear() {
    this.current?.bytes.fill(0);
    this.current = null;
    this.revision++;
  }

  /** @param {string} text */
  setText(text) {
    this.clear();
    if (!text) return;
    if (text.length > MAX_PAYLOAD_BYTES) throw new VaultError('invalid-payload');
    const bytes = encoder.encode(text);
    if (bytes.length > MAX_PAYLOAD_BYTES) {
      bytes.fill(0);
      throw new VaultError('invalid-payload');
    }
    this.current = { bytes, payload: { kind: 'text' } };
  }

  /** @param {File} file */
  async setFile(file) {
    this.clear();
    if (file.size > MAX_PAYLOAD_BYTES) throw new VaultError('invalid-payload');
    const revision = this.revision;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (revision !== this.revision) {
      bytes.fill(0);
      throw new VaultError('cancelled');
    }
    this.current = { bytes, payload: { kind: 'file', name: file.name, type: file.type } };
  }

  referenceValue() {
    if (!this.current) return '';
    return this.current.payload.kind === 'file' ? this.current.payload.name : decoder.decode(this.current.bytes);
  }
}

/** @param {string} value @param {string} payloadValue */
function substitute(value, payloadValue) {
  if (!payloadValue) return value;
  const replace = (/** @type {string} */ part) => part.replaceAll(payloadValue, () => VAULT_PAYLOAD_REF);
  return VAULT_PAYLOAD_REF.includes(payloadValue)
    ? value.split(VAULT_PAYLOAD_REF).map(replace).join(VAULT_PAYLOAD_REF)
    : replace(value);
}

/** @param {KeyRecord[]} records @param {string} [payloadValue] @returns {VaultKeyMetadata[]} */
function metadata(records, payloadValue = '') {
  return records.map(({ id, alias, algo, privateKey }) => ({
    id,
    alias: containsKeyMaterial(alias) || substitute(alias, payloadValue) !== alias ? id : alias,
    algo,
    type: privateKey ? 'private' : 'public',
  }));
}

/** @param {VaultPlan | null} plan */
function copyPlan(plan) {
  return plan && { ...plan, recipient_ids: [...plan.recipient_ids] };
}

export class CryptoToolExecutor {
  #payload = new PayloadStore();
  /** @type {VaultKeystore} */
  #keystore;
  /** @type {VaultMessage[]} */
  #messages = [];
  /** @type {VaultPlan | null} */
  #plan = null;
  /** @type {VaultPlan | null} */
  #previousPlan = null;
  #session = new AbortController();
  /** @type {AbortController | null} */
  #request = null;

  /** @param {VaultKeystore} keystore */
  constructor(keystore) {
    this.#keystore = keystore;
  }

  get plan() { return copyPlan(this.#plan); }
  get messages() { return this.#messages.map(message => ({ ...message })); }
  hasPayload() { return this.#payload.current !== null; }
  clearPayload() { this.#payload.clear(); }
  /** @param {string} text */
  setText(text) { this.#payload.setText(text); }
  /** @param {File} file */
  setFile(file) { return this.#payload.setFile(file); }

  /** @param {VaultMessage} message */
  #remember(message) {
    this.#messages = [...this.#messages, message].slice(-MAX_VAULT_MESSAGES);
  }

  /** @param {string} intent @param {'en' | 'fa'} language
   * @returns {Promise<{plan: VaultPlan|null, reply: string|null}>}
   */
  async ask(intent, language) {
    if (typeof intent !== 'string' || intent.length > MAX_VAULT_INTENT_LENGTH) throw new VaultError('invalid-intent');
    const content = substitute(intent, this.#payload.referenceValue()).trim();
    intent = '';
    if (!content || content.length > MAX_VAULT_INTENT_LENGTH || containsKeyMaterial(content)) throw new VaultError('invalid-intent');

    this.#plan = null;
    this.#request?.abort();
    const request = new AbortController();
    this.#request = request;
    const { signal } = request;
    const payloadRevision = this.#payload.revision;
    const checkActive = () => {
      if (signal.aborted || payloadRevision !== this.#payload.revision) throw new VaultError('cancelled');
    };
    try {
      const keys = metadata(await this.#keystore.list(), this.#payload.referenceValue());
      checkActive();
      this.#scrubHistory();
      this.#remember({ role: 'user', content });
      const previous_plan = this.#previousPlan && validatePlan(this.#previousPlan, keys) ? this.#previousPlan : null;
      const body = { language, messages: this.#messages, keys, previous_plan };
      if (!validateVaultRequest(body)) throw new VaultError('invalid-intent');
      let response, result;
      try {
        response = await fetch('/api/vault', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
        });
        if (!response.ok) throw new VaultError(response.status === 422 ? 'invalid-response' : 'planner-unavailable');
        result = await response.json();
      } catch (error) {
        checkActive();
        throw error instanceof VaultError ? error : new VaultError('planner-unavailable');
      }
      checkActive();
      if (!result || typeof result !== 'object' || Object.keys(result).length !== 2) throw new VaultError('invalid-response');
      if (result.reply === null && validatePlan(result.plan, keys)) {
        this.#plan = this.#previousPlan = result.plan;
        this.#remember({ role: 'assistant', content: language === 'fa' ? 'طرح صندوق برای بازبینی آماده است.' : 'A vault policy was proposed for review.' });
        return { plan: this.plan, reply: null };
      }
      const reply = typeof result.reply === 'string' ? substitute(result.reply, this.#payload.referenceValue()).trim() : '';
      if (result.plan !== null || !reply || reply.length > MAX_VAULT_INTENT_LENGTH || containsKeyMaterial(reply)) {
        throw new VaultError('invalid-response');
      }
      this.#remember({ role: 'assistant', content: reply });
      return { plan: null, reply };
    } finally {
      if (this.#request === request) this.#request = null;
    }
  }

  #scrubHistory() {
    const payloadValue = this.#payload.referenceValue();
    this.#messages = this.#messages.flatMap(message => {
      const content = substitute(message.content, payloadValue).trim();
      return content && content.length <= MAX_VAULT_INTENT_LENGTH && !containsKeyMaterial(content) ? [{ ...message, content }] : [];
    });
  }

  async seal() {
    const plan = this.#plan;
    const source = this.#payload.current;
    if (!source) throw new VaultError('missing-payload');
    if (!plan) throw new VaultError('missing-plan');
    const { signal } = this.#session;
    const payloadRevision = this.#payload.revision;
    const checkActive = () => {
      if (signal.aborted || plan !== this.#plan || payloadRevision !== this.#payload.revision) throw new VaultError('cancelled');
    };
    const records = await this.#keystore.list();
    checkActive();
    if (!validatePlan(plan, metadata(records))) throw new VaultError('invalid-policy');
    const byId = new Map(records.map(record => [record.id, record]));
    try {
      const vault = await createVault({ ...source, plan,
        recipients: plan.recipient_ids.map(id => /** @type {KeyRecord} */ (byId.get(id))),
        signer: plan.signer_id ? byId.get(plan.signer_id) : null, signal,
      });
      checkActive();
      return vault;
    } catch (error) {
      checkActive();
      throw error;
    }
  }

  /** @param {string} text */
  async open(text) {
    const { signal } = this.#session;
    try {
      const result = await openVault(parseVault(text), {
        getKey: id => this.#keystore.get(id),
        consumeView: (id, maximum) => this.#keystore.consumeView(id, maximum, signal),
        signal,
      });
      if (signal.aborted) {
        result.bytes.fill(0);
        throw new VaultError('cancelled');
      }
      return result;
    } catch (error) {
      if (signal.aborted) throw new VaultError('cancelled');
      throw error;
    }
  }

  clear() {
    this.#session.abort();
    this.#session = new AbortController();
    this.#request?.abort();
    this.#request = null;
    this.#payload.clear();
    this.#messages = [];
    this.#plan = this.#previousPlan = null;
  }
}
