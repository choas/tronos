/**
 * @fileoverview Shared glob matching utility.
 *
 * Supports * (any single path segment) and ** (any depth).
 * Used by the event bus, permission checker, and guard layer.
 *
 * @module utils/glob
 */

/**
 * Test whether `path` matches a glob `pattern`.
 *
 * Behaviour:
 *  1. Exact string equality → true (fast path).
 *  2. Escape regex-special characters (except `*`).
 *  3. `**` → `.*`  (match across path separators).
 *  4. `*`  → `[^/]*` (match within one segment).
 *  5. Anchor with `^…$` and test.
 *
 * Input length is capped to mitigate ReDoS on untrusted patterns.
 */
const MAX_INPUT_LENGTH = 1024;
const MAX_DOUBLE_STAR = 5;

export function matchGlob(path: string, pattern: string): boolean {
  if (path.length > MAX_INPUT_LENGTH || pattern.length > MAX_INPUT_LENGTH) {
    return false;
  }

  if (path === pattern) return true;

  // Reject patterns with too many '**' segments to avoid expensive regexes.
  if (pattern.split('**').length - 1 > MAX_DOUBLE_STAR) return false;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*');

  return new RegExp(`^${escaped}$`).test(path);
}
