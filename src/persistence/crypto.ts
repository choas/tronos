/**
 * @fileoverview Cryptographic utilities for securing sensitive data.
 *
 * This module provides encryption and decryption functions for package config
 * secrets (like API keys). It uses a simple obfuscation approach since we're
 * running in a browser/Node environment without secure key storage.
 *
 * Note: This is defense-in-depth, not bulletproof security. The encrypted values
 * are protected against casual inspection but not against determined attackers
 * with access to the source code or runtime.
 *
 * @module persistence/crypto
 */

/**
 * Encryption key derivation constant.
 * Combined with a salt to create the encryption key.
 */
const KEY_MATERIAL = 'aios-pkg-config-v1';

/**
 * Simple XOR-based encryption with a derived key.
 * Not cryptographically secure, but provides obfuscation.
 *
 * @param plaintext - The value to encrypt
 * @param salt - A salt value (e.g., package name) to derive the key
 * @returns Base64-encoded encrypted string with salt prefix
 */
export function encryptSecret(plaintext: string, salt: string): string {
  const key = deriveKey(salt);
  const encrypted = xorCipher(plaintext, key);
  // Prefix with salt identifier for decryption
  const combined = `${salt}:${encrypted}`;
  // Use encodeURIComponent to handle unicode before btoa
  return btoa(encodeURIComponent(combined));
}

/**
 * Decrypt a previously encrypted secret.
 *
 * @param ciphertext - Base64-encoded encrypted string
 * @param expectedSalt - Expected salt for validation
 * @returns Decrypted plaintext, or null if decryption fails
 */
export function decryptSecret(ciphertext: string, expectedSalt: string): string | null {
  try {
    // Decode base64 then URI-encoded content
    const combined = decodeURIComponent(atob(ciphertext));
    const colonIndex = combined.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    const salt = combined.substring(0, colonIndex);
    const encrypted = combined.substring(colonIndex + 1);

    // Validate salt matches
    if (salt !== expectedSalt) {
      return null;
    }

    const key = deriveKey(salt);
    return xorCipher(encrypted, key);
  } catch {
    // Invalid base64 or other error
    return null;
  }
}

/**
 * Check if a value appears to be an encrypted secret.
 * Encrypted secrets are base64-encoded and contain a salt prefix.
 *
 * @param value - The value to check
 * @returns True if the value looks like an encrypted secret
 */
export function isEncryptedSecret(value: string): boolean {
  try {
    const decoded = decodeURIComponent(atob(value));
    return decoded.includes(':');
  } catch {
    return false;
  }
}

/**
 * Derive an encryption key from salt and key material.
 */
function deriveKey(salt: string): string {
  // Simple key derivation: combine salt with key material
  return `${KEY_MATERIAL}-${salt}`;
}

/**
 * XOR cipher implementation.
 * XOR is symmetric - same function encrypts and decrypts.
 */
function xorCipher(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const textChar = text.charCodeAt(i);
    const keyChar = key.charCodeAt(i % key.length);
    result += String.fromCharCode(textChar ^ keyChar);
  }
  return result;
}
