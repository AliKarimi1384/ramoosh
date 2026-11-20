import { KEY_ID_PATTERN, MAX_VAULT_KEYS, validateVaultAlias } from './protocol.js';

const DATABASE_NAME = 'ramoosh-vault';
const KEY_STORE = 'keys';
const VIEW_STORE = 'views';
const CONTACT_LIMIT = 4096;

/** @typedef {'RSA-OAEP-256' | 'X25519' | 'ECDSA-P256' | 'Ed25519'} KeyAlgorithm */
/** @typedef {{id: string, alias: string, algo: KeyAlgorithm, publicKey: CryptoKey, privateKey?: CryptoKey}} KeyRecord */

const algorithms = {
  'RSA-OAEP-256': {
    generate: { name: 'RSA-OAEP', hash: 'SHA-256', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    import: { name: 'RSA-OAEP', hash: 'SHA-256' },
    usages: ['encrypt', 'decrypt'],
    publicUsages: ['encrypt'],
  },
  X25519: {
    generate: { name: 'X25519' }, import: { name: 'X25519' }, usages: ['deriveBits'], publicUsages: [],
  },
  'ECDSA-P256': {
    generate: { name: 'ECDSA', namedCurve: 'P-256' }, import: { name: 'ECDSA', namedCurve: 'P-256' },
    usages: ['sign', 'verify'], publicUsages: ['verify'],
  },
  Ed25519: {
    generate: { name: 'Ed25519' }, import: { name: 'Ed25519' }, usages: ['sign', 'verify'], publicUsages: ['verify'],
  },
};

export class VaultKeyError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** @param {string} value */
function normalizeAlias(value) {
  const alias = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!validateVaultAlias(alias)) {
    throw new VaultKeyError('invalid-alias');
  }
  return alias;
}

/** @param {Uint8Array} bytes */
function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/** @param {ArrayBuffer} spki */
export async function keyIdFromSpki(spki) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
  return `key_${base64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new VaultKeyError('keystore-unavailable'));
  });
}

export class VaultKeystore {
  /** @type {Promise<IDBDatabase> | undefined} */
  #connection;

  /** @returns {Promise<IDBDatabase>} */
  #connect() {
    if (this.#connection) return this.#connection;
    this.#connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(KEY_STORE, { keyPath: 'id' });
        request.result.createObjectStore(VIEW_STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        const disconnect = () => {
          db.close();
          this.#connection = undefined;
        };
        db.onversionchange = disconnect;
        db.onclose = disconnect;
        resolve(db);
      };
      request.onerror = () => reject(new VaultKeyError('keystore-unavailable'));
    }).catch(() => {
      this.#connection = undefined;
      throw new VaultKeyError('keystore-unavailable');
    });
    return this.#connection;
  }

  /**
   * @template T
   * @param {string} name
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => Promise<T>} operation
   * @param {AbortSignal} [signal]
   * @returns {Promise<T>}
   */
  async #run(name, mode, operation, signal) {
    const db = await this.#connect();
    signal?.throwIfAborted();
    const transaction = db.transaction(name, mode);
    const finished = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(new VaultKeyError('keystore-unavailable'));
    });
    const abort = () => {
      try { transaction.abort(); } catch { /* The transaction has already ended. */ }
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const [result] = await Promise.all([operation(transaction.objectStore(name)), finished]);
      return result;
    } catch (error) {
      abort();
      await finished.catch(() => {});
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  /** @returns {Promise<KeyRecord[]>} */
  list() {
    return this.#run(KEY_STORE, 'readonly', store => requestResult(store.getAll()));
  }

  /** @param {string} id @returns {Promise<KeyRecord | null>} */
  async get(id) {
    return (await this.#run(KEY_STORE, 'readonly', store => requestResult(store.get(id)))) ?? null;
  }

  /** @param {KeyRecord} record */
  #insert(record) {
    return this.#run(KEY_STORE, 'readwrite', async store => {
      /** @type {KeyRecord[]} */
      const entries = await requestResult(store.getAll());
      if (entries.some(entry => entry.id === record.id || (entry.algo === record.algo &&
        entry.alias.toLowerCase() === record.alias.toLowerCase()))) {
        throw new VaultKeyError('duplicate-alias');
      }
      if (entries.length >= MAX_VAULT_KEYS) throw new VaultKeyError('key-limit');
      await requestResult(store.add(record));
      return record;
    });
  }

  /** @param {string} value @param {KeyAlgorithm} algo @returns {Promise<KeyRecord>} */
  async generate(value, algo) {
    const alias = normalizeAlias(value);
    if (!Object.hasOwn(algorithms, algo)) throw new VaultKeyError('unsupported-algorithm');
    const algorithm = algorithms[algo];
    let pair;
    try {
      pair = await crypto.subtle.generateKey(algorithm.generate, false, algorithm.usages);
    } catch {
      throw new VaultKeyError('unsupported-algorithm');
    }
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    return this.#insert({ id: await keyIdFromSpki(spki), alias, algo, ...pair });
  }

  /** @param {string} id */
  async exportContact(id) {
    const record = await this.get(id);
    if (!record) throw new VaultKeyError('missing-key');
    const bytes = new Uint8Array(await crypto.subtle.exportKey('spki', record.publicKey));
    return JSON.stringify({ key_id: record.id, algo: record.algo, public_key: base64(bytes) }, null, 2);
  }

  /** @param {string} text @param {string} value @param {string} expectedId @returns {Promise<KeyRecord>} */
  async importContact(text, value, expectedId) {
    const alias = normalizeAlias(value);
    let contact, publicKey;
    try {
      if (typeof text !== 'string' || text.length > CONTACT_LIMIT || !KEY_ID_PATTERN.test(expectedId)) throw new Error();
      contact = JSON.parse(text);
      if (!contact || Object.keys(contact).length !== 3 || contact.key_id !== expectedId ||
          typeof contact.algo !== 'string' || !Object.hasOwn(algorithms, contact.algo) ||
          typeof contact.public_key !== 'string') throw new Error();
      const raw = Uint8Array.from(atob(contact.public_key), character => character.charCodeAt(0));
      if (base64(raw) !== contact.public_key || await keyIdFromSpki(raw.buffer) !== expectedId) throw new Error();
      const algorithm = algorithms[contact.algo];
      publicKey = await crypto.subtle.importKey('spki', raw, algorithm.import, true, algorithm.publicUsages);
      if (base64(new Uint8Array(await crypto.subtle.exportKey('spki', publicKey))) !== contact.public_key) throw new Error();
      const { modulusLength } = publicKey.algorithm;
      if (contact.algo === 'RSA-OAEP-256' && ![2048, 3072, 4096].includes(modulusLength)) throw new Error();
    } catch {
      throw new VaultKeyError('invalid-contact');
    }
    return this.#insert({ id: expectedId, alias, algo: contact.algo, publicKey });
  }

  /** @param {string} packageId @param {number} maximum @param {AbortSignal} [signal] */
  consumeView(packageId, maximum, signal) {
    return this.#run(VIEW_STORE, 'readwrite', async store => {
      const views = (await requestResult(store.get(packageId))) ?? 0;
      if (views >= maximum) return false;
      await requestResult(store.put(views + 1, packageId));
      return true;
    }, signal);
  }
}
