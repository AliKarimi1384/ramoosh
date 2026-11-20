import { hashText, verifyHash } from './hash.js';
import { generateHmac, verifyHmac } from './hmac.js';
import { generateSecureToken, generateSecurePassphrase, calculateEntropy } from './random.js';
import {
  generateSigningKeyPair,
  generateEncryptionKeyPair,
  verifySignature
} from './asymmetric.js';

/**
 * Standard OpenAI Function / Tool Calling schemas for cryptographic operations.
 * Notice encrypt_message and decrypt_message are placed first for zero-knowledge backward compatibility.
 */
export const CRYPTO_TOOLS = [
  {
    type: 'function',
    name: 'encrypt_message',
    description: 'Open the local zero-knowledge message encryption form in the browser UI.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'decrypt_message',
    description: 'Open the local zero-knowledge message decryption form in the browser UI.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'hash_text',
    description: 'Calculate a cryptographic hash (SHA-256, SHA-384, or SHA-512) for text.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The plaintext to hash.' },
        algorithm: { type: 'string', enum: ['SHA-256', 'SHA-384', 'SHA-512'], description: 'Hash algorithm to use.' },
        format: { type: 'string', enum: ['hex', 'base64', 'base64url'], description: 'Output encoding format.' }
      },
      required: ['text', 'algorithm', 'format'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'verify_hash',
    description: 'Verify if a plaintext text matches an expected cryptographic hash.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The plaintext text to verify.' },
        expectedHash: { type: 'string', description: 'The expected hash digest.' },
        algorithm: { type: 'string', enum: ['SHA-256', 'SHA-384', 'SHA-512'], description: 'Hash algorithm.' },
        format: { type: 'string', enum: ['hex', 'base64', 'base64url'], description: 'Expected hash encoding format.' }
      },
      required: ['text', 'expectedHash', 'algorithm', 'format'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'generate_secure_token',
    description: 'Generate a cryptographically secure random token or key.',
    parameters: {
      type: 'object',
      properties: {
        byteLength: { type: 'integer', description: 'Number of random bytes (e.g. 16, 32, 64).' },
        format: { type: 'string', enum: ['hex', 'base64', 'base64url'], description: 'Encoding format.' }
      },
      required: ['byteLength', 'format'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'generate_secure_passphrase',
    description: 'Generate a high-entropy diceware-style random passphrase.',
    parameters: {
      type: 'object',
      properties: {
        wordCount: { type: 'integer', description: 'Number of random words (e.g. 4 to 8).' },
        separator: { type: 'string', description: 'Delimiter between words (e.g. "-" or " ").' }
      },
      required: ['wordCount', 'separator'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'calculate_entropy',
    description: 'Calculate the Shannon entropy (in bits) and length of a text or password to assess strength.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text or passphrase to analyze.' }
      },
      required: ['text'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'generate_key_pair',
    description: 'Generate an asymmetric cryptographic key pair for digital signatures (ECDSA P-256) or public key encryption (RSA-OAEP).',
    parameters: {
      type: 'object',
      properties: {
        purpose: { type: 'string', enum: ['signing', 'encryption'], description: 'Target purpose: "signing" generates ECDSA P-256; "encryption" generates RSA-OAEP.' }
      },
      required: ['purpose'],
      additionalProperties: false
    },
    strict: true
  }
];

/**
 * Executes a direct (safe) cryptography tool call.
 * Confidential tools (like encrypt_message) return an action directive for the client UI.
 * @param {string} toolName - Name of the tool
 * @param {object} [args={}] - Arguments passed from the LLM
 * @returns {Promise<{ success: boolean, result?: any, error?: string, action?: string }>}
 */
export async function executeCryptoTool(toolName, args = {}) {
  try {
    switch (toolName) {
      case 'encrypt_message': {
        return { success: true, action: 'encrypt', message: 'Local encryption tool opened in browser.' };
      }
      case 'decrypt_message': {
        return { success: true, action: 'decrypt', message: 'Local decryption tool opened in browser.' };
      }
      case 'hash_text': {
        const { text, algorithm = 'SHA-256', format = 'hex' } = args;
        const hash = await hashText(text, { algorithm, format });
        return { success: true, result: { algorithm, format, hash } };
      }
      case 'verify_hash': {
        const { text, expectedHash, algorithm = 'SHA-256', format = 'hex' } = args;
        const valid = await verifyHash(text, expectedHash, { algorithm, format });
        return { success: true, result: { match: valid, algorithm } };
      }
      case 'generate_secure_token': {
        const { byteLength = 32, format = 'hex' } = args;
        const token = generateSecureToken({ byteLength, format });
        return { success: true, result: { token, byteLength, format } };
      }
      case 'generate_secure_passphrase': {
        const { wordCount = 5, separator = '-' } = args;
        const passphrase = generateSecurePassphrase({ wordCount, separator });
        return { success: true, result: { passphrase, wordCount } };
      }
      case 'calculate_entropy': {
        const { text } = args;
        const stats = calculateEntropy(text);
        return { success: true, result: stats };
      }
      case 'generate_key_pair': {
        const { purpose } = args;
        if (purpose === 'signing') {
          const keyPair = await generateSigningKeyPair();
          return { success: true, result: keyPair };
        } else if (purpose === 'encryption') {
          const keyPair = await generateEncryptionKeyPair({ modulusLength: 2048 });
          return { success: true, result: keyPair };
        }
        throw new Error(`هدف نامعتبر است: ${purpose}`);
      }
      default:
        return { success: false, error: `ابزار یافت نشد: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
