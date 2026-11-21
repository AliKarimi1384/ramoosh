const MAX_TEXT_BYTES = 1_000_000;
const MAX_COMPRESSED_BYTES = 2_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const algorithms = ['gzip', 'deflate'];

function validateAlgorithm(algorithm) {
  if (!algorithms.includes(algorithm)) throw new Error(`Unsupported compression algorithm: ${algorithm}`);
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const input = value.trim();
  if (!input || input.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new Error('Invalid Base64 compressed data.');
  }
  const binary = atob(input);
  if (btoa(binary) !== input) throw new Error('Invalid Base64 compressed data.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function transform(bytes, stream, maxBytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Compression result exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Compress UTF-8 text and return standard Base64-encoded compressed bytes.
 * @param {string} text
 * @param {{ algorithm?: 'gzip' | 'deflate' }} [options]
 * @returns {Promise<string>}
 */
export async function compressText(text, { algorithm = 'gzip' } = {}) {
  if (typeof text !== 'string') throw new TypeError('Text must be a string.');
  validateAlgorithm(algorithm);
  const bytes = encoder.encode(text);
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('Text exceeds the size limit.');
  if (typeof CompressionStream !== 'function') throw new Error('Compression is not supported by this browser.');
  return encodeBase64(await transform(bytes, new CompressionStream(algorithm), MAX_COMPRESSED_BYTES));
}

/** Decompress standard Base64-encoded bytes into UTF-8 text.
 * @param {string} value
 * @param {{ algorithm?: 'gzip' | 'deflate' }} [options]
 * @returns {Promise<string>}
 */
export async function decompressText(value, { algorithm = 'gzip' } = {}) {
  if (typeof value !== 'string') throw new TypeError('Compressed data must be a string.');
  validateAlgorithm(algorithm);
  const bytes = decodeBase64(value);
  if (typeof DecompressionStream !== 'function') throw new Error('Decompression is not supported by this browser.');
  return decoder.decode(await transform(bytes, new DecompressionStream(algorithm), MAX_TEXT_BYTES));
}
