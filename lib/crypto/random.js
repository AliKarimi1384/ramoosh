const DEFAULT_WORDLIST = [
  'amber', 'anchor', 'badger', 'beacon', 'breeze', 'cactus', 'canyon', 'cedar',
  'cliff', 'clover', 'cobalt', 'comet', 'copper', 'coral', 'crater', 'crystal',
  'dawn', 'delta', 'drift', 'dune', 'eagle', 'echo', 'ember', 'falcon',
  'flint', 'forest', 'frost', 'galaxy', 'glacier', 'granite', 'harbor', 'haven',
  'hawk', 'hickory', 'horizon', 'island', 'jasper', 'lagoon', 'larch', 'lunar',
  'maple', 'meadow', 'meteor', 'mist', 'moss', 'nebula', 'oasis', 'ocean',
  'onyx', 'orbit', 'pebble', 'phoenix', 'pine', 'polar', 'prism', 'quartz',
  'radiant', 'rain', 'raven', 'reef', 'ridge', 'river', 'robin', 'sage',
  'shadow', 'sierra', 'silver', 'solar', 'spark', 'spruce', 'star', 'stone',
  'storm', 'summit', 'tide', 'timber', 'topaz', 'valley', 'vigor', 'wave',
  'willow', 'winter', 'zenith', 'zephyr'
];

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates a cryptographically secure random token.
 * @param {object} options
 * @param {number} [options.byteLength=32] - Number of random bytes
 * @param {'hex'|'base64'|'base64url'} [options.format='hex']
 * @returns {string}
 */
export function generateSecureToken({ byteLength = 32, format = 'hex' } = {}) {
  const bytesCount = Math.max(1, Math.min(byteLength, 1024));
  const cryptoObj = globalThis.crypto;
  const bytes = cryptoObj.getRandomValues(new Uint8Array(bytesCount));

  switch (format.toLowerCase()) {
    case 'hex':
      return toHex(bytes);
    case 'base64':
      return toBase64(bytes);
    case 'base64url':
      return toBase64Url(bytes);
    default:
      throw new Error(`فرمت خروجی نامعتبر است: ${format}`);
  }
}

/**
 * Generates a high-entropy passphrase using cryptographically random word selection.
 * @param {object} options
 * @param {number} [options.wordCount=5] - Number of words in the passphrase
 * @param {string} [options.separator='-'] - Separator string between words
 * @param {string[]} [options.wordList] - Optional custom wordlist
 * @returns {string}
 */
export function generateSecurePassphrase({ wordCount = 5, separator = '-', wordList = DEFAULT_WORDLIST } = {}) {
  const count = Math.max(3, Math.min(wordCount, 16));
  const words = Array.isArray(wordList) && wordList.length >= 16 ? wordList : DEFAULT_WORDLIST;

  const cryptoObj = globalThis.crypto;
  const randomIndices = new Uint32Array(count);
  cryptoObj.getRandomValues(randomIndices);

  const selected = [];
  for (let i = 0; i < count; i++) {
    selected.push(words[randomIndices[i] % words.length]);
  }
  return selected.join(separator);
}

/**
 * Calculates estimated Shannon entropy (in bits) of a given string.
 * @param {string} text
 * @returns {{ entropyBits: number, length: number, uniqueChars: number }}
 */
export function calculateEntropy(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { entropyBits: 0, length: 0, uniqueChars: 0 };
  }
  const freq = {};
  for (const char of text) {
    freq[char] = (freq[char] || 0) + 1;
  }
  const len = text.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  const totalBits = Math.round(entropy * len * 100) / 100;
  return {
    entropyBits: totalBits,
    length: len,
    uniqueChars: Object.keys(freq).length
  };
}
