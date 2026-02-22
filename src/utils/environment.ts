/**
 * @fileoverview Environment detection utilities.
 *
 * This module provides utilities to detect the runtime environment
 * (browser vs Node.js) and conditionally load modules.
 *
 * @module utils/environment
 */

/**
 * Check if the current environment is a browser.
 *
 * @returns True if running in browser environment
 */
export const isBrowser = (): boolean => {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
};

/**
 * Check if the current environment is Node.js.
 *
 * @returns True if running in Node.js environment
 */
export const isNode = (): boolean => {
  return typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node !== 'undefined';
};

/**
 * Check if the current environment is Bun.
 *
 * @returns True if running in Bun environment
 */
export const isBun = (): boolean => {
  return typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.bun !== 'undefined';
};

/**
 * Check if running in CLI mode (Node.js or Bun, not browser).
 *
 * @returns True if running in CLI mode
 */
export const isCLI = (): boolean => {
  return (isNode() || isBun()) && !isBrowser();
};
